"""Local SPHEREx prototype server. Run with Python, then open its printed URL."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import re
import shutil
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
from .science import (PIPELINE, FLAG_SOURCE, fits_metadata, grid_for, inspect_pixel,
                     prepare_frame, render_frames, request_options)
from .archive import query as archive_query, download as archive_download, reduction_priority, write_json
from backend.archive import CACHE as PLANET_CACHE, ROOT as PLANET_ROOT
from backend.example_field import prepare_starter

DATA = ROOT
LOCAL = PLANET_ROOT / 'nasaSpace-main/outputs/spherex-viewer'
CACHE = PLANET_CACHE / 'observation-lab'
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
CACHE_LIMIT = float(os.environ.get('SPHEREX_CACHE_GB', 2)) * 1e9
MAX_FRAMES = 120  # per view; the busiest saved target other than R Draconis has 97


def atomic_json(path, data):
    write_json(path, data)


def initialize():
    for field in LIBRARY['fields']:
        prepared = {}
        for frame in field['frames']:
            native = LOCAL / frame['fits']
            if not native.is_file():
                if not prepared:
                    try:
                        starter = prepare_starter(field['key'])
                        prepared = {r['url']:r for r in starter['frames'] if r['status']=='ready'}
                    except (OSError,ValueError):
                        break
                ready = prepared.get(frame['source'])
                if not ready:
                    continue
                native = PLANET_CACHE / (ready['cache_id']+'.fits')
            if not native.is_file():
                continue
            try:
                meta = fits_metadata(native)
            except Exception as error:
                continue
            meta.update(path=str(native), release=frame['release'], source=frame['source'],
                        field_key=field['key'], field_name=field['name'],
                        provenance='Official IRSA archived exposure',
                        fits_url='/api/original/'+meta['sha256'], context=[])
            if frame.get('marker'):
                grid,size = grid_for(dict(ra=field['ra'],dec=field['dec'],fov=15))
                sky=grid.pixel_to_world(frame['marker'][0]*size-.5,(1-frame['marker'][1])*size-.5)
                meta['marker_sky']=[float(sky.ra.deg),float(sky.dec.deg)]
            with LOCK:
                RECORDS.append(meta)



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


def available(record):
    return bool(record.get('path')) and Path(record['path']).exists()


def ensure_local(record):
    """Return the record with its FITS on disk, re-fetching an evicted archive cutout."""
    if available(record):
        return record
    if not record.get('download_center'):
        raise FileNotFoundError('The original FITS is no longer cached. Reopen this sky view.')
    return archive_download(record, *record['download_center'],
                            record['requested_source_width_deg'] / 1.5 * 60, CACHE)


def fetch_cutouts(records, ra, dec, fov, progress, failures, start=None, end=None):
    """Download cutouts around (ra, dec) for observations with no local file.

    Returns {(id, detector): record}. Index records only guarantee that an
    observation contains its own field center, so any other position is checked
    against the archive footprints first; a cutout outside the footprint fails
    slowly and then falls back to the full detector file.
    """
    def centered(record):
        center = record.get('download_center') or record.get('center') or [None, None]
        return center[0] is not None and abs(center[0]-ra) < 1e-9 and abs(center[1]-dec) < 1e-9
    if not all(centered(r) for r in records):
        progress('Checking which observations cover this position')
        covering = {(r['id'], r['detector']) for r in archive_query(CONFIG, ra, dec, start=start, end=end)}
        records = [r for r in records if (r['id'], r['detector']) in covering]
    done = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(archive_download, {k: v for k, v in r.items() if k != 'featured_cache'},
                               ra, dec, fov, CACHE): r for r in records}
        for count, future in enumerate(as_completed(futures), 1):
            try:
                record = future.result()
                done[(record['id'], record['detector'])] = record
            except Exception as error:
                failures.append(f"{futures[future]['id']}: {error}")
            progress(f'Fetching observation {count} of {len(records)} from the NASA archive')
    imported_records(list(done.values()))
    return done


def trim_cache():
    """Delete re-fetchable cutouts, then rendered views, oldest first, above the size cap.

    Bundled examples live outside CACHE. User imports have no sidecar and are kept.
    The most recently opened view is kept even when it alone exceeds the cap.
    """
    with LOCK:
        if any(job['status'] == 'running' for job in JOBS.values()):
            return  # another job may be reading these files
        items = []
        for path in CACHE.iterdir():
            if path.suffix == '.fits' and path.with_suffix('.record.json').exists():
                items.append((path.stat().st_mtime, path.stat().st_size, path))
            elif path.is_dir() and re.fullmatch('[a-f0-9]{32}', path.name):
                items.append((path.stat().st_mtime, sum(f.stat().st_size for f in path.iterdir()), path))
        total = sum(size for _, size, _ in items)
        on_screen = max((item for item in items if item[2].is_dir()), default=(0, 0, None))[2]
        # The open view's own cutouts stay too: tracking and spectra read them
        keep = set()
        try:
            keep = {CACHE / f['fits_url'].removeprefix('/cache/')
                    for f in json.loads((on_screen / 'manifest.json').read_text())['frames']}
        except (OSError, TypeError, ValueError, KeyError):
            pass
        # shortcut: cutouts are evicted by download age, not last use; touch them on read if re-fetching gets noticeable
        for _, size, path in sorted(items, key=lambda item: (item[2].is_dir(), item[0])):
            if total <= CACHE_LIMIT:
                break
            if path == on_screen or path in keep:
                continue
            try:
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
                    path.with_suffix('.record.json').unlink(missing_ok=True)
                total -= size
            except OSError:
                pass  # still open on Windows; the next trim retries


def load_manifest(session_id):
    try:
        return json.loads((CACHE/session_id/'manifest.json').read_text())
    except FileNotFoundError:
        raise FileNotFoundError('This sky view is no longer cached. Open it again.') from None


def run_job(work, job_id, payload):
    work(job_id, payload)
    trim_cache()


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
        for record in sorted(records, key=reduction_priority, reverse=True):
            dedup.setdefault((record['id'], record['detector']), record)
        # Near the ecliptic poles SPHEREx looks every orbit (R Draconis: ~520 frames per band, enough to fill the cache
        # alone), so a view keeps MAX_FRAMES spread evenly in time, first and last included
        matched = len(dedup)
        limited = matched > MAX_FRAMES
        if limited:
            ordered = sorted(dedup.items(), key=lambda item: item[1]['mjd'])
            dedup = dict(ordered[round(i * (matched - 1) / (MAX_FRAMES - 1))] for i in range(MAX_FRAMES))
        key = session_key(options, list(dedup.values()))
        cached_id = SESSIONS.get(key)
        if (VIEW_INDEX / f'{key}.json').exists():
            cached_id = json.loads((VIEW_INDEX / f'{key}.json').read_text())['session']
        if payload.get('source') != 'archive' and cached_id and (CACHE/cached_id/'manifest.json').exists():
            manifest = json.loads((CACHE/cached_id/'manifest.json').read_text())
            os.utime(CACHE/cached_id)  # mark as the view in use so trimming keeps it
            with LOCK:
                JOBS[job_id].update(status='complete', stage='Ready from local cache', result=manifest)
            return
        grid, size = grid_for(options)
        yy, xx = np.indices((size, size))
        grid_sky = grid.pixel_to_world(xx, yy)
        prepared = []
        excluded = []
        wider_views = 0
        missing = [r for r in dedup.values() if not available(r) and r.get('source')]
        fetch_failures = []
        if missing:
            dedup.update(fetch_cutouts(missing, options['ra'], options['dec'], options['fov'], progress,
                                       fetch_failures, options['start_mjd'], options['end_mjd']))
            failures.extend(fetch_failures)
        candidates = sorted((r for r in dedup.values() if available(r)), key=lambda r: r['mjd'])
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
                    'archive_matches': archive_total, 'limited': limited, 'matched_frames': matched, 'failures': failures,
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
            # Index the view under the records it was requested with and the cutouts it used,
            # unless a download failed: a retry should fetch the missing frames.
            for view_key in ([] if fetch_failures else {key, session_key(options, list(dedup.values()))}):
                SESSIONS[view_key] = job_id
                # A separate entry per view avoids overwriting other processes' caches.
                atomic_json(VIEW_INDEX / f'{view_key}.json', {'session': job_id})
            JOBS[job_id].update(status='complete', stage='Ready', result=manifest)
    except Exception as error:
        traceback.print_exc()
        with LOCK:
            JOBS[job_id].update(status='failed', stage=str(error))


def create_spectrum(job_id, payload):
    try:
        from .spectroscopy import extract
        session_id = str(payload.get('session',''))
        if not re.fullmatch('[a-f0-9]{32}', session_id):
            raise ValueError('Open a sky view before measuring its light.')
        manifest=load_manifest(session_id)
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
        def resolve(chosen):
            missing=[r for r in chosen.values() if not available(r) and r.get('source')]
            if missing:
                chosen.update(fetch_cutouts(missing,float(sky.ra.deg),float(sky.dec.deg),5,progress,[],start,end))
        track_points=payload.get('track_points')
        track_object=payload.get('track_object')
        follow_track=bool(payload.get('follow_track') and track_points)
        result=extract(records,sky.ra.deg,sky.dec.deg,CACHE,progress,start,end,float(payload.get('redshift',0)),resolve,
                       track_points=track_points if follow_track else None,
                       track_object=track_object if follow_track else None)
        result['scope']=scope
        with LOCK:
            JOBS[job_id].update(status='complete',stage='Light measurements ready',result=result)
    except Exception as error:
        traceback.print_exc()
        with LOCK:
            JOBS[job_id].update(status='failed',stage=str(error))


def create_track(job_id, payload):
    try:
        from .tracking import track
        sid=str(payload.get('session',''))
        if not re.fullmatch('[a-f0-9]{32}',sid): raise ValueError('Open a sky view first.')
        manifest=load_manifest(sid)
        refresh_featured()
        with LOCK: lookup={r['sha256']:r for r in RECORDS}
        # Files the cache trim removed are fetched again from IRSA; say so, or the job looks frozen
        evicted=sum(1 for f in manifest['frames'] if f['sha256'] in lookup and not available(lookup[f['sha256']]))
        fetched=[0]
        if evicted:
            with LOCK: JOBS[job_id].update(stage=f'Downloading {evicted} observations again from the NASA archive (the cache had removed them)')
        def local_path(frame):
            rec=lookup.get(frame['sha256'])
            if rec and available(rec): return rec['path']
            if rec:
                path=ensure_local(rec)['path']
                with LOCK:
                    fetched[0]+=1
                    JOBS[job_id].update(stage=f'Downloading observation {fetched[0]} of {evicted} again from the NASA archive')
                return path
            filename=frame['fits_url'].removeprefix('/cache/')
            if not re.fullmatch(r'[a-f0-9]{64}\.fits',filename): raise ValueError('Original FITS unavailable')
            return str(CACHE/filename)
        def progress(message):
            with LOCK: JOBS[job_id].update(stage=message)
        # A cold cache can mean minutes of downloads, so count them through the same job stage
        frames=manifest['frames']
        cold=lambda frame:(rec:=lookup.get(frame['sha256'])) is not None and not available(rec)
        missing=sum(map(cold,frames))
        progress(f'Downloading frames 0 / {missing} ({len(frames)-missing} already cached)' if missing
                 else f'All {len(frames)} frames already cached')
        fetched=[0]
        def fetch(frame):
            download=cold(frame)
            path=local_path(frame)
            if download:
                with LOCK: fetched[0]+=1; done=fetched[0]
                progress(f'Downloading frames {min(done,missing)} / {missing}')
            return path
        with ThreadPoolExecutor(max_workers=6) as pool:
            paths=list(pool.map(fetch,frames))
        result=track(manifest,paths,payload,CACHE,progress)
        with LOCK: JOBS[job_id].update(status='complete',stage='Track ready',result=result)
    except Exception as error:
        from .ephemeris import EphemerisError
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

    def end_headers(self):
        # Page code changes between visits, so browsers must revalidate it. Frame images never change.
        if not self.path.startswith(('/api/', '/cache/', '/data/')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def translate_path(self, path):
        clean = urlparse(path).path
        if clean.startswith('/api/original/'):
            digest=clean.rsplit('/',1)[-1]
            with LOCK:
                row=next((r for r in RECORDS if r.get('sha256')==digest),None)
            return row['path'] if row else str(ROOT/'_missing')
        if any(part.startswith('.') for part in clean.split('/')):
            return str(ROOT / '_missing')  # never serve .env or other dotfiles
        for prefix, directory in (('/cache/', CACHE), ('/data/', LOCAL/'data')):
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
                            'thumbnail': '/'+field['frames'][0]['png'] if (LOCAL/field['frames'][0]['png']).exists() else None})
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
            if parsed.path in ('/api/pixel', '/api/identify'):
                args = {k: v[0] for k, v in parse_qs(parsed.query).items()}
                session = args['session']
                if not re.fullmatch('[a-f0-9]{32}', session):
                    raise ValueError('Invalid session ID.')
                manifest = load_manifest(session)
                frame = manifest['frames'][int(args['frame'])]
                with LOCK:
                    record = next((r for r in RECORDS if r['sha256'] == frame['sha256']), None)
                if record is None:
                    filename = frame['fits_url'].removeprefix('/cache/')
                    if not re.fullmatch(r'[a-f0-9]{64}\.fits', filename):
                        raise ValueError('The original source is no longer in this library.')
                    record = dict(frame, path=str(CACHE / filename))
                x, y = float(args['x']), float(args['y'])
                if parsed.path == '/api/pixel':
                    return self.json_response(inspect_pixel(ensure_local(record), manifest['options'], x, y))
                if not (0 <= x < 1 and 0 <= y < 1):
                    raise ValueError('Click inside the image.')
                from .tracking import name_source
                grid, size = grid_for(manifest['options'])
                guess = grid.pixel_to_world(x * size - 0.5, (1 - y) * size - 0.5)  # same click-to-sky mapping as tracking.track
                return self.json_response(name_source(ensure_local(record)['path'], guess, float(frame['mjd']), CACHE))
            return super().do_GET()
        except (ValueError, KeyError, IndexError, StopIteration, FileNotFoundError) as error:
            return self.json_response({'error': str(error)}, 400)

    def do_POST(self):
        try:
            # The local service only accepts writes from its own origin or CLI clients.
            origin = self.headers.get('Origin')
            # Compare hosts only: behind an HTTPS tunnel the page origin is https, the local hop http.
            if origin and urlparse(origin).netloc != self.headers.get('Host'):
                return self.json_response({'error': 'Origin not allowed'}, 403)
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 85_000_000:
                raise ValueError('Request must contain data and fit within 85 MB.')
            payload = self.rfile.read(size)
            if self.path == '/api/import':
                return self.json_response({'error': 'File import is disabled in Planet X.'}, 403)
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
                POOL.submit(run_job, create_session, job_id, options)
                return self.json_response({'id': job_id}, 202)
            if self.path in ('/api/spectrum','/api/track'):
                options=json.loads(payload)
                with LOCK:
                    if sum(job['status']=='running' for job in JOBS.values())>=3:
                        return self.json_response({'error':'Three jobs are running. Try again when a job finishes.'},429)
                    job_id=uuid.uuid4().hex
                    JOBS[job_id]={'status':'running','stage':'Preparing star tracking' if self.path=='/api/track' else 'Preparing light measurements','id':job_id}
                POOL.submit(run_job,create_track if self.path=='/api/track' else create_spectrum,job_id,options)
                return self.json_response({'id':job_id},202)
            return self.json_response({'error': 'Unknown endpoint'}, 404)
        except (ValueError, KeyError) as error:
            return self.json_response({'error': str(error)}, 400)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    initialize()
    # The page loads ~17 files at once; through the tunnel they arrive together, and the default backlog of 5 refuses some.
    ThreadingHTTPServer.request_queue_size = 64
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'SPHEREx prototype ready at http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
