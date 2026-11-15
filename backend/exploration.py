"""Computed educational travel and source context. Never a navigation ephemeris."""
import json, time
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.time import Time
from astropy.utils import iers
iers.conf.auto_download=False
from fastapi import HTTPException
from .archive import ROOT,CACHE,CONFIG,key_for,atomic_json
from .catalogs import tap_query,number
from .solar import solar_snapshot,ecliptic

def journey_context(ra=None,dec=None,distance_pc=None,body=None,date='2026-11-09'):
    solar=solar_snapshot(date);earth=next(r for r in solar['objects'] if r['id']=='earth')
    if body:
        row=next((r for r in solar['objects'] if r['id']==body),None)
        if row is None or body=='earth':raise ValueError('Select an object away from Earth.')
        ra,dec=row['ra'],row['dec'];distance_au=float(np.linalg.norm(np.array(row['xyz_au'])-earth['xyz_au']));name=row['name']
    else:
        if ra is None or dec is None or not 0<=ra<360 or not -90<=dec<=90:raise ValueError('A catalog sky direction is required.')
        if distance_pc is None or not np.isfinite(distance_pc) or distance_pc<=0:raise ValueError('A measured distance is required.')
        distance_au=float(distance_pc*206264.806247);name=None
    coo=SkyCoord(ra,dec,unit='deg');constellation=coo.get_constellation()
    # Virtual observer directly beneath this direction. A chart, not weather or a local horizon forecast.
    epoch=Time(date+'T00:00:00')
    orientation_note='Earth orientation from the installed IERS table.'
    try:
        gst=epoch.sidereal_time('mean','greenwich').deg
    except ValueError as error:
        if 'IERS' not in str(error):
            raise
        # Only the illustrative landing longitude needs Earth rotation. Keep
        # measured directions/distances and the planetary ephemeris unchanged.
        epoch.delta_ut1_utc=0.0
        gst=epoch.sidereal_time('mean','greenwich').deg
        orientation_note='Illustrative Earth longitude uses UT1 approximately equal to UTC because the installed Earth-orientation table has expired.'
    return dict(ra=float(ra),dec=float(dec),constellation=constellation,name=name,distance_au=distance_au,light_time_years=distance_au/63241.077,earth_xyz_au=earth['xyz_au'],date=solar['date'],observer_latitude=float(dec),observer_longitude=float((ra-gst+180)%360-180),direction_ecliptic=ecliptic(coo.cartesian.xyz.value).tolist(),provenance='computed',earth_orientation_note=orientation_note,notes=['Accelerated camera journey; epoch frozen. Not a physical spacecraft trajectory.','At Earth the view is a computed sky-direction chart. Constellation is assigned using IAU boundaries, not invented connecting lines.','Catalog stellar direction and distance remain at their catalog epochs. Surface appearance is a labeled simulation; individual stellar features are unresolved.',orientation_note])

def install_exploration_routes(app):
    @app.get('/api/journey')
    def journey(ra:float|None=None,dec:float|None=None,distance_pc:float|None=None,body:str|None=None,date:str='2026-11-09'):
        try:return journey_context(ra,dec,distance_pc,body,date)
        except ValueError as e:raise HTTPException(422,str(e))
    @app.get('/api/earth-sky')
    def earth_sky(ra:float,dec:float):
        if not 0<=ra<360 or not -90<=dec<=90:raise HTTPException(422,'Invalid sky coordinates.')
        q=f"SELECT TOP 160 source_id,ra,dec,phot_g_mean_mag,bp_rp FROM {CONFIG['gaia_table']} WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{ra:.7f},{dec:.7f},18)) AND phot_g_mean_mag<9 ORDER BY phot_g_mean_mag ASC"
        file=CACHE/('earth-sky-'+key_for(q)+'.json')
        if file.exists():return json.loads(file.read_text())
        try:
            t=tap_query(CONFIG['gaia_tap_endpoint'],q,160,timeout=12)
            rows=[{k:number(r[k]) for k in ['ra','dec','phot_g_mean_mag','bp_rp']} for r in t]
            result=dict(objects=rows,provenance='catalog',epoch=2016.0,note='Gaia DR3, G < 9, brightest 160 within 18 degrees. An incomplete sky sample; chart brightness is adapted for legibility. Atmosphere omitted.')
            atomic_json(file,result);return result
        except Exception:
            # Genuine cached Gaia subset, clipped to this exact angular footprint.
            # Never imply that a nearby-volume sample is the complete sky field.
            rows={}
            for candidate in CACHE.glob('gaia-*.json'):
                try:
                    result=json.loads(candidate.read_text())
                    if 'parallax >=' not in result.get('query',''):continue
                    for row in result.get('rows',[]):
                        if row.get('phot_g_mean_mag') is None or row['phot_g_mean_mag']>=9:continue
                        if SkyCoord(ra,dec,unit='deg').separation(SkyCoord(row['ra'],row['dec'],unit='deg')).deg<=18:
                            rows[row['id']]={k:row.get(k) for k in ['ra','dec','phot_g_mean_mag','bp_rp']}
                except (ValueError,KeyError,OSError):continue
            if rows:return dict(objects=sorted(rows.values(),key=lambda r:r['phot_g_mean_mag'])[:160],provenance='catalog',epoch=2016.0,partial=True,note='Live Gaia full-field query failed. Showing only genuine cached nearby Gaia sources inside this footprint: a sparse, incomplete subset, not a full constellation star field. Atmosphere omitted.')
            raise HTTPException(503,'Gaia sky chart is unavailable. The target direction and IAU constellation remain computable; no substitute stars are shown.')
