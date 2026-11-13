"""Prepare all 180 target / width / detector views for fast local switching.

Run after sync_featured.py. Cached, unchanged views are reused automatically.
"""
import argparse
import json
import uuid
import server


def prepare(field_key=None):
    server.initialize()
    report = []
    for field in server.LIBRARY['fields']:
        if field_key and field_key != field['key']:
            continue
        for detector in range(1, 7):
            for fov in [5, 10, 15, 30, 60]:
                job_id = uuid.uuid4().hex
                server.JOBS[job_id] = {'status': 'running'}
                options = dict(ra=field['ra'], dec=field['dec'], detector=detector, fov=fov)
                server.create_session(job_id, options)
                job = server.JOBS.pop(job_id)
                if job['status'] != 'complete':
                    raise RuntimeError(f"{field['key']} D{detector} {fov}: {job['stage']}")
                result = job['result']
                for frame in result['frames']:
                    assert frame['footprint_coverage'] >= 99 and frame['coverage'] >= 80
                row = dict(field=field['key'], detector=detector, fov=fov,
                           frames=len(result['frames']), excluded=len(result['excluded_frames']),
                           failures=result['failures'], session=result['id'],
                           minimum_footprint=min((f['footprint_coverage'] for f in result['frames']), default=None))
                report.append(row)
                print(json.dumps(row), flush=True)
                server.atomic_json(server.CACHE/f"prepared-{field_key or 'all'}.json", report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--field')
    args = parser.parse_args()
    prepare(args.field)
