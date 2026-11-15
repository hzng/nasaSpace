"""Paths for permanent SPHEREx originals and saved cutouts."""
import re
import math
import os
import shutil
import sqlite3
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = Path(os.environ.get('SPHEREX_STORAGE_ROOT', ROOT))
SAVED = STORAGE_ROOT / 'saved-spherex'
STATE = SAVED / 'inventory.sqlite3'
CUTOUTS = SAVED / 'cutouts'

def original_path(key):
    if not re.fullmatch(r'(dr1|qr3)/level2/(?:[A-Za-z0-9_-]+/)+level2_[A-Za-z0-9_-]+\.fits', key):
        raise ValueError('Invalid released spectral-image path.')
    return SAVED / 'originals' / key

def saved_original(key):
    try:
        path = original_path(key)
    except ValueError:
        return None
    return path if path.is_file() else None



@lru_cache(maxsize=2048)
def original_geometry(path):
    from astropy.io import fits
    from astropy.time import Time
    from astropy.wcs import WCS

    header = fits.getheader(path, "IMAGE")
    mjd = float(header["MJD-OBS"])
    return (WCS(header).celestial, int(header["NAXIS1"]), int(header["NAXIS2"]),
            mjd, Time(mjd, format="mjd").isot + "Z")


def local_rows(ra, dec):
    from .archive import key_for
    matches = []
    if STATE.is_file():
        try:
            with sqlite3.connect(f"{STATE.as_uri()}?mode=ro", uri=True, timeout=3) as db:
                keys = db.execute("SELECT key FROM images WHERE sha256 IS NOT NULL").fetchall()
            for (key,) in keys:
                path = saved_original(key)
                if path is None:
                    continue
                try:
                    wcs, width, height, mjd, date = original_geometry(path)
                    x, y = wcs.world_to_pixel_values(ra, dec)
                except (ValueError, KeyError, OSError, TypeError):
                    continue
                if not (math.isfinite(mjd) and -.5 <= x < width-.5 and -.5 <= y < height-.5):
                    continue
                detector = re.search(r"D([1-6])_spx", key)
                if not detector:
                    continue
                detector = int(detector[1])
                url = "https://irsa.ipac.caltech.edu/ibe/data/spherex/" + key
                observation = key.rsplit("/", 1)[-1].split("_spx", 1)[0].removeprefix("level2_")
                matches.append(dict(id=key_for(url), url=url, mjd=mjd, date=date, detector=detector,
                    band=f"SPHEREx-D{detector}", release=key.split("/", 1)[0], observation=observation))
        except sqlite3.Error:
            pass

    lib_path = ROOT / 'cache/observation-lab/featured-library.json'
    if lib_path.is_file():
        try:
            import json
            lib = json.loads(lib_path.read_text(encoding='utf-8'))
            for r in lib.get('records', []):
                center = r.get('center')
                radius = r.get('radius_deg', 1.0)
                if not center or len(center) != 2:
                    continue
                dist = math.hypot((ra - center[0]) * math.cos(math.radians((dec + center[1]) / 2)), dec - center[1])
                if dist <= radius:
                    url = r.get('source')
                    if not url:
                        continue
                    mjd = r.get('mjd')
                    date = r.get('timestamp')
                    det = r.get('detector')
                    rel = r.get('release', '').lower()
                    obs = re.search(r"level2_(.*?)_spx", url)
                    observation = obs.group(1) if obs else url
                    matches.append(dict(id=key_for(url), url=url, mjd=mjd, date=date, detector=det,
                        band=f"SPHEREx-D{det}", release=rel, observation=observation))
        except Exception:
            pass

    return matches


def preserve_cutout(source):
    # The permanent copy is outside the playback cache's eviction budget.
    if source.parent != SAVED.parent / "cache" or not CUTOUTS.is_dir():
        return
    destination = CUTOUTS / source.name
    try:
        if not destination.exists() and shutil.disk_usage(CUTOUTS).free > 40 * 1024**3:
            os.link(source, destination)
    except OSError:
        pass


def restore_cutout(cache, identity):
    if cache != SAVED.parent / "cache":
        return
    for extension in (".fits", ".npy", ".npz", ".json"):
        source = CUTOUTS / (identity + extension)
        destination = cache / source.name
        if source.is_file() and not destination.exists():
            shutil.copyfile(source, destination)

def inventory_status(db):
    by_release = {}
    for release, inventory, total_bytes, saved, saved_bytes, failures in db.execute("""
        SELECT substr(prefix,1,instr(prefix,'/')-1), count(*), coalesce(sum(size),0),
           sum(sha256 IS NOT NULL), coalesce(sum(CASE WHEN sha256 IS NOT NULL THEN size END),0),
           sum(error IS NOT NULL) FROM images GROUP BY 1
    """):
        by_release[release] = dict(inventory=inventory, inventory_bytes=total_bytes,
            saved=saved, saved_bytes=saved_bytes, errors=failures)
    periods, complete = db.execute('SELECT count(*),coalesce(sum(done),0) FROM periods').fetchone()
    return dict(releases=by_release, periods=periods, periods_indexed=complete)

def prefetch_status():
    if not STATE.is_file():
        return {"releases": {}, "periods": 0, "periods_indexed": 0}
    with sqlite3.connect(f"{STATE.as_uri()}?mode=ro", uri=True, timeout=3) as db:
        return inventory_status(db)
