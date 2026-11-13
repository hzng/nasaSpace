"""Download all available observations around six featured coordinates, all detectors.

Run: python sync_featured.py
Resume: rerun the same command. Verified downloads are reused.
The Vesta preset is a fixed sky patch containing its August 2025 example track.
It is not a whole-orbit asteroid search. Markers use the archived MOST predictions.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent.parent
sys.path.insert(0, str(WORKSPACE / 'work' / 'deps'))
from astropy.io import ascii
from astropy.time import Time
from archive import download, query, write_json

CACHE = WORKSPACE / 'work' / 'prototype-cache'
MANIFEST = CACHE / 'featured-library.json'
PROGRESS = CACHE / 'sync-status.json'


def sync(workers=4):
    CACHE.mkdir(parents=True, exist_ok=True)
    fields = json.loads((ROOT.parent / 'spherex-viewer/data/collection.json').read_text())['fields']
    config = json.loads((ROOT / 'archive-config.json').read_text())
    predictions = {}
    most = WORKSPACE / 'work/results.tbl'
    if most.exists():
        for row in ascii.read(most, format='ipac'):
            predictions[str(row['Image_ID'])] = [float(row['ra_obj']), float(row['dec_obj'])]
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {'records': []}
    saved = {(r['field_key'], r['id'], r['detector']): r for r in previous['records']}
    tasks, search_failures = [], []
    progress = dict(status='querying', total=0, completed=0, failures=[], fields=[], started_utc=Time.now().isot+'Z')
    write_json(PROGRESS, progress)
    for field in fields:
        try:
            rows = query(config, field['ra'], field['dec'])
            for row in rows:
                row.update(field_key=field['key'], field_name=field['name'])
                prediction = predictions.get(f"{row['id']}D{row['detector']}") if field['key'] == 'vesta' else None
                if prediction:
                    row['marker_sky'] = prediction
                tasks.append((row, field))
            progress['fields'].append(dict(key=field['key'], name=field['name'], matches=len(rows),
                detectors={str(d): sum(r['detector'] == d for r in rows) for d in range(1, 7)}))
            print(field['key'], len(rows), 'observations', flush=True)
        except Exception as error:
            search_failures.append(dict(field=field['key'], error=str(error)))
            print(field['key'], 'QUERY FAILED', error, flush=True)
        write_json(PROGRESS, progress)
    progress.update(status='downloading', total=len(tasks), failures=search_failures)
    write_json(PROGRESS, progress)

    def save():
        write_json(MANIFEST, dict(updated_utc=Time.now().isot+'Z', collections=config['collections'],
            fields=progress['fields'], widths_arcmin=[5,10,15,30,60], source_width_arcmin=90,
            records=list(saved.values())))
        write_json(PROGRESS, progress)

    def get(task):
        record, field = task
        return download(record, field['ra'], field['dec'], 60, CACHE)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(get, task): task for task in tasks}
        for future in as_completed(futures):
            record, field = futures[future]
            try:
                result = future.result()
                saved[(field['key'], result['id'], result['detector'])] = result
            except Exception as error:
                progress['failures'].append(dict(field=field['key'], id=record['id'], detector=record['detector'], error=str(error)))
            progress['completed'] += 1
            if progress['completed'] % 10 == 0 or progress['completed'] == len(tasks):
                print(f"Downloaded/checked {progress['completed']}/{len(tasks)}; failures {len(progress['failures'])}", flush=True)
                save()
    progress.update(status='complete' if not progress['failures'] else 'incomplete', finished_utc=Time.now().isot+'Z')
    save()
    return progress


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=8, choices=range(1, 17))
    args = parser.parse_args()
    result = sync(args.workers)
    print(json.dumps({k:v for k,v in result.items() if k != 'fields'}, indent=2), flush=True)
    sys.exit(0 if result['status'] == 'complete' else 1)
