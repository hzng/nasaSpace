"""Exploratory point-source spectrophotometry with explicit calibration and quality.

This is a local, single-source fit, not the official IRSA Tractor service.
Source coordinates are fixed; neighboring sources are not jointly deblended.
"""
import hashlib
import json
import math
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.stats import sigma_clip
from astropy.time import Time
from astropy.wcs import WCS
from photutils.psf import ImagePSF

from . import calibrations
from .archive import write_json, reduction_priority
from .science import BAD_MASK, coordinate, finite, flag_details

METHOD = 'single-source-epsf-2'
REJECT_MASK = BAD_MASK | sum(1 << b for b in (0,1,14,19,20,22,23,24,25))
FEATURES = [
    dict(name='Water-related absorption', formula='H2O', center=3.05, band=[2.90,3.17],
         left=[2.65,2.85], right=[3.55,3.72], color='#71d9f6',
         caution='Water gas, ice, the source atmosphere and continuum curvature can overlap here.'),
    dict(name='PAH hydrocarbon emission', formula='PAH 3.3µm', center=3.29, band=[3.25,3.33],
         left=[3.10,3.22], right=[3.36,3.48], color='#e274a4', kind='emission',
         caution='Aromatic C-H stretching emission common in irradiated dust and young stellar circumstellar disks.'),
    dict(name='Methane-related absorption', formula='CH4', center=3.30, band=[3.20,3.40],
         left=[3.00,3.16], right=[3.54,3.72], color='#c7a5ff',
         caution='Water and other carbon-bearing material can overlap this region.'),
    dict(name='Methanol-related absorption', formula='CH3OH', center=3.53, band=[3.49,3.57],
         left=[3.37,3.46], right=[3.63,3.75], color='#f0c58a',
         caution='This narrow feature may be unresolved and blended at SPHEREx resolution.'),
    dict(name='Carbon-dioxide-related absorption', formula='CO2', center=4.27, band=[4.23,4.30],
         left=[4.08,4.18], right=[4.34,4.40], color='#a5edcc',
         caution='Gas, ice, foreground absorption and source-related absorption are not distinguished.'),
    dict(name='Carbon-monoxide-related absorption', formula='CO', center=4.67, band=[4.61,4.74],
         left=[4.45,4.57], right=[4.81,4.95], color='#f4a6a0',
         caution='This can arise in a stellar atmosphere or intervening material, not necessarily ice.'),
]
REFERENCES = [
    'https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/',
    'https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/',
    'https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html',
    'https://science.nasa.gov/asset/webb/chamaeleon-i-dark-cloud-nircam-nirspec-and-miri-spectra/',
    'https://www.ipac.caltech.edu/Outreach/Edu/Spectra/irspec_ssys.html',
    'https://earthsciences.gsfc.nasa.gov/691/cosmicice/spectra.html',
]


def forced_fit(signal, variance, profile, background_variance, conversion, mask):
    """Weighted linear point-source amplitude; background uncertainty is shared."""
    good = mask & np.isfinite(signal) & np.isfinite(variance) & (variance > 0)
    denominator = float(np.sum(profile[good]**2 / variance[good]))
    if denominator <= 0 or np.count_nonzero(good) < 4:
        raise ValueError('Too few valid pixels for a source fit.')
    flux = float(np.sum(profile[good]*signal[good]/variance[good])/denominator)
    bg_factor = float(np.sum(profile[good]*conversion[good]/variance[good])/denominator)
    error = math.sqrt(1/denominator + background_variance*bg_factor**2)
    residual = signal - flux*profile
    fit_quality = float(np.mean(np.abs(residual[good])/np.sqrt(variance[good])))
    return flux, error, fit_quality


def measurement(record, sky):
    base = {k: record[k] for k in ('id','detector','timestamp','mjd','release','sha256','fits_url')}
    base.update(source=record.get('source'),accepted=False)
    release = record['release'].split('_')[0].lower()
    if release not in ('qr2','qr3','dr1'):
        return dict(base,reason='No validated science calibration adapter for this release.')
    with fits.open(record['path'], memmap=False) as hdus:
        header = hdus['IMAGE'].header
        if str(header.get('BUNIT','')).replace(' ','') != 'MJy/sr':
            return dict(base,reason='Unrecognized brightness units.')
        x,y = [float(v) for v in WCS(header).celestial.world_to_pixel(sky)]
        if not np.isfinite(x+y):
            return dict(base,reason='Position does not map into this image.')
        ix,iy = int(round(x)),int(round(y))
        height,width = hdus['IMAGE'].shape
        if ix < 7 or iy < 7 or ix+7 >= width or iy+7 >= height:
            return dict(base,reason='Insufficient image around the source for background estimation.')
        ys,xs = slice(iy-7,iy+8),slice(ix-7,ix+8)
        data = np.array(hdus['IMAGE'].section[ys,xs],dtype=float)
        variance = np.array(hdus['VARIANCE'].section[ys,xs],dtype=float)
        flags = np.array(hdus['FLAGS'].section[ys,xs],dtype=np.int64)
        yy,xx = np.mgrid[iy-7:iy+8,ix-7:ix+8]
        ox = x + 1 - float(header.get('CRPIX1A',1))
        oy = y + 1 - float(header.get('CRPIX2A',1))
        original_x = xx + 1 - float(header.get('CRPIX1A',1))
        original_y = yy + 1 - float(header.get('CRPIX2A',1))
        if np.any(original_x < 0) or np.any(original_y < 0) or np.any(original_x > 2039) or np.any(original_y > 2039):
            return dict(base,reason='Background region extends beyond the detector.')
        detector=record['detector']
        (cwave,cband), wave_prov = calibrations.load(release,'spectral_wcs',detector)
        area,area_prov = calibrations.load(release,'solid_angle_pixel_map',detector)
        (table,epsf_header),psf_prov = calibrations.load('dr1' if release=='dr1' else 'qr3','epsf',detector)
        oi,oj = int(round(ox)),int(round(oy))
        if not (0 <= oi < cwave.shape[1] and 0 <= oj < cwave.shape[0]):
            return dict(base,reason='Position falls outside calibration array bounds.')
        wave,bw = float(cwave[oj,oi]),float(cband[oj,oi])
        if not (math.isfinite(wave) and math.isfinite(bw) and bw > 0):
            return dict(base,reason='Missing science wavelength calibration.')
        zones = (table['XCENTER']-ox)**2 + (table['YCENTER']-oy)**2
        zone=int(np.argmin(zones))
        model=ImagePSF(data=np.array(table['EPSF'][zone],dtype=float),
                       oversampling=(int(epsf_header['OVSMPY']),int(epsf_header['OVSMPX'])))
        profile=np.asarray(model.evaluate(xx,yy,flux=1,x_0=x,y_0=y),dtype=float)
        profile=np.maximum(profile,0)
        if profile.sum() <= 0:
            return dict(base,reason='Invalid ePSF model.')
        profile /= profile.sum()
        radius=np.hypot(xx-x, yy-y)
        valid=np.isfinite(data)&np.isfinite(variance)&(variance>0)&((flags&REJECT_MASK)==0)
        annulus=(radius>=4.5)&(radius<=7)&valid&((flags&(1<<21))==0)
        background_samples=sigma_clip(data[annulus],sigma=3,maxiters=5).compressed()
        background_caution=False
        if len(background_samples)<12:
            # Some bright-source masks cover the entire surrounding area. Still
            # show an exploratory measurement, but exclude it from chemistry.
            annulus=(radius>=4.5)&(radius<=7)&valid
            background_samples=sigma_clip(data[annulus],sigma=3,maxiters=5).compressed()
            background_caution=True
        if len(background_samples)<6:
            annulus=(radius>=4.5)&(radius<=7)&np.isfinite(data)&np.isfinite(variance)&(variance>0)
            background_samples=sigma_clip(data[annulus],sigma=3,maxiters=5).compressed()
            background_caution=True
        if len(background_samples)<4:
            return dict(base,reason='Too few unflagged background pixels outside nearby sources.')
        background=float(np.median(background_samples))
        scatter=float(1.4826*np.median(np.abs(background_samples-background)))
        background_var=math.pi/2*max(scatter**2,float(np.median(variance[annulus])))/len(background_samples)
        solid=area[np.rint(original_y).astype(int),np.rint(original_x).astype(int)]
        conversion=np.asarray(solid,dtype=float)*(math.pi/(180*3600))**2*1e12
        signal=(data-background)*conversion
        errors=variance*conversion**2
        aperture=radius<=3
        fitting=valid&aperture&np.isfinite(conversion)&(conversion>0)
        if np.count_nonzero(fitting)<4:
            # Saturated or persistence-flagged bright-source core fallback
            relaxed_reject=BAD_MASK | sum(1 << b for b in (1, 14, 20, 22, 23, 24, 25))
            relaxed_valid=np.isfinite(data)&np.isfinite(variance)&(variance>0)&((flags&relaxed_reject)==0)
            relaxed_fitting=relaxed_valid&(radius<=4.0)&np.isfinite(conversion)&(conversion>0)
            if np.count_nonzero(relaxed_fitting)>=4:
                fitting=relaxed_fitting
                background_caution=True
        try:
            flux,error,fit_quality=forced_fit(signal,errors,profile,background_var,conversion,fitting)
        except ValueError as error:
            return dict(base,reason=str(error))
        fraction=float(profile[fitting].sum()/max(profile[aperture].sum(),1e-9))
        merged_flags=int(np.bitwise_or.reduce(flags[aperture]))
        good=((fraction>=.90) or (background_caution and np.count_nonzero(fitting)>=4)) and error>0 and np.isfinite(flux+error)
        reasons=[]
        if background_caution: reasons.append('Bright core/persistence flags relaxed; exploratory point-source fit')
        if fraction<.90 and not background_caution: reasons.append('Flagged or missing source pixels')
        if fit_quality>3 and not background_caution: reasons.append('Poor point-source fit: check centering, blending or extended emission')
        if not (error>0 and np.isfinite(flux+error)): reasons.append('Non-finite or invalid brightness uncertainty')
        return dict(base,wavelength=wave,bandwidth=bw,flux=finite(flux),flux_error=finite(error),
            signal_to_noise=finite(flux/error),fit_quality=fit_quality,accepted=bool(good),
            chemical_eligible=bool(good and not background_caution),background_caution=background_caution,
            reason='; '.join(reasons),flags=merged_flags,flag_details=flag_details(merged_flags),
            valid_psf_fraction=fraction,background_mjy_sr=background,native_pixel=[x,y],
            ra=float(sky.ra.deg),dec=float(sky.dec.deg),calibrations=[wave_prov,area_prov,psf_prov])


def feature_candidates(points, redshift=0):
    """Screen for absorption with a fitted local continuum. Not a template ID."""
    results=[]
    valid=[p for p in points if p.get('chemical_eligible',p.get('accepted')) and p.get('flux_error',0)>0]
    for feature in FEATURES:
        best=None
        for release in sorted({p['release'] for p in valid}):
            records=sorted([p for p in valid if p['release']==release],key=lambda p:p['mjd'])
            groups=[]
            for point in records:
                if not groups or point['mjd']-groups[-1][0]['mjd']>14:
                    groups.append([])
                groups[-1].append(point)
            for group in groups:
                def within(bounds):
                    return [p for p in group if bounds[0]<=p['wavelength']/(1+redshift)<=bounds[1]]
                band,left,right=[within(feature[k]) for k in ('band','left','right')]
                if min(len(band),len(left),len(right))<2:
                    continue
                if len({p['detector'] for p in band+left+right}) != 1:
                    continue
                if np.median([p['bandwidth']/(1+redshift) for p in band]) > feature['band'][1]-feature['band'][0]:
                    continue
                continuum=left+right
                waves=np.array([p['wavelength']/(1+redshift) for p in continuum])
                # Require distinct sampled wavelengths on both sides, not duplicate points.
                if len(np.unique(np.round(waves,3)))<3:
                    continue
                flux=np.array([p['flux'] for p in continuum])
                err=np.array([p['flux_error'] for p in continuum])
                design=np.column_stack([np.ones(len(waves)),waves-feature['center']])
                try:
                    covariance=np.linalg.inv((design/err[:,None]).T@(design/err[:,None]))
                except np.linalg.LinAlgError:
                    continue
                coefficients=covariance@(design.T@(flux/err**2))
                observed=np.array([p['flux'] for p in band])
                weights=1/np.array([p['flux_error'] for p in band])**2
                band_wave=float(np.average([p['wavelength']/(1+redshift) for p in band],weights=weights))
                vector=np.array([1,band_wave-feature['center']])
                level=float(vector@coefficients)
                level_var=float(vector@covariance@vector)
                residual=flux-design@coefficients
                continuum_scatter=float(np.sqrt(np.average(residual**2,weights=1/err**2)))
                # Include a conservative 5% continuum floor and measured model scatter.
                total_var=1/weights.sum()+level_var+max((.05*level)**2,continuum_scatter**2)
                measured=float(np.average(observed,weights=weights))
                if level<=0 or level/math.sqrt(max(level_var,1e-30))<10:
                    continue
                is_emission = feature.get('kind') == 'emission'
                significance = (measured-level)/math.sqrt(total_var) if is_emission else (level-measured)/math.sqrt(total_var)
                depth = (measured-level)/level if is_emission else (level-measured)/level
                evidence = dict(significance=float(significance),depth=float(depth),continuum=level,
                    measured=measured,release=release,start_mjd=min(p['mjd'] for p in band+continuum),
                    end_mjd=max(p['mjd'] for p in band+continuum),points=len(band+continuum),
                    observation_ids=[p['id']+f"D{p['detector']}" for p in band+continuum])
                if best is None or significance>best['significance']:
                    best = evidence
        is_emission = feature.get('kind') == 'emission'
        candidate = best is not None and best['significance'] >= (3.5 if is_emission else 5) and (best['depth'] > 0 if is_emission else 0 < best['depth'] < 1)
        if candidate:
            status_text = 'Candidate emission feature' if is_emission else 'Candidate absorption feature'
        elif best:
            status_text = 'No significant peak in tested windows' if is_emission else 'No significant dip in the tested windows'
        else:
            status_text = 'Insufficient clean coverage / resolution'
        results.append(dict(feature, candidate=bool(candidate),evidence=best, status=status_text))
    return results


def extract(records, ra, dec, cache, progress=lambda value:None, start_mjd=None, end_mjd=None, redshift=0, resolve=None, track_points=None, track_object=None):
    sky=coordinate(ra,dec)
    if not math.isfinite(redshift) or not 0<=redshift<=5:
        raise ValueError('Reference redshift must be between 0 and 5.')
    track_lookup = {}
    if track_points:
        for p in track_points:
            if p.get('id'): track_lookup[str(p['id'])] = p
            if p.get('sha256'): track_lookup[str(p['sha256'])] = p
            if 'index' in p: track_lookup[f"idx_{p['index']}"] = p
    selected=[]
    for r in records:
        if start_mjd is not None and r['mjd']<start_mjd: continue
        if end_mjd is not None and r['mjd']>end_mjd: continue
        if track_points:
            selected.append(r)
        elif sky.separation(SkyCoord(*r['center'],unit='deg')).deg <= r['radius_deg']:
            selected.append(r)
    dedup={}
    for r in sorted(selected,key=reduction_priority,reverse=True):
        dedup.setdefault((r['id'],r['detector']),r)
    if resolve: resolve(dedup)  # fetch pixels for index-only observations
    calibration_index=json.loads((calibrations.CACHE/'index.json').read_text()) if (calibrations.CACHE/'index.json').exists() else {'products':calibrations.discover()}
    signature=[METHOD,float(sky.ra.deg),float(sky.dec.deg),redshift,start_mjd,end_mjd,
               sorted(r['sha256'] for r in dedup.values()),calibration_index['products'],
               track_object,len(track_points) if track_points else 0]
    key=hashlib.sha256(json.dumps(signature,sort_keys=True).encode()).hexdigest()
    directory=cache/'spectra';directory.mkdir(exist_ok=True)
    path=directory/f'{key}.json'
    if path.exists(): return json.loads(path.read_text())
    points=[]
    for index,record in enumerate(sorted(dedup.values(),key=lambda r:r['mjd'])):
        progress(f"Measuring light in observation {index+1} of {len(dedup)}")
        try:
            if not record.get('path'): raise FileNotFoundError('Observation could not be fetched from the archive, or does not cover this position.')
            tp = track_lookup.get(str(record.get('id'))) or track_lookup.get(str(record.get('sha256'))) or track_lookup.get(f"idx_{index}") if track_points else None
            if tp is not None:
                if tp.get('accepted') and tp.get('ra') is not None:
                    target_sky = coordinate(tp['ra'], tp['dec'])
                    pt = measurement(record, target_sky)
                    pt.update(tracking_linked=True, prediction_only=False, tracked_ra=tp['ra'], tracked_dec=tp['dec'])
                elif tp.get('predicted_sky'):
                    target_sky = coordinate(tp['predicted_sky'][0], tp['predicted_sky'][1])
                    pt = measurement(record, target_sky)
                    pt.update(tracking_linked=True, prediction_only=True, tracked_ra=tp['predicted_sky'][0], tracked_dec=tp['predicted_sky'][1])
                else:
                    base = {k: record[k] for k in ('id','detector','timestamp','mjd','release','sha256','fits_url')}
                    base.update(source=record.get('source'), accepted=False, tracking_linked=True,
                                reason=tp.get('reason') or 'Tracked target moved outside exposure footprint.')
                    pt = base
            else:
                pt = measurement(record, sky)
            points.append(pt)
        except Exception as error:
            points.append(dict(id=record['id'],detector=record['detector'],timestamp=record['timestamp'],
                mjd=record['mjd'],release=record['release'],accepted=False,reason=str(error)))
    notes=['Single-source forced fit using official ePSF, CWAVE/CBAND and pixel-area products.',
           'Every plotted point is extracted from a real FITS observation; error bars are statistical estimates.',
           'Different wavelengths can be measured on different dates. Variability can imitate spectral features.',
           'Nearby sources are not jointly deblended. High proper-motion sources need epoch-correct coordinates.',
           'Candidate screening uses a local straight-line continuum and absorption/emission windows, not full laboratory-template fitting.',
           'A candidate is not a confirmed chemical identification, phase determination or abundance estimate.',
           'Feature tests keep releases separate and use observations within 14 days; significance is not a probability.']
    if track_points:
        notes.insert(0, f"Tracking-linked forced photometry followed {track_object or 'the target'} across exposures instead of a static sky position.")
        notes.insert(1, "Exposures where the target moved outside the field are excluded; predictions without centroid fits are marked prediction-only.")
    result=dict(id=key,method=METHOD,created_utc=Time.now().isot+'Z',ra=float(sky.ra.deg),dec=float(sky.dec.deg),
        unit='microJy',redshift=redshift,points=points,candidates=feature_candidates(points,redshift),
        references=REFERENCES,calibration_checked_utc=calibration_index.get('checked_utc'),
        tracking_linked=bool(track_points), track_object=track_object,
        notes=notes)
    write_json(path,result)
    return result
