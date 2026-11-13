"""Verified, resumable IRSA downloads. No fabricated pixels or observation limits."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
import hashlib
import json
import re
from pathlib import Path
import shutil
import threading
import time
from urllib.parse import urlencode, urlparse
import uuid

import requests
from requests.adapters import HTTPAdapter
from astropy.io.votable import parse_single_table
from science import fits_metadata

DOWNLOAD_LOCKS = {}
LOCK = threading.Lock()
_HTTP_LOCAL = threading.local()


def _http():
    """Return a per-thread HTTP session so concurrent IRSA downloads reuse TLS connections."""
    session = getattr(_HTTP_LOCAL, 'session', None)
    if session is None:
        session = requests.Session()
        adapter = HTTPAdapter(pool_connections=12, pool_maxsize=12)
        session.mount('https://', adapter)
        session.mount('http://', adapter)
        _HTTP_LOCAL.session = session
    return session


def write_json(path, data):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False), encoding='utf-8')
    # Windows readers / antivirus can briefly hold the destination open.
    for attempt in range(50):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 49:
                raise
            time.sleep(.1)


def query(config, ra, dec, radius=.001, start=None, end=None):
    """Use TAP's newly ingested images; SIA is a documented fallback."""
    try:
        where = f"1 = CONTAINS(POINT('ICRS', {float(ra)}, {float(dec)}), p.poly)"
        if start is not None:
            where += f' AND p.time_bounds_lower >= {float(start)}'
        if end is not None:
            where += f' AND p.time_bounds_lower < {float(end)}'
        adql = ("SELECT a.uri AS access_uri, p.time_bounds_lower AS observed_mjd, "
                "p.energy_bandpassname AS detector_name FROM spherex.artifact a "
                f"JOIN spherex.plane p ON a.planeid = p.planeid WHERE {where}")
        response = _http().post(config.get('tap_endpoint', 'https://irsa.ipac.caltech.edu/TAP/sync'),
            data={'REQUEST':'doQuery', 'LANG':'ADQL', 'QUERY':adql, 'FORMAT':'votable', 'MAXREC':20000},
            timeout=(15, 180))
        response.raise_for_status()
        if b'OVERFLOW' in response.content or b'value="ERROR"' in response.content:
            raise ValueError('TAP returned a truncated result or an error.')
        table = parse_single_table(BytesIO(response.content)).to_table(use_names_over_ids=True)
        unique = {}
        for row in table:
            uri = str(row['access_uri'])
            identity = re.search(r'level2_(.+)D([1-6])_spx_', uri)
            release = re.search(r'/spherex/((?:qr|dr)\d+)/', uri)
            version = re.search(r'l2b-v(\d+)-(\d{4})-(\d{3})', uri)
            if not identity or not release or not uri.endswith('.fits'):
                continue
            collection = 'spherex_' + release[1]
            if collection not in config['collections']:
                continue
            item = dict(id=identity[1], detector=int(identity[2]),
                        source=uri if uri.startswith('https://') else 'https://irsa.ipac.caltech.edu/'+uri.lstrip('/'),
                        release=release[1].upper(), collection=collection, mjd=float(row['observed_mjd']),
                        field_key='archive', field_name='Archive search', context=[], discovery_api='IRSA TAP')
            key = item['id'], item['detector']
            rank = (config['collections'].index(collection),
                    -int(version[2]+version[3]) if version else 0, -int(version[1]) if version else 0)
            if key not in unique or rank < unique[key][0]:
                unique[key] = rank, item
        return sorted([value[1] for value in unique.values()], key=lambda r:(r['mjd'],r['detector']))
    except Exception as error:
        records = query_sia(config, ra, dec, radius, start, end)
        for record in records:
            record['discovery_api'] = 'IRSA SIA fallback (can lag TAP by about one day)'
            record['discovery_warning'] = str(error)
        return records


def query_sia(config, ra, dec, radius=.001, start=None, end=None):
    params = [('COLLECTION', name) for name in config['collections']]
    params += [('POS', f'CIRCLE {ra} {dec} {radius}'), ('MAXREC', '20000')]
    if start is not None or end is not None:
        params.append(('TIME', f"{start if start is not None else '-Inf'} {end if end is not None else 'Inf'}"))
    response = _http().get(config['sia_endpoint'], params=params, timeout=(15, 180))
    response.raise_for_status()
    if b'OVERFLOW' in response.content:
        raise ValueError('IRSA truncated the search. Narrow the dates; no truncated result is accepted.')
    if b'value="ERROR"' in response.content:
        raise ValueError('IRSA reported an error in its search response.')
    table = parse_single_table(BytesIO(response.content)).to_table(use_names_over_ids=True)
    unique = {}
    for row in table:
        if str(row['access_format']) != 'image/fits' or str(row['dataproduct_subtype']) != 'science':
            continue
        band = str(row['energy_bandpassname'])
        if band not in [f'SPHEREx-D{i}' for i in range(1, 7)]:
            continue
        collection = str(row['obs_collection'])
        rank = config['collections'].index(collection)
        item = dict(id=str(row['obs_id']), detector=int(band[-1]), source=str(row['access_url']),
                    release=collection.removeprefix('spherex_').upper(), collection=collection,
                    mjd=float(row['t_min']), field_key='archive', field_name='Archive search', context=[])
        key = item['id'], item['detector']
        if key not in unique or rank < unique[key][0]:
            unique[key] = rank, item
    return sorted([value[1] for value in unique.values()], key=lambda r: (r['mjd'], r['detector']))


def download(record, ra, dec, fov, cache):
    source = record.get('source', '')
    parsed = urlparse(source)
    if (parsed.scheme != 'https' or parsed.netloc != 'irsa.ipac.caltech.edu'
            or not parsed.path.startswith('/ibe/data/spherex/') or not parsed.path.endswith('.fits')):
        raise ValueError('Expected an official IRSA SPHEREx FITS URL.')
    # Cutouts follow detector axes. Pad the requested square for any sky rotation,
    # plus several pixels for interpolation. A 60 arcmin view uses a 90 arcmin source.
    source_width = round(float(fov) / 60 * 1.5, 8)
    url = source + '?' + urlencode({'center': f'{float(ra)},{float(dec)}', 'size': source_width})
    key = hashlib.sha256(url.encode()).hexdigest()
    path = cache / f'{key}.fits'
    sidecar = cache / f'{key}.record.json'
    with LOCK:
        download_lock = DOWNLOAD_LOCKS.setdefault(key, threading.Lock())
    with download_lock:
        if path.exists() and sidecar.exists():
            meta = json.loads(sidecar.read_text())
            if path.stat().st_size == meta.get('file_bytes') and meta['id'] == record['id'] and meta['detector'] == record['detector']:
                return dict(record, **meta, path=str(path), fits_url=f'/cache/{path.name}')
        if not path.exists():
            if shutil.disk_usage(cache).free < 5_000_000_000:
                raise OSError('Less than 5 GB disk space remains; download paused. Existing data is safe.')
            actual_url = url
            for attempt in range(4):
                temporary = cache / f'{key}.{uuid.uuid4().hex}.part'
                try:
                    # If IRSA's cutout service fails, retain the original full detector
                    # file. It has the same calibrated pixels and may avoid a service bug.
                    actual_url = source if attempt == 3 else url
                    with _http().get(actual_url, stream=True, timeout=(15, 180), allow_redirects=False) as response:
                        response.raise_for_status()
                        with temporary.open('wb') as handle:
                            for chunk in response.iter_content(1024*1024):
                                handle.write(chunk)
                    metadata = fits_metadata(temporary)
                    if metadata['id'] != record['id'] or metadata['detector'] != record['detector']:
                        raise ValueError('The downloaded FITS identity does not match the archive record.')
                    temporary.replace(path)
                    break
                except Exception:
                    temporary.unlink(missing_ok=True)
                    if attempt == 3:
                        raise
                    time.sleep(2 ** (attempt + 1))
        meta = fits_metadata(path)
        if meta['id'] != record['id'] or meta['detector'] != record['detector']:
            raise ValueError('Cached FITS identity does not match the archive record.')
        meta.update(file_bytes=path.stat().st_size, requested_source_width_deg=source_width,
                    download_center=[float(ra), float(dec)], download_url=url,
                    provenance='Official IRSA FITS; observation and detector verified; padded source for sky alignment')
        if 'actual_url' in locals() and actual_url == source:
            meta.update(download_url=source, provenance='Official IRSA full detector FITS; cutout service unavailable; identity verified')
        write_json(sidecar, meta)
        return dict(record, **meta, path=str(path), fits_url=f'/cache/{path.name}')
