"""Build a reproducible 3D sample from public DESI DR1 and Gaia DR3 catalogs."""
from io import BytesIO
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1]/'work/deps'))
import numpy as np
import requests
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.cosmology import Planck18
from astropy.io.votable import parse_single_table
from astropy.time import Time
from archive import write_json

OUT = ROOT/'catalogs'
OUT.mkdir(exist_ok=True)
WORK = ROOT.parents[1]/'work'
ENDPOINT = 'https://datalab.noirlab.edu/tap/sync'


def tap(query, name, endpoint=ENDPOINT):
    response = requests.post(endpoint, data={'REQUEST':'doQuery','LANG':'ADQL','QUERY':query,
        'FORMAT':'votable','MAXREC':20000}, timeout=(15,300))
    response.raise_for_status()
    if b'value="ERROR"' in response.content or b'OVERFLOW' in response.content:
        raise ValueError(response.text[:3000])
    (WORK/f'{name}-catalog.xml').write_bytes(response.content)
    return parse_single_table(BytesIO(response.content)).to_table(use_names_over_ids=True), hashlib.sha256(response.content).hexdigest()


def finite(value):
    if np.ma.is_masked(value):
        return None
    number = float(value)
    return number if np.isfinite(number) else None


def xyz(ra, dec, distance):
    a,d = np.deg2rad([ra,dec])
    return [float(distance*np.cos(d)*np.cos(a)), float(distance*np.cos(d)*np.sin(a)), float(distance*np.sin(d))]


def galaxies():
    query = """SELECT TOP 10000 targetid, desiname, mean_fiber_ra, mean_fiber_dec, z, zerr,
        deltachi2, zwarn, mean_mjd FROM desi_dr1.zpix
        WHERE spectype='GALAXY' AND zcat_primary='true' AND coadd_fiberstatus=0
        AND zwarn=0 AND deltachi2>40 AND z>0.01 AND z<1.0 ORDER BY random_id"""
    table,digest = tap(query,'desi')
    z=np.asarray(table['z'],dtype=float)
    distances=Planck18.comoving_distance(z).value
    lookbacks=Planck18.lookback_time(z).value
    records=[]
    for row,distance,lookback in zip(table,distances,lookbacks):
        ra,dec=float(row['mean_fiber_ra']),float(row['mean_fiber_dec'])
        dz=finite(row['zerr'])
        error=(299792.458/Planck18.H(float(row['z'])).value*dz) if dz is not None else None
        records.append(dict(id=str(row['targetid']), name=str(row['desiname']), type='Galaxy',
            ra=ra,dec=dec,redshift=float(row['z']),redshift_error=dz,
            distance=float(distance),distance_error=error,xyz=xyz(ra,dec,distance),
            lookback_gyr=float(lookback),quality_delta_chi2=float(row['deltachi2']),
            observed_mjd=finite(row['mean_mjd']),velocity=None))
    assert len(records)==10000 and len({r['id'] for r in records})==len(records)
    result=dict(kind='galaxies',source='DESI DR1 via NOIRLab Astro Data Lab',unit='Mpc',
        distance_kind='Comoving distance',created_utc=Time.now().isot+'Z',query=query,
        raw_sha256=digest,endpoint=ENDPOINT,records=records,epoch=None,
        cosmology=dict(name='Planck18',H0=float(Planck18.H0.value),Om0=float(Planck18.Om0)),
        source_url='https://data.desi.lbl.gov/doc/releases/dr1/',
        notes=['A 10,000-object catalog sample with redshift quality cuts, not a complete map.',
               'Survey coverage and selection affect apparent empty regions.',
               'Distances use Planck18 cosmology; errors shown propagate redshift errors only.',
               'Peculiar velocities and cosmology uncertainty are not included in those error bars.',
               'Observed light left different galaxies at different times. This is not a simultaneous snapshot.',
               'Galaxy peculiar velocities are not measured here and are not simulated.'])
    write_json(OUT/'galaxies.json',result)
    print('Saved',len(records),'real DESI galaxies',flush=True)


def stars():
    query="""SELECT TOP 5000 source_id, ra, dec, ref_epoch, parallax, parallax_error,
        pmra, pmdec, radial_velocity, radial_velocity_error, phot_g_mean_mag, bp_rp, ruwe
        FROM gaia_dr3.gaia_source WHERE parallax>5 AND parallax_over_error>20
        AND ruwe<1.4 AND pmra IS NOT NULL AND pmdec IS NOT NULL"""
    table,digest=tap(query,'gaia')
    records=[]
    for row in table:
        ra,dec,parallax=float(row['ra']),float(row['dec']),float(row['parallax'])
        distance=1000/parallax
        radial=finite(row['radial_velocity'])
        args=dict(ra=ra*u.deg,dec=dec*u.deg,distance=distance*u.pc,
            pm_ra_cosdec=float(row['pmra'])*u.mas/u.yr,pm_dec=float(row['pmdec'])*u.mas/u.yr,
            obstime=Time(float(row['ref_epoch']),format='jyear'))
        if radial is not None:
            args['radial_velocity']=radial*u.km/u.s
        sky=SkyCoord(**args)
        velocity=sky.velocity.d_xyz.to(u.pc/u.yr).value.tolist() if radial is not None else None
        propagated=sky.apply_space_motion(Time(2026.8,format='jyear'))
        records.append(dict(id=str(row['source_id']),name='Gaia DR3 '+str(row['source_id']),type='Star',
            ra=ra,dec=dec,epoch=float(row['ref_epoch']),distance=distance,
            distance_error=1000*float(row['parallax_error'])/parallax**2,
            parallax=parallax,parallax_error=float(row['parallax_error']),
            pmra=float(row['pmra']),pmdec=float(row['pmdec']),radial_velocity=radial,
            radial_velocity_error=finite(row['radial_velocity_error']),
            magnitude=finite(row['phot_g_mean_mag']),color=finite(row['bp_rp']),ruwe=float(row['ruwe']),
            xyz=xyz(ra,dec,distance),velocity=velocity,
            spherex_ra=float(propagated.ra.deg),spherex_dec=float(propagated.dec.deg),
            spherex_position_epoch=2026.8))
    assert len(records)==5000
    write_json(OUT/'stars.json',dict(kind='stars',source='Gaia DR3 via NOIRLab Astro Data Lab',unit='pc',
        distance_kind='Inverse-parallax distance',epoch=2016,created_utc=Time.now().isot+'Z',
        query=query,raw_sha256=digest,endpoint=ENDPOINT,records=records,
        source_url='https://www.cosmos.esa.int/web/gaia/data-release-3',
        notes=['5,000 sample stars within 200 pc, with high-significance parallaxes and RUWE < 1.4.',
               'Distance = 1000 / parallax in milliarcseconds. No parallax zero-point correction applied.',
               'Distance error is statistical only; this sample is not complete.',
               'Origin approximates the Sun with the Solar System barycenter; axes follow ICRS.',
               '3D motion is projected only where radial velocity is available.',
               'Future positions use straight-line motion, without orbital acceleration.']))
    print('Saved',len(records),'real Gaia stars',flush=True)


if __name__=='__main__':
    galaxies()
    stars()
