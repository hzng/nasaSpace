"""Build an index of archive observations around six featured coordinates, all detectors.

Run: python sync_featured.py
No image files are downloaded. Each field is queried once and the observation list is written to
work/prototype-cache/featured-library.json; the server fetches pixels on demand when a view opens.
If a field's query fails or returns nothing, that field keeps its records from the previous index.
When every field succeeded and Supabase is configured, the index is uploaded (remote_store.push).
The Vesta preset is a fixed sky patch containing its August 2025 example track.
It is not a whole-orbit asteroid search. Markers use the archived MOST predictions.
"""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent.parent
sys.path.insert(0, str(WORKSPACE / 'work' / 'deps'))
from astropy.io import ascii
from astropy.time import Time
from archive import query, write_json
import remote_store

CACHE = WORKSPACE / 'work' / 'prototype-cache'
MANIFEST = CACHE / 'featured-library.json'
PROGRESS = CACHE / 'sync-status.json'


def sync():
    CACHE.mkdir(parents=True, exist_ok=True)
    fields = json.loads((ROOT.parent / 'spherex-viewer/data/collection.json').read_text())['fields']
    config = json.loads((ROOT / 'archive-config.json').read_text())
    predictions = {}
    most = WORKSPACE / 'work/results.tbl'
    if most.exists():
        for row in ascii.read(most, format='ipac'):
            predictions[str(row['Image_ID'])] = [float(row['ra_obj']), float(row['dec_obj'])]
    previous = json.loads(MANIFEST.read_text())['records'] if MANIFEST.exists() else []
    records, failures = [], []
    progress = dict(status='querying', total=len(fields), completed=0, failures=failures, fields=[], started_utc=Time.now().isot+'Z')
    write_json(PROGRESS, progress)
    for field in fields:
        try:
            rows = query(config, field['ra'], field['dec'])
            if not rows:
                raise RuntimeError('query returned no observations')
        except Exception as error:
            failures.append(dict(field=field['key'], error=str(error)))
            kept = [r for r in previous if r['field_key'] == field['key']]
            records += kept
            print(field['key'], 'QUERY FAILED', error, f'(kept {len(kept)} previous records)', flush=True)
            continue
        for row in rows:
            # center, radius_deg and sha256 are search/identity placeholders for an index-only record;
            # the server replaces them with values read from the real file when it downloads the cutout.
            row.update(field_key=field['key'], field_name=field['name'], center=[field['ra'], field['dec']],
                radius_deg=0.75 * 2**0.5, timestamp=Time(row['mjd'], format='mjd').isot + 'Z',
                fits_url=row['source'], sha256=hashlib.sha256(row['source'].encode()).hexdigest())
            prediction = predictions.get(f"{row['id']}D{row['detector']}") if field['key'] == 'vesta' else None
            if prediction:
                row['marker_sky'] = prediction
            records.append(row)
        progress['fields'].append(dict(key=field['key'], name=field['name'], matches=len(rows),
            detectors={str(d): sum(r['detector'] == d for r in rows) for d in range(1, 7)}))
        progress['completed'] += 1
        print(field['key'], len(rows), 'observations', flush=True)
        write_json(PROGRESS, progress)
    # The UI shows completed/total as observation counts.
    progress.update(status='complete' if not failures else 'incomplete', finished_utc=Time.now().isot+'Z',
                    total=len(records), completed=len(records))
    write_json(MANIFEST, dict(updated_utc=Time.now().isot+'Z', collections=config['collections'],
        fields=progress['fields'], widths_arcmin=[5,10,15,30,60], index_only=True, records=records))
    write_json(PROGRESS, progress)
    return progress


if __name__ == '__main__':
    result = sync()
    if result['status'] != 'complete':
        print('Index upload skipped: sync incomplete', flush=True)
    elif not remote_store.enabled():
        print('Index upload skipped: Supabase is not configured', flush=True)
    else:
        remote_store.push(MANIFEST)
        print('Index uploaded to Supabase', flush=True)
    print(json.dumps({k: v for k, v in result.items() if k != 'fields'}, indent=2), flush=True)
    sys.exit(0 if result['status'] == 'complete' else 1)
