"""Numerical data loading and WCS-aligned display preparation for the prototype."""
import hashlib
import math
from pathlib import Path

import numpy as np
from astropy import log
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
from PIL import Image
from scipy.ndimage import map_coordinates

log.setLevel('ERROR')
PIPELINE = 'prototype-1.2-full-field'
FLAG_SOURCE = 'https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html'
FLAG_NAMES = {
    0: 'Transient event', 1: 'Near saturation', 2: 'Readout error',
    6: 'Nonfunctional pixel', 7: 'Dichroic region', 9: 'Missing data',
    10: 'Noisy pixel', 11: 'Dead pixel', 12: 'Full sample history',
    14: 'Phantom correction unavailable', 15: 'Nonlinear response',
    17: 'Persistent charge', 19: 'Outlier', 20: 'Crosstalk',
    21: 'Known source', 22: 'Ghost', 23: 'Focal-plane ghost',
    24: 'Extended ghost', 25: 'Streak', 26: 'Bloom',
    27: 'Snowball', 28: 'Halo', 29: 'Satellite halo',
}
BAD_BITS = (2, 6, 7, 9, 10, 11, 15, 17, 26, 27, 28, 29)
BAD_MASK = sum(1 << bit for bit in BAD_BITS)


def flag_details(value):
    value = int(value)
    return [
        {'bit': bit, 'name': FLAG_NAMES.get(bit, f'Unmapped bit {bit}'),
         'kind': 'info' if bit in (12, 21) else 'caution'}
        for bit in range(max(32, value.bit_length())) if value & (1 << bit)
    ]


def coordinate(ra, dec):
    try:
        ra_number, dec_number = float(ra), float(dec)
        if not (math.isfinite(ra_number) and math.isfinite(dec_number)):
            raise ValueError('Coordinates must be finite.')
        if not (0 <= ra_number < 360 and -90 <= dec_number <= 90):
            raise ValueError('RA must be 0 to <360 degrees and Dec −90 to +90 degrees.')
        return SkyCoord(ra_number, dec_number, unit='deg')
    except (TypeError, ValueError) as error:
        # Numeric inputs with invalid ranges must not fall through to another format.
        try:
            float(ra)
            float(dec)
        except (TypeError, ValueError):
            pass
        else:
            raise error
    try:
        return SkyCoord(str(ra), str(dec), unit=('hourangle', 'deg'))
    except Exception as error:
        raise ValueError('Enter decimal degrees or RA hh:mm:ss and Dec ±dd:mm:ss.') from error


def request_options(payload):
    sky = coordinate(payload.get('ra'), payload.get('dec'))
    width = float(payload.get('fov', 15))
    if not math.isfinite(width) or not 1 <= width <= 60:
        raise ValueError('Field width must be between 1 and 60 arcminutes.')
    detector = int(payload.get('detector', 3))
    if detector not in range(1, 7):
        raise ValueError('Choose a detector from 1 to 6.')
    start, end = payload.get('start', ''), payload.get('end', '')
    start_mjd = float(Time(start).mjd) if start else None
    end_mjd = float(Time(end).mjd) + 1 if end else None
    if start_mjd is not None and end_mjd is not None and start_mjd >= end_mjd:
        raise ValueError('The end date must be on or after the start date.')
    return {'ra': float(sky.ra.deg), 'dec': float(sky.dec.deg), 'fov': width,
            'detector': detector, 'start': start, 'end': end,
            'start_mjd': start_mjd, 'end_mjd': end_mjd}


def grid_for(options):
    size = max(10, int(math.ceil(options['fov'] * 60 / 6.15)))
    scale = options['fov'] / 60 / size
    grid = WCS(naxis=2)
    grid.wcs.ctype = ['RA---TAN', 'DEC--TAN']
    grid.wcs.crval = [options['ra'], options['dec']]
    grid.wcs.crpix = [(size + 1) / 2] * 2
    grid.wcs.cdelt = [-scale, scale]
    return grid, size


def fits_metadata(path):
    with fits.open(path, memmap=False) as hdus:
        hdus.verify('exception')
        for name in ('IMAGE', 'FLAGS', 'VARIANCE', 'WCS-WAVE'):
            if name not in hdus:
                raise ValueError(f'The FITS file is missing its {name} extension.')
        header = hdus['IMAGE'].header
        shape = hdus['IMAGE'].data.shape
        if len(shape) != 2 or max(shape) > 2040:
            raise ValueError('Expected a SPHEREx image or cutout of at most 2040 × 2040 pixels.')
        if any(hdus[name].data.shape != shape for name in ('FLAGS', 'VARIANCE')):
            raise ValueError('Image, flags and variance must have matching shapes.')
        detector = int(header['DETECTOR'])
        if detector not in range(1, 7):
            raise ValueError('Unsupported detector.')
        spatial = WCS(header).celestial
        sky = spatial.pixel_to_world((shape[1]-1)/2, (shape[0]-1)/2)
        corners = spatial.pixel_to_world(np.array([0,0,shape[1]-1,shape[1]-1]),
                                         np.array([0,shape[0]-1,0,shape[0]-1]))
        timestamp = Time(header['DATE-OBS'], scale='utc')
        return {'id': str(header['OBSID']), 'detector': detector,
                'timestamp': timestamp.isot + 'Z', 'mjd': float(timestamp.mjd),
                'version': str(hdus[0].header.get('VERSION', 'unspecified')),
                'unit': str(header.get('BUNIT', 'unspecified')),
                'exposure': float(header.get('XPOSURE', 0)),
                'native_shape': list(shape),
                'center': [float(sky.ra.deg), float(sky.dec.deg)],
                'radius_deg': float(sky.separation(corners).deg.max()),
                'processed_mjd': float(Time(header['DATE']).mjd) if header.get('DATE') else 0,
                'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest()}


def wavelength(hdus, x, y):
    try:
        # Official spectral WCS accounts for cutout origin and FITS indexing.
        spectral = WCS(hdus['IMAGE'].header, fobj=hdus, key='W')
        spectral.sip = None
        wave, width = spectral.pixel_to_world_values(x, y)
        return finite(wave), finite(width)
    except (ValueError, KeyError, IndexError, TypeError):
        return None, None


def finite(value):
    number = float(value)
    return number if math.isfinite(number) else None


def prepare_frame(record, options, grid, size, grid_sky=None):
    center = SkyCoord(options['ra'], options['dec'], unit='deg')
    image_center = SkyCoord(*record['center'], unit='deg')
    if center.separation(image_center).deg > record.get('radius_deg', 4) + options['fov']/60/2*2**.5:
        return None
    with fits.open(record['path'], memmap=False) as hdus:
        header = hdus['IMAGE'].header
        native = WCS(header).celestial
        if grid_sky is None:
            yy, xx = np.indices((size, size))
            grid_sky = grid.pixel_to_world(xx, yy)
        xx_native, yy_native = native.world_to_pixel(grid_sky)
        data = hdus['IMAGE'].data.astype(float)
        aligned = map_coordinates(data, [yy_native, xx_native], order=1,
                                  mode='constant', cval=np.nan)
        flags = map_coordinates(hdus['FLAGS'].data.astype(np.int64),
                                [yy_native, xx_native], order=0, mode='constant', cval=512)
        covered = np.isfinite(aligned)
        footprint = ((xx_native >= 0) & (xx_native <= data.shape[1]-1)
                     & (yy_native >= 0) & (yy_native <= data.shape[0]-1))
        flagged = covered & ((flags & BAD_MASK) != 0)
        cov_total = max(1, int(covered.sum()))
        flag_vals = flags[flagged]
        flag_summary = []
        if flag_vals.size:
            for bit in BAD_BITS:
                cnt = int(np.count_nonzero((flag_vals & (1 << bit)) != 0))
                if cnt:
                    flag_summary.append(dict(
                        bit=bit,
                        name=FLAG_NAMES.get(bit, f'Flag bit {bit}'),
                        pixels=cnt,
                        fraction=round(100.0 * cnt / cov_total, 2),
                    ))
            flag_summary.sort(key=lambda item: -item['pixels'])
        cx, cy = native.world_to_pixel(SkyCoord(options['ra'], options['dec'], unit='deg'))
        inside = 0 <= cx < data.shape[1] and 0 <= cy < data.shape[0]
        wave, width = wavelength(hdus, cx, cy) if inside else (None, None)
        meta = {k: v for k, v in record.items() if k not in ('path', 'marker_sky')}
        meta.update(coverage=round(100*covered.mean(), 1),
                    footprint_coverage=round(100*footprint.mean(), 2),
                    caution_fraction=round(100*flagged.sum()/cov_total, 1),
                    flag_summary=flag_summary[:8],
                    wavelength=wave, bandwidth=width, center_inside=bool(inside),
                    wavelength_kind='Approximate display wavelength from WCS-WAVE')
        meta['marker'] = None
        if record.get('marker_sky'):
            mx, my = grid.world_to_pixel(SkyCoord(*record['marker_sky'], unit='deg'))
            if -.5 <= mx < size-.5 and -.5 <= my < size-.5:
                meta['marker'] = [float((mx+.5)/size), float(1-(my+.5)/size)]
        return aligned, flagged, meta


def render_frames(prepared, directory):
    samples = np.concatenate([data[np.isfinite(data)] for data, _, _ in prepared])
    low, high = np.percentile(samples, [42, 99.5])
    high = max(high, low + 1e-9)
    for index, (data, flagged, meta) in enumerate(prepared):
        levels = np.clip(np.arcsinh(5*np.maximum((data-low)/(high-low), 0))/np.arcsinh(5), 0, 1)
        pixels = np.nan_to_num(levels*255).astype(np.uint8)
        rgba = np.dstack([pixels, pixels, pixels, np.isfinite(data).astype(np.uint8)*255])
        Image.fromarray(rgba[::-1]).save(directory / f'{index}.png')
        overlay = np.zeros((*data.shape, 4), dtype=np.uint8)
        overlay[flagged] = [255, 145, 56, 155]
        Image.fromarray(overlay[::-1]).save(directory / f'{index}-quality.png')
        meta['index'] = index
    return {'method': 'asinh', 'lower': float(low), 'upper': float(high),
            'shared_across_frames': True, 'unit': prepared[0][2]['unit']}


def inspect_pixel(record, options, display_x, display_y):
    grid, size = grid_for(options)
    if not (0 <= display_x < 1 and 0 <= display_y < 1):
        raise ValueError('Select a point inside the image.')
    sky = grid.pixel_to_world(display_x*size-.5, (1-display_y)*size-.5)
    result = {'ra': float(sky.ra.deg), 'dec': float(sky.dec.deg), 'unit': record['unit']}
    with fits.open(record['path'], memmap=False) as hdus:
        x, y = WCS(hdus['IMAGE'].header).celestial.world_to_pixel(sky)
        ix, iy = int(round(float(x))), int(round(float(y)))
        shape = hdus['IMAGE'].data.shape
        if not (0 <= ix < shape[1] and 0 <= iy < shape[0]):
            return dict(result, covered=False)
        value = finite(hdus['IMAGE'].data[iy, ix])
        variance = finite(hdus['VARIANCE'].data[iy, ix])
        flags = int(hdus['FLAGS'].data[iy, ix])
        details = sorted(flag_details(flags), key=lambda d: (0 if d.get('caution') or d.get('bit') in BAD_BITS else 1, d.get('bit', 99)))
        nearby_flags = []
        if (flags & BAD_MASK) == 0:
            y0, y1 = max(0, iy - 1), min(shape[0], iy + 2)
            x0, x1 = max(0, ix - 1), min(shape[1], ix + 2)
            nbr = np.asarray(hdus['FLAGS'].data[y0:y1, x0:x1], dtype=np.int64)
            near_mask = int(np.bitwise_or.reduce(nbr.ravel())) & BAD_MASK
            if near_mask:
                nearby_flags = [d for d in flag_details(near_mask) if d.get('bit') in BAD_BITS]
        wave, width = wavelength(hdus, ix, iy)
        return dict(result, covered=value is not None, value=value,
                    uncertainty=math.sqrt(variance) if variance is not None and variance >= 0 else None,
                    native_pixel=[ix, iy], flags=flags, flag_details=details,
                    nearby_flags=nearby_flags, wavelength=wave, bandwidth=width)
