"""Mirror small files to a private Supabase Storage bucket (REST via requests)."""
import os
import pathlib
import sys
import tempfile

import requests

_env = pathlib.Path(__file__).with_name('.env')
if _env.exists():
    for _line in _env.read_text(encoding='utf-8').splitlines():
        _line = _line.strip()
        if _line and not _line.startswith('#') and '=' in _line:
            _k, _v = _line.split('=', 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"\''))

BUCKET = 'spherex'
TIMEOUT = (10, 120)


def enabled() -> bool:
    return bool(os.environ.get('SUPABASE_URL') and os.environ.get('SUPABASE_SERVICE_KEY'))


def _req(method, path, **kw):
    # Pasted values can carry line breaks; neither a key nor a URL contains whitespace.
    key = ''.join(os.environ['SUPABASE_SERVICE_KEY'].split())
    headers = {'apikey': key, 'Authorization': f'Bearer {key}', **kw.pop('headers', {})}
    url = ''.join(os.environ['SUPABASE_URL'].split()).rstrip('/') + '/storage/v1' + path
    return requests.request(method, url, headers=headers, timeout=TIMEOUT, **kw)


def pull(name: str, dest: pathlib.Path) -> bool:
    if not enabled():
        return False
    dest = pathlib.Path(dest)
    tmp = None
    try:
        r = _req('GET', f'/object/{BUCKET}/{name}')
        if r.status_code == 200:
            dest.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=dest.parent, suffix='.part')
            with os.fdopen(fd, 'wb') as f:
                f.write(r.content)
            os.replace(tmp, dest)
            return True
        # Storage reports a missing object/bucket as 404 (sometimes wrapped in a 400)
        if r.status_code != 404 and '"404"' not in r.text and '"statusCode":404' not in r.text:
            print(f'remote_store: pull {name} failed: HTTP {r.status_code}', file=sys.stderr)
    except Exception as e:  # never raise: the app must start offline
        print(f'remote_store: pull {name} failed: {type(e).__name__}', file=sys.stderr)
    if tmp and os.path.exists(tmp):
        os.unlink(tmp)
    return False


def push(path: pathlib.Path, name: str | None = None) -> None:
    path = pathlib.Path(path)
    name = name or path.name
    if not enabled():
        raise RuntimeError('Supabase not configured')
    r = _req('POST', '/bucket', json={'id': BUCKET, 'name': BUCKET, 'public': False})
    if r.status_code >= 400 and 'already exists' not in r.text and r.status_code != 409 \
            and 'Duplicate' not in r.text:
        raise RuntimeError(f'create bucket failed: HTTP {r.status_code} {r.text}')
    r = _req('POST', f'/object/{BUCKET}/{name}', data=path.read_bytes(), headers={'x-upsert': 'true'})
    if r.status_code >= 300:
        raise RuntimeError(f'upload failed: HTTP {r.status_code} {r.text}')


if __name__ == '__main__':
    if not enabled():
        print('Supabase not configured')
        sys.exit(1)
    with tempfile.TemporaryDirectory() as d:
        src, back = pathlib.Path(d, 'a.txt'), pathlib.Path(d, 'b.txt')
        src.write_bytes(b'selfcheck')
        push(src, 'selfcheck.txt')
        assert pull('selfcheck.txt', back) and back.read_bytes() == b'selfcheck', 'roundtrip mismatch'
        r = _req('DELETE', f'/object/{BUCKET}/selfcheck.txt')
        assert r.status_code < 300, f'delete failed: HTTP {r.status_code}'
    print('remote store OK')
