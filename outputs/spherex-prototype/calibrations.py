"""Read official science wavelength, pixel-area and ePSF calibrations from IRSA."""
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
import sys
import threading
import xml.etree.ElementTree as ET

DEPS = Path(__file__).resolve().parents[2] / 'work' / 'deps'
if DEPS.exists() and str(DEPS) not in sys.path:
    sys.path.insert(0, str(DEPS))

import numpy as np
import requests
from astropy.io import fits
from astropy.time import Time
from archive import write_json

BUCKET = 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/'
CACHE = Path(__file__).resolve().parents[2] / 'work/prototype-cache/calibrations'
CACHE.mkdir(parents=True, exist_ok=True)
LOCK = threading.RLock()
KINDS = [('qr2','spectral_wcs'), ('qr3','spectral_wcs'),
         ('qr2','solid_angle_pixel_map'), ('qr3','solid_angle_pixel_map'), ('qr3','epsf')]


def discover():
    """List currently published calibration versions, choosing newest per detector."""
    index = {}
    for release, kind in KINDS:
        response = requests.get(BUCKET, params={'list-type':2, 'prefix':f'{release}/{kind}/'}, timeout=(15,60))
        response.raise_for_status()
        root = ET.fromstring(response.content)
        if root.findtext('{*}IsTruncated') == 'true':
            raise ValueError('Calibration listing was truncated.')
        for node in root.findall('.//{*}Key'):
            key = node.text
            match = re.search(r'_D([1-6])_.*-v(\d+)-(\d{4})-(\d{3})\.fits$', key)
            if not match:
                continue
            identity = f'{release}/{kind}/D{match[1]}'
            rank = (int(match[3]+match[4]), int(match[2]))
            if identity not in index or rank > tuple(index[identity]['rank']):
                index[identity] = dict(url=BUCKET+key, detector=int(match[1]), rank=rank,
                                       release=release, kind=kind)
    if len(index) != len(KINDS)*6:
        raise ValueError('Not all expected official calibration products were found.')
    write_json(CACHE/'index.json', {'checked_utc':Time.now().isot+'Z', 'products':index})
    load.cache_clear()
    return index


def product_path(product):
    name = product['url'].rsplit('/',1)[1]
    path = CACHE / f"{product['release']}-{name}"
    with LOCK:
        if not path.exists():
            response = requests.get(product['url'], timeout=(15,120))
            response.raise_for_status()
            temporary = path.with_suffix('.part')
            temporary.write_bytes(response.content)
            try:
                with fits.open(temporary) as hdus:
                    hdus.verify('exception')
                    required = {'spectral_wcs':['CWAVE','CBAND'], 'epsf':['EPSF']}.get(product['kind'],[])
                    if any(name not in hdus for name in required):
                        raise ValueError('Unexpected calibration FITS format.')
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return path, dict(product, sha256=digest, file_bytes=path.stat().st_size)


@lru_cache(maxsize=30)
def load(release, kind, detector):
    index_path = CACHE/'index.json'
    if not index_path.exists():
        discover()
    index = json.loads(index_path.read_text())['products']
    product = index[f'{release}/{kind}/D{detector}']
    path, provenance = product_path(product)
    with fits.open(path, memmap=False) as hdus:
        if kind == 'spectral_wcs':
            return (hdus['CWAVE'].data.copy(), hdus['CBAND'].data.copy()), provenance
        if kind == 'epsf':
            return (hdus['EPSF'].data.copy(), dict(hdus['EPSF'].header)), provenance
        image = next(hdu for hdu in hdus if hdu.data is not None and hdu.data.ndim == 2)
        return image.data.copy(), provenance


def prefetch():
    products = discover()
    for identity, product in products.items():
        path, provenance = product_path(product)
        print(identity, path.stat().st_size, flush=True)
    print('All 30 current science calibration products cached.', flush=True)


if __name__ == '__main__':
    prefetch()
