"""SPHEREx DR1 all-sky mosaic fallback.

When IRSA's search finds no exposures (or is down), the lab can still show real SPHEREx pixels
from the DR1 HiPS spectral cube on the official AWS mirror. Each HEALPix order-5 tile holds
102 spectral planes (IMAGE in MJy/sr, NHITS, FLAGS) plus a SPECTRAL_CHANNELS table.

Only the rows a field needs are range-read. Each spectral channel of the chosen detector is
written as a small FITS file in the same layout as an archive cutout (IMAGE, FLAGS, VARIANCE,
WAVELENGTH) on the lab's display grid, so alignment, rendering and pixel inspection reuse the
normal pipeline. The mosaic stacks many dates: frames are wavelength channels, not epochs.
"""
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from io import BytesIO
import hashlib
import json
import re
import threading

import numpy as np
import requests
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates

from .science import grid_for

BUCKET = 'https://nasa-irsa-spherex.s3.amazonaws.com'
PREFIX = 'dr1/hips5_cube/'
DEFAULT_BUILD = 'hips_20261026'
ORDER = 5
TILE = 512
_LOCAL = threading.local()
CELESTIAL_KEYS = ('CTYPE1', 'CTYPE2', 'CRVAL1', 'CRVAL2', 'CRPIX1', 'CRPIX2', 'CDELT1', 'CDELT2',
                  'PC1_1', 'PC1_2', 'PC2_1', 'PC2_2', 'PV2_1', 'PV2_2', 'LONPOLE', 'LATPOLE', 'RADESYS')


def _http():
    session = getattr(_LOCAL, 'session', None)
    if session is None:
        session = _LOCAL.session = requests.Session()
    return session


def _range(url, start, length):
    response = _http().get(url, headers={'Range': f'bytes={start}-{start + length - 1}'}, timeout=(6, 60))
    response.raise_for_status()
    if len(response.content) != length:
        raise ValueError('The SPHEREx mosaic returned a short read.')
    return response.content


@lru_cache(maxsize=1)
def build():
    """Newest published HiPS build folder (hips_YYYYMMDD)."""
    try:
        listing = _http().get(BUCKET, params={'list-type': '2', 'delimiter': '/', 'prefix': PREFIX}, timeout=(6, 20)).text
        builds = sorted(re.findall(r'<Prefix>' + re.escape(PREFIX) + r'(hips_\d{8})/</Prefix>', listing))
        return builds[-1] if builds else DEFAULT_BUILD
    except requests.RequestException:
        return DEFAULT_BUILD


def tile_url(npix):
    return f'{BUCKET}/{PREFIX}{build()}/Norder{ORDER}/Dir{(npix // 10000) * 10000}/Npix{npix}_cube.fits'


def _header_at(url, offset):
    """Read one FITS header starting at offset; return (header, data offset)."""
    raw, pos = b'', 0
    while True:
        raw += _range(url, offset + len(raw), 2880)
        for i in range(pos, len(raw), 80):
            if raw[i:i + 8] == b'END     ':
                return fits.Header.fromstring(raw[:i + 80].decode('ascii', 'replace')), offset + len(raw)
        pos = len(raw)
        if len(raw) > 2880 * 40:
            raise ValueError('Unreadable SPHEREx mosaic header.')


@lru_cache(maxsize=64)
def layout(npix):
    """Extension name -> (header, data offset) for one tile."""
    url = tile_url(npix)
    header, offset = _header_at(url, 0)
    out = {}
    while True:
        try:
            header, data = _header_at(url, offset)
        except (requests.HTTPError, ValueError):
            break
        size = abs(header['BITPIX']) // 8
        for k in range(1, header['NAXIS'] + 1):
            size *= header[f'NAXIS{k}']
        size += header.get('PCOUNT', 0)
        out[header.get('EXTNAME', f'HDU{len(out) + 1}')] = (header, data)
        offset = data + (size + 2879) // 2880 * 2880
        if 'WCS-WAVE' in out or len(out) > 8:
            break
    for name in ('IMAGE', 'FLAGS', 'SPECTRAL_CHANNELS'):
        if name not in out:
            raise ValueError(f'The SPHEREx mosaic tile is missing its {name} extension.')
    return out


@lru_cache(maxsize=64)
def tile_wcs(npix):
    header = layout(npix)['IMAGE'][0]
    celestial = fits.Header()
    for key in CELESTIAL_KEYS:
        if key in header:
            celestial[key] = header[key]
    celestial['NAXIS'] = 2
    return WCS(celestial)


@lru_cache(maxsize=1)
def channels(npix):
    """Rows of SPECTRAL_CHANNELS (plane order): detector, subchannel, wavelength and bandwidth in µm.
    The table is identical in every tile, so the first tile read supplies it."""
    header, data = layout(npix)['SPECTRAL_CHANNELS']
    blob = _range(tile_url(npix), data, header['NAXIS1'] * header['NAXIS2'] + header.get('PCOUNT', 0))
    pad = lambda b: b + b'\0' * (-len(b) % 2880)
    raw = fits.PrimaryHDU().header.tostring().encode() + header.tostring().encode() + pad(blob)
    with fits.open(BytesIO(raw)) as hdus:
        table = hdus[1].data
        return [dict(plane=plane, detector=int(row['DETECTOR']), subchannel=int(row['SUBCHAN']),
                     wavelength=float(row['WAVELENGTH']), bandwidth=float(row['BANDWIDTH']))
                for plane, row in enumerate(table)]


def _rows(npix, ext, plane, y0, y1):
    header, data = layout(npix)[ext]
    dtype = {-32: '>f4', 32: '>i4', 16: '>i2', -64: '>f8'}[header['BITPIX']]
    item = abs(header['BITPIX']) // 8
    start = data + (plane * TILE * TILE + y0 * TILE) * item
    block = np.frombuffer(_range(tile_url(npix), start, (y1 - y0 + 1) * TILE * item), dtype=dtype)
    return block.reshape(y1 - y0 + 1, TILE)


def build_channels(options, cache, progress=lambda message: None):
    """Write one cutout-like FITS per spectral channel of the requested detector. Returns paths."""
    from astropy_healpix import HEALPix
    detector = options['detector']
    grid, size = grid_for(options)
    yy, xx = np.indices((size, size))
    sky = grid.pixel_to_world(xx, yy)
    healpix = HEALPix(nside=2 ** ORDER, order='nested', frame='icrs')
    owner = np.asarray(healpix.skycoord_to_healpix(sky))
    tiles = sorted({int(n) for n in np.unique(owner)})
    planes = [c for c in channels(tiles[0]) if c['detector'] == detector]
    if not planes:
        raise ValueError(f'The SPHEREx mosaic has no channels for detector D{detector}.')
    key = hashlib.sha256(json.dumps([build(), options['ra'], options['dec'], options['fov'], detector]).encode()).hexdigest()[:20]
    folder = cache / 'dr1-mosaic'
    folder.mkdir(parents=True, exist_ok=True)
    paths = [folder / f'{key}-c{c["subchannel"]:02d}.fits' for c in planes]
    if all(p.exists() for p in paths):
        return paths

    # Which tile pixels each display pixel samples, and the row band each tile must supply.
    lookup = {}
    for npix in tiles:
        mask = owner == npix
        px, py = tile_wcs(npix).wcs_world2pix(sky.ra.deg[mask], sky.dec.deg[mask], 0)
        y0 = int(max(0, np.floor(py.min()) - 1)); y1 = int(min(TILE - 1, np.ceil(py.max()) + 1))
        lookup[npix] = (mask, px, py, y0, y1)
    progress(f'Reading SPHEREx DR1 mosaic · {len(planes)} D{detector} channels from {len(tiles)} sky tile{"s" * (len(tiles) > 1)}')

    def channel(item):
        c, path = item
        image = np.full((size, size), np.nan, dtype=np.float32)
        flags = np.zeros((size, size), dtype=np.int32)
        hits = np.zeros((size, size), dtype=np.int32)
        for npix, (mask, px, py, y0, y1) in lookup.items():
            block = _rows(npix, 'IMAGE', c['plane'], y0, y1).astype(np.float64)
            coords = [py - y0, px]
            image[mask] = map_coordinates(block, coords, order=1, mode='constant', cval=np.nan)
            nearest = [np.clip(np.rint(py - y0), 0, y1 - y0).astype(int), np.clip(np.rint(px), 0, TILE - 1).astype(int)]
            flags[mask] = _rows(npix, 'FLAGS', c['plane'], y0, y1)[nearest[0], nearest[1]]
            if 'NHITS' in layout(npix):
                hits[mask] = _rows(npix, 'NHITS', c['plane'], y0, y1)[nearest[0], nearest[1]]
        if 'NHITS' in layout(tiles[0]):
            image[hits <= 0] = np.nan  # no exposure landed here: unknown, not zero
        header = grid.to_header()
        header['DETECTOR'] = detector
        header['OBSID'] = f'DR1-MOSAIC-D{detector}-C{c["subchannel"]:02d}'
        header['DATE-OBS'] = f'{build()[5:9]}-{build()[9:11]}-{build()[11:13]}T00:00:00'
        header['BUNIT'] = 'MJy/sr'
        header['XPOSURE'] = 0.0
        header['WAVELEN'] = (c['wavelength'], 'channel centre (um)')
        header['BANDWID'] = (c['bandwidth'], 'channel bandwidth (um)')
        header['NHITSMED'] = (int(np.median(hits)), 'median exposures stacked per pixel')
        header['COMMENT'] = 'SPHEREx DR1 HiPS spectral cube, resampled to the lab display grid. Stacked over many dates.'
        primary = fits.PrimaryHDU()
        primary.header['VERSION'] = f'DR1 HiPS mosaic {build()}'
        hdus = fits.HDUList([primary,
                             fits.ImageHDU(image, header=header, name='IMAGE'),
                             fits.ImageHDU(flags, header=grid.to_header(), name='FLAGS'),
                             fits.ImageHDU(np.full((size, size), np.nan, dtype=np.float32), header=grid.to_header(), name='VARIANCE'),
                             fits.ImageHDU(np.full((size, size), c['wavelength'], dtype=np.float32), header=grid.to_header(), name='WAVELENGTH')])
        temporary = path.with_suffix('.tmp')
        hdus.writeto(temporary, overwrite=True)
        temporary.replace(path)
        return path

    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(channel, zip(planes, paths)))


def channel_record(meta, path, options):
    """Lab record for one mosaic channel file (meta from science.fits_metadata)."""
    with fits.open(path, memmap=False) as hdus:
        header = hdus['IMAGE'].header
        wavelength, bandwidth, hits = header['WAVELEN'], header['BANDWID'], header['NHITSMED']
    from astropy_healpix import HEALPix
    from astropy.coordinates import SkyCoord
    npix = int(HEALPix(nside=2 ** ORDER, order='nested', frame='icrs').skycoord_to_healpix(
        SkyCoord(options['ra'], options['dec'], unit='deg')))
    return dict(meta, path=str(path), source=None, release='DR1', collection='spherex_dr1_hips',
                field_key='dr1-mosaic', field_name='SPHEREx DR1 all-sky mosaic', context=[],
                fits_url=tile_url(npix), mosaic=True, mosaic_build=build(),
                mosaic_wavelength=wavelength, mosaic_bandwidth=bandwidth, mosaic_hits=hits,
                discovery_api='SPHEREx DR1 HiPS spectral cube (AWS mirror)')
