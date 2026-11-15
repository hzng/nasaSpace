import math
from types import SimpleNamespace

import pytest
import requests
from astropy.time import Time

from backend import archive as shared_archive
from backend import exploration
from backend import saved_archive
from backend.observation_lab_core import archive as lab_archive


def test_expired_iers_does_not_block_earth_flight(monkeypatch):
    original = Time.sidereal_time
    def expired(self, *args, **kwargs):
        if not hasattr(self, '_delta_ut1_utc'):
            raise ValueError('interpolating from IERS_Auto using predictive values more than 30 days old')
        return original(self, *args, **kwargs)
    monkeypatch.setattr(Time, 'sidereal_time', expired)
    result = exploration.journey_context(269.4486144, 4.7379808, 1.82655, date='2026-11-15')
    assert result['distance_au'] == pytest.approx(1.82655 * 206264.806247)
    assert math.isfinite(result['observer_longitude'])
    assert 'UT1 approximately equal to UTC' in result['earth_orientation_note']
    assert all(math.isfinite(v) for v in result['direction_ecliptic'])


def test_earth_flight_still_rejects_invalid_catalog_distance():
    with pytest.raises(ValueError, match='measured distance'):
        exploration.journey_context(269., 4., -1., date='2026-11-15')


def test_proxy_outage_uses_saved_index_with_explicit_warning(monkeypatch):
    def unavailable(*args, **kwargs):
        raise requests.HTTPError('502 Proxy Error')
    monkeypatch.setattr(lab_archive, '_http', lambda: SimpleNamespace(post=unavailable, get=unavailable))
    monkeypatch.setattr(lab_archive, 'saved_discovery', lambda *args: [{'id':'saved-observation'}])
    rows = lab_archive.query({'collections':[], 'sia_endpoint':'https://irsa.ipac.caltech.edu/SIA'}, 269., 4.)
    assert rows[0]['id'] == 'saved-observation'
    assert 'saved subset' in rows[0]['discovery_warning']
    assert rows[0]['discovery_api'] == 'Saved IRSA observation index'


def test_outage_without_saved_coverage_is_actionable(monkeypatch):
    def unavailable(*args, **kwargs):
        raise requests.HTTPError('502 Proxy Error')
    monkeypatch.setattr(lab_archive, '_http', lambda: SimpleNamespace(post=unavailable, get=unavailable))
    monkeypatch.setattr(lab_archive, 'saved_discovery', lambda *args: [])
    with pytest.raises(RuntimeError, match='no saved observations cover this position'):
        lab_archive.query({'collections':[], 'sia_endpoint':'https://irsa.ipac.caltech.edu/SIA'}, 0., 0.)


def test_saved_index_prefers_dr1_and_respects_dates(monkeypatch):
    def row(release, mjd, obs='2025W31_0001_1D3'):
        return {'url':f'https://irsa.ipac.caltech.edu/ibe/data/spherex/{release}/level2/test/level2_{obs}_spx_test.fits','mjd':mjd}
    monkeypatch.setattr(saved_archive, 'local_rows', lambda *args: [row('qr2',60001),row('dr1',60001),row('qr3',60020,'otherD3')])
    monkeypatch.setattr(shared_archive, 'saved_manifest', lambda *args: ([],0))
    rows = lab_archive.saved_discovery(269.,4.,60000,60010)
    assert len(rows) == 1 and rows[0]['release'] == 'DR1'
    assert rows[0]['detector'] == 3


def test_lab_download_uses_shared_mirror_transport(monkeypatch, tmp_path):
    row = {'id':'test_', 'detector':3,'source':'https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/test/level2_test_D3_spx_test.fits'}
    calls=[]
    def download(source, url, destination, ra, dec, fov):
        calls.append((ra,dec,fov))
        destination.write_bytes(b'test pixels')
        return 'IRSA public cloud mirror'
    monkeypatch.setattr(shared_archive,'download_cutout',download)
    monkeypatch.setattr(lab_archive,'fits_metadata',lambda path: {'id':'test_','detector':3})
    monkeypatch.setattr(lab_archive.shutil,'disk_usage',lambda path: SimpleNamespace(free=10**12))
    result=lab_archive.download(row,269.,4.,15,tmp_path)
    assert calls==[(269.,4.,22.5)]
    assert result['transport']=='IRSA public cloud mirror'
    assert result['download_url'].startswith('https://nasa-irsa-spherex.')
    assert result['id']==row['id'] and result['detector']==row['detector']
