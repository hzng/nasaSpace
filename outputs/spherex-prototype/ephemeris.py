"""Predicted sky positions of Solar System objects from NASA JPL Horizons, cached on disk. Never estimates."""
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import re
import threading

import requests

_LOCK = threading.Lock()

URL = 'https://ssd.jpl.nasa.gov/api/horizons.api'
OBSERVERS = ['500@-163182', '500@399']  # SPHEREx spacecraft, then geocenter fallback
FIELDS = ['ra', 'dec', 'dra_cosdec', 'ddec', 'delta_au', 'deldot_km_s', 'light_time_min']
GEO_WARNING = ("Horizons has no SPHEREx trajectory for these dates. Positions are geocentric; parallax from "
               "SPHEREx's orbit is not included (about 1″ for main-belt asteroids, arcminutes for near-Earth objects).")


class EphemerisError(Exception):
    pass


def _load(path):
    try:
        return json.loads(Path(path).read_text('utf-8'))
    except (OSError, ValueError):
        return {}


def _query(command, observer, keys):
    params = dict(COMMAND=command, OBJ_DATA='NO', MAKE_EPHEM='YES', EPHEM_TYPE='OBSERVER', CENTER=observer,
                  TLIST=','.join("'%s'" % k for k in keys), TLIST_TYPE='JD', TIME_TYPE='UT', QUANTITIES='1,3,20,21',
                  ANG_FORMAT='DEG', EXTRA_PREC='YES', CSV_FORMAT='YES', CAL_FORMAT='BOTH', TIME_DIGITS='FRACSEC')
    params = {k: v if k == 'TLIST' else "'%s'" % v for k, v in params.items()}
    try:
        r = requests.get(URL, params=dict(params, format='text'), timeout=(10, 60))
        r.raise_for_status()
    except requests.RequestException as e:
        raise EphemerisError('Horizons is unreachable (%s).' % type(e).__name__)
    return r.text


def _parse(text, command, keys):
    """Returns (object, observer, rows), or None when Horizons has no SPHEREx ephemeris for the epoch."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if 'No matches found.' in text:
        raise EphemerisError('Horizons does not know an object named "%s".' % command.rstrip(';'))
    if 'Matching small-bodies:' in text:
        table = text.split('Matching small-bodies:', 1)[1].splitlines()
        cand = [l.strip() for l in table if l.strip() and not set(l.strip()) <= set('- ')][:9]
        raise EphemerisError('"%s" matches several objects; retype a record number or full designation:\n%s'
                             % (command.rstrip(';'), '\n'.join(cand)))
    if 'No ephemeris for center' in text:
        return None
    if 'No ephemeris for target' in text:
        raise EphemerisError(next(l for l in lines if 'No ephemeris for target' in l))
    if '$$SOE' not in text:
        raise EphemerisError('Horizons gave no ephemeris: %s' % (lines[-1] if lines else 'empty reply'))
    name = lambda label: next((re.split(r'\s{2,}', l.split(':', 1)[1].strip())[0] for l in lines if l.startswith(label)), '')
    rows = [[c.strip() for c in l.split(',')] for l in text.split('$$SOE', 1)[1].split('$$EOE', 1)[0].splitlines() if l.strip()]
    if len(rows) != len(keys):
        raise EphemerisError('Horizons returned %d rows for %d epochs.' % (len(rows), len(keys)))
    return name('Target body name'), name('Center body name'), rows


def fetch(designation, jd_utc_list, cache_dir):
    with _LOCK:  # several tracking jobs share one cache file: serialise its read-merge-write
        return _fetch(designation, jd_utc_list, cache_dir)


def _fetch(designation, jd_utc_list, cache_dir):
    command = designation.strip()
    if not re.fullmatch(r'[A-Za-z0-9 /.()\-]+;?', command):  # also keeps quotes out of the Horizons command
        raise EphemerisError('"%s" is not a valid object designation.' % command)
    command += '' if command.endswith(';') else ';'
    keys = ['%.9f' % jd for jd in jd_utc_list]
    requested = False
    for observer in OBSERVERS:
        fname = re.sub(r'[^a-z0-9]+', '_', (command + '_' + observer).lower()).strip('_') + '.json'
        cpath = Path(cache_dir) / 'horizons' / fname
        # file names drop punctuation, so a file only counts when it was written for this exact command
        fixture, cache = (d if d.get('command', command).lower() == command.lower() else {}
                          for d in (_load(Path(__file__).parent / 'fixtures' / 'horizons' / fname), _load(cpath)))
        doc = {**fixture, **cache, 'rows': {**fixture.get('rows', {}), **cache.get('rows', {})}}
        missing = list(dict.fromkeys(k for k in keys if k not in doc['rows']))
        for i in range(0, len(missing), 50):
            chunk = missing[i:i + 50]
            try:
                parsed = _parse(_query(command, observer, chunk), command, chunk)
            except EphemerisError as e:
                if 'unreachable' in str(e):
                    raise EphemerisError('%s %d of %d requested exposure times are not in the local cache.'
                                         % (e, len(missing), len(keys)))
                raise
            if parsed is None:
                break  # no SPHEREx trajectory for these epochs: try the geocenter
            requested = True
            doc.update(object=parsed[0], observer=parsed[1], observer_code=observer, command=command)
            stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            for k in chunk:  # Horizons sorts rows by time, not request order: match on the returned JD
                row = min(parsed[2], key=lambda r: abs(float(r[1]) - float(k)))
                if abs(float(row[1]) - float(k)) > 1e-8:
                    raise EphemerisError('Horizons did not return the requested exposure time JD %s.' % k)
                doc['rows'][k] = dict(zip(FIELDS, map(float, row[4:11])), retrieved_utc=stamp)
            cpath.parent.mkdir(parents=True, exist_ok=True)
            tmp = cpath.with_name(cpath.name + '.tmp')
            tmp.write_text(json.dumps(doc), 'utf-8')
            os.replace(tmp, cpath)
        else:
            rows = [dict(doc['rows'][k], jd_utc=jd) for k, jd in zip(keys, jd_utc_list)]
            return {'source': 'JPL Horizons', 'object': doc.get('object', ''), 'command': command,
                    'observer': doc.get('observer', ''), 'observer_code': observer,
                    'retrieved_utc': min((r['retrieved_utc'] for r in rows), default=''), 'from_cache': not requested,
                    'warnings': [GEO_WARNING] if observer == OBSERVERS[1] else [], 'rows': rows}
    raise EphemerisError('Horizons has no ephemeris for "%s" at these epochs.' % command.rstrip(';'))


if __name__ == '__main__':
    import tempfile
    from unittest import mock
    jds, tmp = [2460891.961818273, 2460892.50554965], tempfile.mkdtemp()
    r = fetch('Vesta', jds, tmp)
    assert abs(r['rows'][0]['ra'] - 222.866226866) < 1e-6 and abs(r['rows'][0]['dec'] + 11.907544792) < 1e-6, r['rows'][0]
    assert r['observer_code'] == '500@-163182' and not r['warnings'] and r['object'].startswith('4 Vesta'), r
    assert fetch('Vesta', jds, tmp)['from_cache'] is True
    a, b = fetch('Ceres', jds, tempfile.mkdtemp())['rows'], fetch('Ceres', jds[::-1], tempfile.mkdtemp())['rows']
    assert a[0]['ra'] == b[1]['ra'] != a[1]['ra'] == b[0]['ra'], (a, b)  # a descending request keeps each epoch's row
    for name, want in (('Notarealrock', 'Notarealrock'), ('Halley', 'Record'), ('Vesta!', 'not a valid')):
        try:
            fetch(name, jds, tmp)
            raise AssertionError(name)
        except EphemerisError as e:
            assert want in str(e), e
            print(e)
    g = fetch('Vesta', [2460000.5], tmp)
    assert g['observer_code'] == '500@399' and g['warnings'] and g['rows'][0]['ra'], g
    with mock.patch('requests.get', side_effect=requests.ConnectionError):
        assert fetch('Vesta', jds, tmp)['from_cache'] is True
        try:
            fetch('Vesta', [2460893.5], tmp)
            raise AssertionError('offline')
        except EphemerisError as e:
            assert 'unreachable' in str(e) and '1 of 1' in str(e), e
            print(e)
    print('ephemeris self-check OK')
