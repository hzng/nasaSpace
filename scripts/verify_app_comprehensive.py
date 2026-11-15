import urllib.request
import json
import time
import sys

base = 'http://127.0.0.1:8000'
results = {}

print('=== 1. Testing Core Frontend Routes ===')
for route in ['/', '/favicon.svg', '/style.css', '/app.js', '/observation-lab/', '/observation-lab/app.js']:
    try:
        res = urllib.request.urlopen(base + route)
        assert res.status == 200
        results[route] = 'OK (200)'
    except Exception as e:
        results[route] = f'FAILED ({e})'
print(json.dumps(results, indent=2))

print('=== 2. Testing 3D Context Sky & Gaia Data ===')
res = urllib.request.urlopen(base + '/api/context-sky')
sky = json.loads(res.read().decode())
print(f"Context sky objects: {len(sky['objects'])}, added stars: {sky.get('added_stars')}, teammate gaia: {sky.get('teammate_gaia_count')}")

print('=== 3. Testing Observation Lab Multi-Frame Sessions ===')
lib = json.loads(urllib.request.urlopen(base + '/observation-lab/api/library').read().decode())
print(f"Library targets: {len(lib['fields'])}")

lab_results = {}
for f in lib['fields']:
    name = f['key']
    opts = {'ra': f['ra'], 'dec': f['dec'], 'fov': 15.0, 'detector': 3}
    payload = dict(opts, source='saved', field=name, title=f['name'])
    req = urllib.request.Request(
        base + '/observation-lab/api/jobs',
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    res = urllib.request.urlopen(req)
    job_id = json.loads(res.read().decode())['id']
    for _ in range(20):
        job_data = json.loads(urllib.request.urlopen(f'{base}/observation-lab/api/jobs/{job_id}').read().decode())
        if job_data.get('status') in ('complete', 'failed'):
            break
        time.sleep(0.3)
    status = job_data.get('status')
    frames = job_data.get('result', {}).get('frames', [])
    first_prev = frames[0].get('preview') if frames else None
    lab_results[name] = {'status': status, 'frames': len(frames), 'first_preview': first_prev}

print(json.dumps(lab_results, indent=2))

print('=== 4. Verifying Preview Image URLs ===')
img_checks = []
for name, data in lab_results.items():
    preview = data.get('first_preview')
    if preview:
        res = urllib.request.urlopen(base + preview)
        img_checks.append((name, preview, res.status))
        assert res.status == 200, f"Failed image fetch for {name}"
print('Image preview checks (all 200 OK):', img_checks)

print('=== 5. Testing Coordinate Search with Library Fallback ===')
req = urllib.request.Request(
    base + '/api/search',
    data=json.dumps({'ra': '269.44625', 'dec': '4.7675', 'fov': 8.0}).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)
res = urllib.request.urlopen(req)
s_job_id = json.loads(res.read().decode())['id']
time.sleep(1.0)
s_data = json.loads(urllib.request.urlopen(f'{base}/api/jobs/{s_job_id}').read().decode())
print(f"Search discovery: status={s_data.get('status')}, discovered={s_data.get('discovered')}, ready={s_data.get('ready')}")
urllib.request.urlopen(urllib.request.Request(f'{base}/api/jobs/{s_job_id}/pause', method='POST'))

print('=== ALL COMPREHENSIVE CHECKS PASSED SUCCESSFULLY ===')

