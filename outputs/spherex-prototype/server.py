"""Local SPHEREx prototype server. Run with Python, then open its printed URL."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import re
import sys
import threading
import traceback
from urllib.parse import parse_qs, urlencode, urlparse
import uuid

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent.parent
DEPS = WORKSPACE / 'work' / 'deps'
if DEPS.exists():
    sys.path.insert(0, str(DEPS))

import numpy as np
import requests
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.io.votable import parse_single_table
from astropy.time import Time
from astropy.wcs import WCS
from PIL import Image
from science import (PIPELINE, FLAG_SOURCE, fits_metadata, grid_for, inspect_pixel,
                     prepare_frame, render_frames, request_options)
from archive import query as archive_query, download as archive_download, write_json

DATA = ROOT.parent / 'spherex-viewer'
CACHE = WORKSPACE / 'work' / 'prototype-cache'
CACHE.mkdir(parents=True, exist_ok=True)
REGISTRY = CACHE / 'imports.json'
LOCK = threading.RLock()
POOL = ThreadPoolExecutor(max_workers=4)
JOBS = {}
CONFIG = json.loads((ROOT / 'archive-config.json').read_text())
LIBRARY = json.loads((DATA / 'data' / 'collection.json').read_text())
DETECTORS = json.loads((DATA / 'data' / 'detectors.js').read_text().split('=', 1)[1].strip().rstrip(';'))
RECORDS = []
FEATURED = CACHE / 'featured-library.json'
SESSION_INDEX = CACHE / 'session-index.json'
FEATURED_STAMP = None
SESSIONS = json.loads(SESSION_INDEX.read_text()) if SESSION_INDEX.exists() else {}
VIEW_INDEX = CACHE / 'view-index'
VIEW_INDEX.mkdir(exist_ok=True)


def atomic_json(path, data):
    write_json(path, data)


def initialize():
    for field in LIBRARY['fields']:
        for frame in field['frames']:
            path = DATA / frame['fits']
            meta = fits_metadata(path)
            if meta['sha256'] != frame['sha256']:
                raise ValueError(f'Checksum mismatch for {path.name}')
            meta.update(path=str(path), release=frame['release'], source=frame['source'],
                        field_key=field['key'], field_name=field['name'],
                        provenance='Official archive download; checksum verified',
                        fits_url='/' + frame['fits'], context=[])
            for view in DETECTORS.get(frame['id'], []):
                meta['context'].append(dict(view, jpeg='/'+view['jpeg']))
            if frame.get('marker'):
                with Image.open(DATA / frame['png']) as image:
                    size = image.width
                grid = WCS(naxis=2)
                grid.wcs.ctype = ['RA---TAN', 'DEC--TAN']
                grid.wcs.crval = [field['ra'], field['dec']]
                grid.wcs.crpix = [(size+1)/2]*2
                grid.wcs.cdelt = [-6.15/3600, 6.15/3600]
                sky = grid.pixel_to_world(frame['marker'][0]*size-.5, (1-frame['marker'][1])*size-.5)
                meta['marker_sky'] = [float(sky.ra.deg), float(sky.dec.deg)]
            RECORDS.append(meta)
    if REGISTRY.exists():
        RECORDS.extend(json.loads(REGISTRY.read_text()))
    refresh_featured()


def refresh_featured():
    """Pick up a background sync without requiring a server restart."""
    global FEATURED_STAMP
    with LOCK:
        stamp = FEATURED.stat().st_mtime_ns if FEATURED.exists() else None
        if stamp != FEATURED_STAMP:
            catalog = json.loads(FEATURED.read_text())
            RECORDS[:] = [r for r in RECORDS if not r.get('featured_cache')]
            RECORDS.extend(dict(r, featured_cache=True) for r in catalog['records'])
            FEATURED_STAMP = stamp


def imported_records(records):
    with LOCK:
        current = json.loads(REGISTRY.read_text()) if REGISTRY.exists() else []
        known = {r['sha256'] for r in RECORDS}
        new = [record for record in records if record['sha256'] not in known]
        atomic_json(REGISTRY, current + new)
        RECORDS.extend(new)


def fetch_archive(options, progress):
    progress(f"Querying IRSA archive for D{options['detector']} observations…")
    rows = archive_query(CONFIG, options['ra'], options['dec'],
                         options['fov']/60/2*2**.5, options['start_mjd'], options['end_mjd'])
    rows = [r for r in rows if r['detector'] == options['detector']]
    if not rows:
        return [], 0, []
    records, failures = [], []
    progress(f"Downloading 0 of {len(rows)} observations from IRSA…")
    with ThreadPoolExecutor(max_workers=min(6, len(rows))) as download_pool:
        futures = {
            download_pool.submit(archive_download, row, options['ra'], options['dec'], options['fov'], CACHE): row
            for row in rows
        }
        completed = 0
        for future in as_completed(futures):
            row = futures[future]
            try:
                records.append(future.result())
            except Exception as error:
                failures.append(f"{row['id']}: {error}")
            completed += 1
            progress(f"Downloading observation {completed} of {len(rows)}")
    imported_records(records)
    return records, len(rows), failures


def cutout_covers_field(record, grid, size):
    """Check the requested square against the actual saved FITS footprint."""
    corners = grid.pixel_to_world(np.array([0, 0, size-1, size-1]),
                                  np.array([0, size-1, 0, size-1]))
    with fits.open(record['path'], memmap=False) as hdus:
        shape = hdus['IMAGE'].data.shape
        x, y = WCS(hdus['IMAGE'].header).celestial.world_to_pixel(corners)
    return bool(np.all(np.isfinite(x)) and np.all(np.isfinite(y))
                and np.all((x >= 0) & (x < shape[1]))
                and np.all((y >= 0) & (y < shape[0])))


def wider_cutout(record, options):
    expanded = archive_download(record, options['ra'], options['dec'], options['fov'], CACHE)
    imported_records([expanded])
    return expanded


def session_key(options, records):
    identities = sorted((r['id'], r['detector'], r['sha256'], r.get('marker_sky')) for r in records)
    return hashlib.sha256(json.dumps([PIPELINE, options, identities], sort_keys=True).encode()).hexdigest()


def create_session(job_id, payload):
    def progress(message):
        with LOCK:
            JOBS[job_id].update(stage=message)
    try:
        options = request_options(payload)
        refresh_featured()
        progress('Reading calibrated FITS data')
        archive_total = None
        failures = []
        if payload.get('source') == 'archive':
            records, archive_total, failures = fetch_archive(options, progress)
        else:
            with LOCK:
                records = list(RECORDS)
        records = [r for r in records if r['detector'] == options['detector']
                   and (options['start_mjd'] is None or r['mjd'] >= options['start_mjd'])
                   and (options['end_mjd'] is None or r['mjd'] < options['end_mjd'])]
        search_center = SkyCoord(options['ra'], options['dec'], unit='deg')
        search_radius = options['fov'] / 60 / 2 * 2**.5
        records = [r for r in records if search_center.separation(SkyCoord(*r['center'], unit='deg')).deg
                   <= r['radius_deg'] + search_radius]
        # Keep one reduction per physical observation. All alternatives remain in the library.
        dedup = {}
        for record in sorted(records, key=lambda r: (r.get('processed_mjd', 0), r['release'], r.get('file_bytes', 0)), reverse=True):
            dedup.setdefault((record['id'], record['detector']), record)
        key = session_key(options, list(dedup.values()))
        cached_id = SESSIONS.get(key)
        if (VIEW_INDEX / f'{key}.json').exists():
            cached_id = json.loads((VIEW_INDEX / f'{key}.json').read_text())['session']
        if payload.get('source') != 'archive' and cached_id and (CACHE/cached_id/'manifest.json').exists():
            manifest = json.loads((CACHE/cached_id/'manifest.json').read_text())
            with LOCK:
                JOBS[job_id].update(status='complete', stage='Ready from local cache', result=manifest)
            return
        grid, size = grid_for(options)
        yy, xx = np.indices((size, size))
        grid_sky = grid.pixel_to_world(xx, yy)
        prepared = []
        excluded = []
        wider_views = 0
        candidates = sorted(dedup.values(), key=lambda r: r['mjd'])
        for index, record in enumerate(candidates):
            try:
                # A padded source already requested for this center cannot recover
                # pixels beyond the original detector edge. Do not download it repeatedly.
                padded = (record.get('download_center') == [options['ra'], options['dec']]
                          and record.get('requested_source_width_deg', 0) >= options['fov']/60*1.5 - 1e-8)
                if not padded and not cutout_covers_field(record, grid, size) and record.get('source'):
                    progress(f"Fetching a wider image for {record['timestamp'][:10]}")
                    record = wider_cutout(record, options)
                    dedup[(record['id'], record['detector'])] = record
                    wider_views += 1
                if len(candidates) > 1:
                    progress(f"Aligning FITS frame {index+1} of {len(candidates)}")
                frame = prepare_frame(record, options, grid, size, grid_sky=grid_sky)
                if frame:
                    metadata = frame[2]
                    if not metadata['center_inside'] or metadata['footprint_coverage'] < 99 or metadata['coverage'] < 80:
                        excluded.append({
                            'id': record['id'], 'timestamp': record['timestamp'],
                            'detector': record['detector'], 'release': record['release'],
                            'coverage': metadata['coverage'], 'footprint_coverage': metadata['footprint_coverage'],
                            'source': record.get('source'), 'fits_url': record['fits_url'],
                            'reason': ('The telescope pointed partly outside this field; its detector did not record the missing sky. Try a smaller field.'
                                       if metadata['footprint_coverage'] < 99 or not metadata['center_inside'] else
                                       'The detector covered the field, but more than 20% of its brightness values are missing or invalid.'),
                        })
                    else:
                        prepared.append(frame)
            except Exception as error:
                failures.append(f"{record['id']}: {error}")
        limited = False
        units = {item[2]['unit'] for item in prepared}
        if len(units) > 1:
            raise ValueError('These images have different units and cannot share a display scale.')
        progress('Rendering aligned frames with a shared brightness scale')
        directory = CACHE / job_id
        directory.mkdir(exist_ok=True)
        stretch = render_frames(prepared, directory) if prepared else None
        frames = []
        for _, _, meta in prepared:
            meta.update(preview=f"/cache/{job_id}/{meta['index']}.png",
                        quality_overlay=f"/cache/{job_id}/{meta['index']}-quality.png")
            frames.append(meta)
        manifest = {'id': job_id, 'pipeline': PIPELINE, 'created_utc': Time.now().isot+'Z',
                    'options': options, 'size': size, 'frames': frames, 'stretch': stretch,
                    'archive_matches': archive_total, 'limited': limited, 'failures': failures,
                    'wider_views': wider_views,
                    'excluded_frames': excluded,
                    'coverage_policy': {'minimum_footprint_percent': 99, 'minimum_valid_pixels_percent': 80},
                    'empty_reason': ('' if prepared else (
                        'No complete frames for this selection. Try a smaller field or another detector. Partial observations are listed below.'
                        if excluded else
                        'No locally cached observations cover this position for the selected detector and dates. Try another detector, clear dates, or click Search IRSA.'
                    )),
                    'flag_source': FLAG_SOURCE, 'science_status': 'Visual inspection; native pixel readouts',
                    'notes': ['All dates use the same ICRS sky grid and display scale.',
                              'Wavelengths are approximate WCS-WAVE values at the requested center.',
                              'Source movement and brightness fits require further calibration and validation.']}
        atomic_json(directory / 'manifest.json', manifest)
        with LOCK:
            key = session_key(options, list(dedup.values()))
            SESSIONS[key] = job_id
            # A separate entry per view avoids overwriting other processes' caches.
            atomic_json(VIEW_INDEX / f'{key}.json', {'session': job_id})
            JOBS[job_id].update(status='complete', stage='Ready', result=manifest)
    except Exception as error:
        traceback.print_exc()
        with LOCK:
            JOBS[job_id].update(status='failed', stage=str(error))


def create_spectrum(job_id, payload):
    try:
        from spectroscopy import extract
        session_id = str(payload.get('session',''))
        if not re.fullmatch('[a-f0-9]{32}', session_id):
            raise ValueError('Open a sky view before measuring its light.')
        manifest=json.loads((CACHE/session_id/'manifest.json').read_text())
        frame=manifest['frames'][int(payload.get('frame',0))]
        x,y=float(payload.get('x',.5)),float(payload.get('y',.5))
        if not (0<=x<1 and 0<=y<1):
            raise ValueError('Select a point inside the sky image.')
        grid,size=grid_for(manifest['options'])
        sky=grid.pixel_to_world(x*size-.5,(1-y)*size-.5)
        scope=payload.get('scope','near')
        start,end=manifest['options']['start_mjd'],manifest['options']['end_mjd']
        if scope=='near':
            start,end=frame['mjd']-7,frame['mjd']+7
        elif scope=='all':
            start,end=None,None
        elif scope!='dates':
            raise ValueError('Unknown measurement time range.')
        refresh_featured()
        with LOCK:
            records=list(RECORDS)
        def progress(message):
            with LOCK:
                JOBS[job_id].update(stage=message)
        result=extract(records,sky.ra.deg,sky.dec.deg,CACHE,progress,start,end,float(payload.get('redshift',0)))
        result['scope']=scope
        with LOCK:
            JOBS[job_id].update(status='complete',stage='Light measurements ready',result=result)
    except Exception as error:
        traceback.print_exc()
        with LOCK:
            JOBS[job_id].update(status='failed',stage=str(error))


def create_track(job_id, payload):
    try:
        from tracking import track
        sid=str(payload.get('session',''))
        if not re.fullmatch('[a-f0-9]{32}',sid): raise ValueError('Open a sky view first.')
        manifest=json.loads((CACHE/sid/'manifest.json').read_text())
        refresh_featured()
        with LOCK: lookup={r['sha256']:r for r in RECORDS}
        paths=[]
        for frame in manifest['frames']:
            rec=lookup.get(frame['sha256'])
            path=rec['path'] if rec else None
            if path is None:
                filename=frame['fits_url'].removeprefix('/cache/')
                if not re.fullmatch(r'[a-f0-9]{64}\.fits',filename): raise ValueError('Original FITS unavailable')
                path=str(CACHE/filename)
            paths.append(path)
        def progress(message):
            with LOCK: JOBS[job_id].update(stage=message)
        result=track(manifest,paths,payload,CACHE,progress)
        with LOCK: JOBS[job_id].update(status='complete',stage='Track ready',result=result)
    except Exception as error:
        from ephemeris import EphemerisError
        if not isinstance(error,EphemerisError): traceback.print_exc()
        with LOCK: JOBS[job_id].update(status='failed',stage=str(error))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def json_response(self, data, status=200):
        content = json.dumps(data, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(content)

    def translate_path(self, path):
        clean = urlparse(path).path
        for prefix, directory in (('/cache/', CACHE), ('/data/', DATA/'data')):
            if clean.startswith(prefix):
                relative = clean[len(prefix):]
                target = (directory / relative).resolve()
                if not target.is_relative_to(directory.resolve()):
                    return str(ROOT / '_missing')
                return str(target)
        return super().translate_path(path)

    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == '/api/library':
                refresh_featured()
                fields = []
                with LOCK:
                    for field in LIBRARY['fields']:
                        found = {(r['id'],r['detector']):r for r in RECORDS if r['field_key'] == field['key']}
                        fields.append({k:v for k,v in field.items() if k != 'frames'} | {
                            'frames': len(found), 'detector': field['frames'][0]['detector'],
                            'detectors': {str(d):sum(r['detector']==d for r in found.values()) for d in range(1,7)},
                            'thumbnail': '/'+field['frames'][0]['png']})
                    imports = [{'ra': r['center'][0], 'dec': r['center'][1], 'detector': r['detector'],
                                'id': r['id'], 'release': r['release']} for r in RECORDS if r['field_key'] in ('imported', 'archive')]
                sync_path = CACHE/'sync-status.json'
                sync = json.loads(sync_path.read_text()) if sync_path.exists() else None
                return self.json_response({'fields': fields, 'imports': imports, 'config': CONFIG, 'pipeline': PIPELINE, 'sync': sync})
            if parsed.path.startswith('/api/jobs/'):
                job_id = parsed.path.rsplit('/', 1)[1]
                with LOCK:
                    job = JOBS.get(job_id)
                return self.json_response(job or {'error': 'Job not found'}, 200 if job else 404)
            if parsed.path == '/api/pixel':
                args = {k: v[0] for k, v in parse_qs(parsed.query).items()}
                session = args['session']
                if not re.fullmatch('[a-f0-9]{32}', session):
                    raise ValueError('Invalid session ID.')
                manifest = json.loads((CACHE/session/'manifest.json').read_text())
                frame = manifest['frames'][int(args['frame'])]
                with LOCK:
                    record = next((r for r in RECORDS if r['sha256'] == frame['sha256']), None)
                if record is None:
                    filename = frame['fits_url'].removeprefix('/cache/')
                    if not re.fullmatch(r'[a-f0-9]{64}\.fits', filename):
                        raise ValueError('The original source is no longer in this library.')
                    record = dict(frame, path=str(CACHE / filename))
                return self.json_response(inspect_pixel(record, manifest['options'], float(args['x']), float(args['y'])))
            return super().do_GET()
        except (ValueError, KeyError, IndexError, StopIteration, FileNotFoundError) as error:
            return self.json_response({'error': str(error)}, 400)

    def do_POST(self):
        try:
            # The local service only accepts writes from its own origin or CLI clients.
            origin = self.headers.get('Origin')
            if origin and origin != f"http://{self.headers.get('Host')}":
                return self.json_response({'error': 'Origin not allowed'}, 403)
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 85_000_000:
                raise ValueError('Request must contain data and fit within 85 MB.')
            payload = self.rfile.read(size)
            if self.path == '/api/import':
                release = self.headers.get('X-Release', 'Unspecified').strip()
                if not re.fullmatch('[A-Za-z0-9_. -]{1,30}', release):
                    raise ValueError('Release label must use letters, digits, spaces, dots or dashes.')
                digest = hashlib.sha256(payload).hexdigest()
                path = CACHE / (digest+'.fits')
                path.write_bytes(payload)
                try:
                    meta = fits_metadata(path)
                except Exception:
                    path.unlink(missing_ok=True)
                    raise ValueError('This file does not contain the required SPHEREx FITS structure.')
                meta.update(path=str(path), release=release, source=None,
                            provenance='User-supplied FITS; structure checked, origin unverified',
                            fits_url=f'/cache/{path.name}', context=[], field_key='imported', field_name='Imported FITS')
                imported_records([meta])
                return self.json_response({k: v for k, v in meta.items() if k != 'path'})
            if self.path == '/api/jobs':
                options = json.loads(payload)
                normalized = request_options(options)
                job_key = json.dumps({'source': options.get('source', 'saved'), **normalized}, sort_keys=True)
                with LOCK:
                    existing = next((jid for jid, job in JOBS.items()
                                     if job.get('status') == 'running' and job.get('job_key') == job_key), None)
                    if existing:
                        return self.json_response({'id': existing}, 202)
                    if sum(job['status'] == 'running' for job in JOBS.values()) >= 3:
                        return self.json_response({'error': 'Three requests are running. Wait for one to finish.'}, 429)
                    job_id = uuid.uuid4().hex
                    JOBS[job_id] = {'status': 'running', 'stage': 'Preparing request', 'id': job_id, 'job_key': job_key}
                POOL.submit(create_session, job_id, options)
                return self.json_response({'id': job_id}, 202)
            if self.path in ('/api/spectrum','/api/track'):
                options=json.loads(payload)
                with LOCK:
                    if sum(job['status']=='running' for job in JOBS.values())>=3:
                        return self.json_response({'error':'Three jobs are running. Try again when a job finishes.'},429)
                    job_id=uuid.uuid4().hex
                    JOBS[job_id]={'status':'running','stage':'Preparing star tracking' if self.path=='/api/track' else 'Preparing light measurements','id':job_id}
                POOL.submit(create_track if self.path=='/api/track' else create_spectrum,job_id,options)
                return self.json_response({'id':job_id},202)
            return self.json_response({'error': 'Unknown endpoint'}, 404)
        except (ValueError, KeyError) as error:
            return self.json_response({'error': str(error)}, 400)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    initialize()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'SPHEREx prototype ready at http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
