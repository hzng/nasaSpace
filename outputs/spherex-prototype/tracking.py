"""Conservative native-image centroids and independently sourced Gaia space motion."""
import json, hashlib
from io import BytesIO
from pathlib import Path
import numpy as np
import requests
from scipy.optimize import least_squares
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.time import Time
from astropy.io import fits
from astropy.io.votable import parse_single_table
from astropy.wcs import WCS
import ephemeris
from science import BAD_MASK, grid_for

REJECT = BAD_MASK | sum(1 << b for b in (0,1,19,20,22,23,24,25))
DEFAULT_LIMITATIONS = [
    'Apparent sky drift includes parallax and calibration errors; not a pure proper-motion measurement.',
    'A positional match is not a confirmed identification. Blends and wavelength-dependent centroids can bias the track.',
    'Without Gaia, a JPL Horizons designation or a 2nd-frame anchor, fast jumps across unrelated visits can be missed.',
    '3D motion uses Gaia distance and velocity, not depth inferred from image centroids. Solar System barycenter is the reference origin.',
]


def _quadrant_support(xx, yy, cx0, cy0, excess, threshold):
    """Count distinct quadrants around (cx0, cy0) with signal above threshold."""
    above = excess > threshold
    return sum([
        bool(np.any(above & (xx >= cx0) & (yy >= cy0))),
        bool(np.any(above & (xx < cx0) & (yy >= cy0))),
        bool(np.any(above & (xx >= cx0) & (yy < cy0))),
        bool(np.any(above & (xx < cx0) & (yy < cy0))),
    ])


def _centroid_wing(h, w, x, y, search_px):
    """Fit a saturated or core-flagged bright source using clean PSF wings."""
    ix, iy = round(x), round(y)
    ny, nx = h['IMAGE'].shape
    pad = max(10, int(np.ceil(search_px)) + 6)
    x0, x1 = max(0, ix - pad), min(nx, ix + pad + 1)
    y0, y1 = max(0, iy - pad), min(ny, iy + pad + 1)
    if x1 - x0 < 9 or y1 - y0 < 9:
        raise ValueError('Outside usable detector area')
    sl = np.s_[y0:y1, x0:x1]
    data = np.array(h['IMAGE'].section[sl], float)
    var = np.array(h['VARIANCE'].section[sl], float)
    flags = np.array(h['FLAGS'].section[sl], np.int64)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    ex, ey = x, y
    dist = np.hypot(xx - ex, yy - ey)

    clean = np.isfinite(data) & np.isfinite(var) & (var > 0) & ((flags & REJECT) == 0)
    bg_ring = clean & (dist >= 7.5)
    bg_src = data[bg_ring] if np.any(bg_ring) else data[clean]
    if bg_src.size < 8:
        raise ValueError('Too few clean pixels for wing centroid')
    bg = float(np.median(bg_src))
    mad = max(0.05, float(np.median(np.abs(bg_src - bg))) * 1.4826)

    # Refine initial center inside search box if a clean halo peak or flagged bright core exists
    search_zone = dist <= (search_px + 2.0)
    finite_zone = search_zone & np.isfinite(data)
    if np.any(clean & search_zone):
        zvals = np.where(clean & search_zone, data - bg, -np.inf)
        py_i, px_i = np.unravel_index(np.argmax(zvals), zvals.shape)
        if zvals[py_i, px_i] > 4.0 * mad:
            local = np.hypot(xx - xx[py_i, px_i], yy - yy[py_i, px_i]) <= 5.5
            wflux = np.where(clean & local, np.maximum(data - bg - 2.0 * mad, 0.0), 0.0)
            if np.sum(wflux) > 0:
                ex = float(np.sum(xx * wflux) / np.sum(wflux))
                ey = float(np.sum(yy * wflux) / np.sum(wflux))
    elif np.any(finite_zone):
        wflux = np.where(finite_zone, np.maximum(data - bg - 3.0 * mad, 0.0), 0.0)
        if np.sum(wflux) > 0:
            ex = float(np.sum(xx * wflux) / np.sum(wflux))
            ey = float(np.sum(yy * wflux) / np.sum(wflux))

    # Require centroid near initial search prediction
    if np.hypot(ex - x, ey - y) > (search_px + 3.0):
        ex, ey = x, y

    rc = np.hypot(xx - ex, yy - ey)
    radius = 6.5
    fit_mask = clean & (rc <= radius)
    if np.count_nonzero(fit_mask) < 18:
        radius = 10.0
        fit_mask = clean & (rc <= radius)
    if np.count_nonzero(fit_mask) < 18:
        raise ValueError('Too few clean wing pixels for centroid')

    px, py = xx[fit_mask], yy[fit_mask]
    z, v = data[fit_mask], var[fit_mask]
    quads = _quadrant_support(px, py, ex, ey, z - bg, 3.0 * mad)
    if quads < 3:
        raise ValueError('Weak, single-pixel spike or off-source wing')

    # Fractional PSF uncertainty floor prevents formal photon variance from blowing up wing chi2.
    sig_eff = np.sqrt(np.maximum(v, mad * mad) + (0.12 * np.maximum(z - bg, 0.0)) ** 2)
    amp0 = max(float(np.max(z - bg)) * 2.0, 4.0 * mad)
    step = max(2.5, search_px + 1.5)
    lo = [0.0, x - step, y - step, 0.65, -np.inf]
    hi = [np.inf, x + step, y + step, 4.2, np.inf]
    p0 = [amp0, np.clip(ex, lo[1] + 0.05, hi[1] - 0.05), np.clip(ey, lo[2] + 0.05, hi[2] - 0.05), 1.6, bg]

    def residual(p):
        a, cx, cy, s, b = p
        g = np.exp(-((px - cx) ** 2 + (py - cy) ** 2) / (2.0 * s * s))
        return (b + a * g - z) / sig_eff

    fit = least_squares(residual, p0, bounds=(lo, hi), loss='soft_l1', f_scale=2.0)
    a, cx, cy, s, b = fit.x
    chi = float(np.sum(fit.fun ** 2) / max(1, px.size - 5))
    cov = np.linalg.pinv(fit.jac.T @ fit.jac) * max(1.0, chi)
    snr = float(a / max(float(np.sqrt(max(cov[0, 0], 1e-30))), mad))
    peak_snr = float((np.max(z) - bg) / mad)
    if (
        not fit.success
        or (snr < 3.5 and peak_snr < 10.0)
        or peak_snr < 5.0
        or a < 4.0 * mad
        or chi > 25.0
        or abs(cx - x) > step - 0.1
        or abs(cy - y) > step - 0.1
        or s > 4.0
        or _quadrant_support(px, py, cx, cy, z - b, 3.0 * mad) < 3
    ):
        raise ValueError('Weak, blended or poorly fitted wing source; no reliable position')

    skyfit = w.pixel_to_world(cx, cy)
    error = max(0.8, 6.15 * float(np.sqrt(max(cov[1, 1], cov[2, 2], 0.0))))
    peak_val = float(np.max(data[search_zone & np.isfinite(data)])) if np.any(search_zone & np.isfinite(data)) else float(a + b)
    return skyfit, dict(snr=snr, fit_chi2=chi, error_arcsec=error, fit_mode='wing', flux_peak=peak_val)


def centroid(path, sky, *, search_px=2.0, allow_wing=False):
    with fits.open(path, memmap=True) as h:
        w = WCS(h['IMAGE'].header).celestial
        x, y = map(float, w.world_to_pixel(sky))
        if not np.isfinite(x + y):
            raise ValueError('Outside usable detector area')
        ix, iy = round(x), round(y)
        ny, nx = h['IMAGE'].shape
        pad = 5 if (not allow_wing and search_px <= 2.0) else max(5, int(np.ceil(search_px)) + 3)
        if ix < pad or iy < pad or ix >= nx - pad or iy >= ny - pad:
            if allow_wing:
                return _centroid_wing(h, w, x, y, search_px)
            raise ValueError('Outside usable detector area')
        sl = np.s_[iy - pad:iy + pad + 1, ix - pad:ix + pad + 1]
        data = np.array(h['IMAGE'].section[sl], float)
        var = np.array(h['VARIANCE'].section[sl], float)
        flags = np.array(h['FLAGS'].section[sl], np.int64)
        xx, yy = np.meshgrid(np.arange(2 * pad + 1), np.arange(2 * pad + 1))
        ex, ey = x - ix + pad, y - iy + pad
        good = np.isfinite(data) & np.isfinite(var) & (var > 0) & ((flags & REJECT) == 0)
        core = (xx - ex) ** 2 + (yy - ey) ** 2 < 4

        # When wider search allowed on core fit, re-center initial guess on best clean peak
        if search_px > 2.0 and np.any(good & ((xx - ex) ** 2 + (yy - ey) ** 2 <= search_px ** 2)):
            bg0 = float(np.median(data[good]))
            cand = np.where(good & ((xx - ex) ** 2 + (yy - ey) ** 2 <= search_px ** 2), data - bg0, -np.inf)
            py0, px0 = np.unravel_index(np.argmax(cand), cand.shape)
            if cand[py0, px0] > 3.0 * max(0.05, float(np.median(np.abs(data[good] - bg0))) * 1.4826):
                ex, ey = float(px0), float(py0)
                core = (xx - ex) ** 2 + (yy - ey) ** 2 < 4

        if good.sum() < 50 or np.any(~good & core):
            if allow_wing:
                return _centroid_wing(h, w, x, y, search_px)
            raise ValueError('Saturated, flagged or missing source core')

        bg = float(np.median(data[good]))
        amp = max(float(np.max(data[good]) - bg), 1e-6)
        sx0, sy0 = x - ix + pad, y - iy + pad
        bound_px = max(2.0, search_px)

        def residual(p):
            a, cx, cy, s, b = p
            return ((a * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * s * s)) + b - data)[good] / np.sqrt(var[good]))

        fit = least_squares(
            residual,
            [amp, ex, ey, 1.0, bg],
            bounds=([0, sx0 - bound_px, sy0 - bound_px, 0.5, -np.inf], [np.inf, sx0 + bound_px, sy0 + bound_px, 2.5, np.inf]),
        )
        a, cx, cy, s, b = fit.x
        chi = float(np.sum(fit.fun ** 2) / max(1, good.sum() - 5))
        cov = np.linalg.pinv(fit.jac.T @ fit.jac) * max(1, chi)
        snr = float(a / np.sqrt(max(cov[0, 0], 1e-30)))
        if not fit.success or snr < 5 or chi > 10 or abs(cx - sx0) > bound_px - 0.1 or abs(cy - sy0) > bound_px - 0.1 or s > 2.45:
            if allow_wing:
                return _centroid_wing(h, w, x, y, search_px)
            raise ValueError('Weak, blended or poorly fitted source; no reliable position')
        skyfit = w.pixel_to_world(cx + ix - pad, cy + iy - pad)
        # Include a conservative display/astrometric floor, not a calibrated global error model.
        error = max(0.5, 6.15 * float(np.sqrt(max(cov[1, 1], cov[2, 2], 0))))
        peak_val = float(a + b)
        meta = dict(snr=snr, fit_chi2=chi, error_arcsec=error)
        if allow_wing:
            meta.update(fit_mode='core', flux_peak=peak_val)
        return skyfit, meta

def space_coord(r):
    args=dict(ra=r['ra']*u.deg,dec=r['dec']*u.deg,pm_ra_cosdec=r['pmra']*u.mas/u.yr,
              pm_dec=r['pmdec']*u.mas/u.yr,obstime=Time(r['epoch'],format='jyear'))
    if (r.get('parallax') or 0)>0: args['distance']=1000/r['parallax']*u.pc
    if r.get('radial_velocity') is not None and 'distance' in args: args['radial_velocity']=r['radial_velocity']*u.km/u.s
    return SkyCoord(**args)

def identify(sky,mjd,cache,progress):
    progress('Looking for a Gaia counterpart at the observation date')
    # Data Lab accepts these numeric bounds; its endpoint does not implement ADQL POINT.
    ra,dec=float(sky.ra.deg),float(sky.dec.deg)
    width=min(180,.1/max(.00001,np.cos(np.deg2rad(dec))))
    low,high=(ra-width)%360,(ra+width)%360
    rasql='1=1' if width==180 else (f'(ra>={low:.9f} AND ra<={high:.9f})' if low<high else f'(ra>={low:.9f} OR ra<={high:.9f})')
    query=f"""SELECT source_id,ra,dec,ref_epoch,parallax,parallax_error,pmra,pmdec,
        radial_velocity,radial_velocity_error,ruwe FROM gaia_dr3.gaia_source
        WHERE {rasql} AND dec>={max(-90,dec-.1):.9f} AND dec<={min(90,dec+.1):.9f}"""
    dest=cache/'tracking-catalog';dest.mkdir(exist_ok=True)
    path=dest/(hashlib.sha256(query.encode()).hexdigest()+'.xml')
    if not path.exists():
        response=requests.post('https://datalab.noirlab.edu/tap/sync',data={'REQUEST':'doQuery','LANG':'ADQL','QUERY':query,'FORMAT':'votable','MAXREC':20000},timeout=(10,70))
        response.raise_for_status()
        if b'OVERFLOW' in response.content or b'value="ERROR"' in response.content:
            (dest/'last-error.xml').write_bytes(response.content)
            raise ValueError('Catalog query incomplete or unavailable')
        path.write_bytes(response.content)
    table=parse_single_table(BytesIO(path.read_bytes())).to_table(use_names_over_ids=True)
    def val(x): return None if np.ma.is_masked(x) or not np.isfinite(float(x)) else float(x)
    candidates=[]
    for row in table:
        r={k:val(row[k]) for k in ('ra','dec','parallax','parallax_error','pmra','pmdec','radial_velocity','radial_velocity_error','ruwe')}
        if r['pmra'] is None or r['pmdec'] is None: continue
        r.update(id=str(row['source_id']),name='Gaia DR3 '+str(row['source_id']),epoch=float(row['ref_epoch']))
        c=space_coord(r); at=c.apply_space_motion(Time(mjd,format='mjd'))
        separation=float(at.separation(sky).arcsec)
        if separation<=6.15: candidates.append((separation,r,c))
    candidates.sort(key=lambda x:x[0])
    if len(candidates)!=1: return None, 'No unique Gaia match within 6.15 arcsec; identity and physical 3D motion unavailable.'
    sep,r,c=candidates[0]
    r.update(match_separation_arcsec=sep,source_url='https://www.cosmos.esa.int/web/gaia/data-release-3',query=query,raw_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    reliable=r['parallax'] and r['parallax_error'] and r['parallax']/r['parallax_error']>20 and r['ruwe'] is not None and r['ruwe']<1.4
    r['xyz']=c.cartesian.xyz.to_value(u.pc).tolist() if reliable else None
    r['velocity']=c.velocity.d_xyz.to_value(u.pc/u.yr).tolist() if reliable and r['radial_velocity'] is not None else None
    r['distance_pc']=1000/r['parallax'] if reliable else None
    return r,'Gaia positional association; check crowded or blended sources.'

def _visit_groups(accepted, ref_sky, span_days):
    """Group rapid intra-visit exposures when the arc spans weeks/months."""
    pts = sorted(accepted, key=lambda p: p['mjd'])
    if span_days <= 14 or len(pts) <= 6:
        groups = [[p] for p in pts]
    else:
        groups = [[pts[0]]]
        for p in pts[1:]:
            if p['mjd'] - groups[-1][-1]['mjd'] <= 1.0:
                groups[-1].append(p)
            else:
                groups.append([p])
    visits = []
    for g in groups:
        w = np.array([1.0 / max(p['error_arcsec'], 0.3) ** 2 for p in g], float)
        wsum = float(np.sum(w))
        mjd = float(np.sum(np.array([p['mjd'] for p in g]) * w) / wsum)
        east = float(np.sum(np.array([p['east_arcsec'] for p in g]) * w) / wsum)
        north = float(np.sum(np.array([p['north_arcsec'] for p in g]) * w) / wsum)
        err = max(0.3, float(1.0 / np.sqrt(wsum)))
        sky = ref_sky.spherical_offsets_by(east * u.arcsec, north * u.arcsec)
        fluxes = [p['flux_peak'] for p in g if p.get('flux_peak') is not None]
        visits.append(dict(
            index=g[-1]['index'],
            timestamp=g[len(g) // 2]['timestamp'],
            mjd=mjd,
            east_arcsec=east,
            north_arcsec=north,
            error_arcsec=err,
            sky=sky,
            flux_peak=float(np.median(fluxes)) if fluxes else None,
            count=len(g),
        ))
    return visits


def _kinematics(points, ref_sky, reference_mjd):
    """Compute velocity, step segments, and change-of-movement (acceleration/turning)."""
    accepted = sorted([p for p in points if p['accepted']], key=lambda p: p['mjd'])
    if len(accepted) < 2:
        return None, [], None
    span_days = float(accepted[-1]['mjd'] - accepted[0]['mjd'])
    if span_days < 0.02:
        return None, [], None

    pref_unit = 'hr' if span_days < 14 else 'yr'
    t_yr = (np.array([p['mjd'] for p in accepted]) - reference_mjd) / 365.25
    err = np.array([max(p['error_arcsec'], 0.3) for p in accepted], float)
    design = np.column_stack([np.ones(len(t_yr)), t_yr])

    motion = {}
    for axis in ('east', 'north'):
        a = design / err[:, None]
        b = np.array([p[axis + '_arcsec'] for p in accepted]) / err
        coeff = np.linalg.lstsq(a, b, rcond=None)[0]
        res = b - a @ coeff
        cov = np.linalg.pinv(a.T @ a) * max(1.0, float(res @ res / max(1, len(t_yr) - 2)))
        motion[axis + '_arcsec_per_year'] = float(coeff[1])
        motion[axis + '_error'] = float(np.sqrt(max(cov[1, 1], 0.0)))

    ve = motion['east_arcsec_per_year']
    vn = motion['north_arcsec_per_year']
    speed_yr = float(np.hypot(ve, vn))
    speed_hr = speed_yr / (365.25 * 24.0)
    heading_deg = float((np.degrees(np.arctan2(ve, vn)) + 360.0) % 360.0)

    visits = _visit_groups(accepted, ref_sky, span_days)
    segments = []
    cum_arcsec = 0.0
    for k in range(len(visits) - 1):
        v0, v1 = visits[k], visits[k + 1]
        dt_days = float(v1['mjd'] - v0['mjd'])
        if dt_days <= 1e-4:
            continue
        de, dn = v0['sky'].spherical_offsets_to(v1['sky'])
        dist = float(np.hypot(de.arcsec, dn.arcsec))
        cum_arcsec += dist
        dt_hr = dt_days * 24.0
        pa = float(v0['sky'].position_angle(v1['sky']).deg) if dist > 0.01 else heading_deg
        segments.append(dict(
            from_index=v0['index'],
            to_index=v1['index'],
            timestamp=v1['timestamp'],
            mjd_start=v0['mjd'],
            mjd_end=v1['mjd'],
            mjd_mid=0.5 * (v0['mjd'] + v1['mjd']),
            dt_hours=dt_hr,
            de_arcsec=float(de.arcsec),
            dn_arcsec=float(dn.arcsec),
            dist_arcsec=dist,
            cumulative_arcsec=cum_arcsec,
            speed_arcsec_per_hr=dist / dt_hr,
            speed_arcsec_per_yr=dist / (dt_days / 365.25),
            pa_deg=pa,
            flux_peak=v1.get('flux_peak'),
        ))

    net_de, net_dn = visits[0]['sky'].spherical_offsets_to(visits[-1]['sky'])
    net_arcsec = float(np.hypot(net_de.arcsec, net_dn.arcsec))
    motion.update(
        speed_arcsec_per_year=speed_yr,
        speed_arcsec_per_hr=speed_hr,
        heading_deg=heading_deg,
        span_days=span_days,
        net_arcsec=net_arcsec,
        total_path_arcsec=cum_arcsec if segments else net_arcsec,
        preferred_unit=pref_unit,
    )

    change = None
    if len(visits) >= 3 and span_days >= 0.2:
        t_vals = np.array([v['mjd'] for v in visits], float)
        t_mid = 0.5 * (t_vals[0] + t_vals[-1])
        denom = 1.0 if span_days < 14 else 365.25
        tau = (t_vals - t_mid) / denom
        v_err = np.array([v['error_arcsec'] for v in visits], float)
        e_vals = np.array([v['east_arcsec'] for v in visits], float)
        n_vals = np.array([v['north_arcsec'] for v in visits], float)

        X1 = np.column_stack([np.ones_like(tau), tau])
        X2 = np.column_stack([np.ones_like(tau), tau, 0.5 * tau ** 2])
        W = 1.0 / v_err
        a1, b1 = X1 * W[:, None], np.column_stack([e_vals, n_vals]) * W[:, None]
        c1 = np.linalg.lstsq(a1, b1, rcond=None)[0]
        res1 = np.hypot(*( (X1 @ c1 - np.column_stack([e_vals, n_vals])).T ))
        rms_lin = float(np.sqrt(np.mean(res1 ** 2)))

        a2 = X2 * W[:, None]
        c2 = np.linalg.lstsq(a2, b1, rcond=None)[0]
        res2 = np.hypot(*( (X2 @ c2 - np.column_stack([e_vals, n_vals])).T ))
        rms_quad = float(np.sqrt(np.mean(res2 ** 2)))
        dof2 = max(1, len(visits) - 3)
        chi2_e = float(np.sum(((X2 @ c2[:, 0] - e_vals) * W) ** 2) / dof2)
        chi2_n = float(np.sum(((X2 @ c2[:, 1] - n_vals) * W) ** 2) / dof2)
        cov_t = np.linalg.pinv(a2.T @ a2)
        var_ae = float(max(cov_t[2, 2], 0.0) * max(1.0, chi2_e))
        var_an = float(max(cov_t[2, 2], 0.0) * max(1.0, chi2_n))

        ae, an = float(c2[2, 0]), float(c2[2, 1])
        amag = float(np.hypot(ae, an))
        aerr = float(np.sqrt(max(var_ae, var_an, 1e-12)))
        asnr = float(amag / max(aerr, 1e-9)) if amag > 0 else 0.0

        # Velocity vector at midpoint & along-track projection
        ve_mid, vn_mid = float(c2[1, 0]), float(c2[1, 1])
        vmid = float(np.hypot(ve_mid, vn_mid))
        accel_along = float((ae * ve_mid + an * vn_mid) / vmid) if vmid > 1e-9 else 0.0
        accel_perp = float((ve_mid * an - vn_mid * ae) / vmid) if vmid > 1e-9 else 0.0

        key_sp = 'speed_arcsec_per_hr' if pref_unit == 'hr' else 'speed_arcsec_per_yr'
        v_start = segments[0][key_sp]
        v_end = segments[-1][key_sp]
        turn_deg = float((segments[-1]['pa_deg'] - segments[0]['pa_deg'] + 540.0) % 360.0 - 180.0)
        perp_snr = abs(accel_perp) / max(aerr, 1e-9)
        min_snr = 3.0 if len(visits) == 3 else 2.2

        if len(segments) >= 2 and abs(turn_deg) >= 8.0 and (perp_snr >= min_snr or (len(visits) >= 4 and rms_quad < 0.7 * rms_lin)):
            state = 'Curving path'
        elif asnr >= min_snr and accel_along > 0 and (len(visits) == 3 or rms_quad < 0.85 * rms_lin):
            state = 'Speeding up'
        elif asnr >= min_snr and accel_along < 0 and (len(visits) == 3 or rms_quad < 0.85 * rms_lin):
            state = 'Slowing down'
        else:
            state = 'Steady motion'

        change = dict(
            state=state,
            accel_east=ae,
            accel_north=an,
            accel_mag=amag,
            accel_error=aerr,
            accel_snr=asnr,
            accel_unit='″/day²' if pref_unit == 'hr' else '″/yr²',
            speed_start=float(v_start),
            speed_end=float(v_end),
            speed_delta=float(v_end - v_start),
            speed_delta_pct=float(100.0 * (v_end - v_start) / v_start) if v_start > 1e-9 else 0.0,
            speed_unit='″/hr' if pref_unit == 'hr' else '″/yr',
            turn_deg=turn_deg,
            rms_linear_arcsec=rms_lin,
            rms_quad_arcsec=rms_quad,
            visit_count=len(visits),
        )
    return motion, segments, change


def track(manifest, paths, payload, cache, progress):
    grid, size = grid_for(manifest['options'])
    index = int(payload.get('frame', 0))
    x, y = float(payload.get('x', 0.5)), float(payload.get('y', 0.5))
    obj = str(payload.get('object') or '').strip()
    clicked = 'x' in payload and 'y' in payload
    if (clicked or not obj) and not (0 <= x < 1 and 0 <= y < 1):
        raise ValueError('Click a star or moving object inside the image.')
    frames = manifest['frames']
    reference = frames[index]
    guess = grid.pixel_to_world(x * size - 0.5, (1 - y) * size - 0.5)

    # 0. Ephemeris mode: JPL Horizons gives the predicted position at each exposure midpoint
    eph, warnings = None, []
    if obj:
        mids, n_start = [], 0
        for i, frame in enumerate(frames):
            try:
                with fits.open(paths[i], memmap=True) as h:
                    mid, scale = float(h['IMAGE'].header['MJD-AVG']), str(h['IMAGE'].header.get('TIMESYS', 'UTC')).strip().lower()
                # Horizons is asked in UT; a header in another time scale is converted, not assumed
                mids.append(mid if scale == 'utc' else float(Time(mid, format='mjd', scale=scale).utc.mjd))
            except KeyError:
                mids.append(float(frame['mjd']))
                n_start += 1
        progress('Asking JPL Horizons for the predicted position')
        eph = ephemeris.fetch(obj, [m + 2400000.5 for m in mids], cache)
        rows = eph.pop('rows')
        warnings = list(eph['warnings'])
        if n_start:
            warnings.append(f'{n_start} of {len(frames)} frames have no MJD-AVG; the exposure start was used instead of the midpoint.')
        pred = [SkyCoord(float(r['ra']), float(r['dec']), unit='deg') for r in rows]
        if clicked:
            click_sep = float(pred[index].separation(guess).arcsec)
            if click_sep > 45.0:
                warnings.append(f'Your click is {click_sep:.0f}″ from the ephemeris position; the ephemeris position is being tracked.')
        guess = pred[index]

    # 1. Measure or establish reference point (wing fit rescues bright saturated cores!)
    reference_warning = None
    try:
        ref, ref_q = centroid(paths[index], guess, search_px=3.0, allow_wing=True)
    except ValueError as error:
        ref = guess
        ref_q = None
        reference_warning = str(error)

    # 2. Choose tracking guide mode: JPL Horizons object > 2nd-frame manual anchor > Gaia DR3 > local kinematic
    anchor2 = payload.get('anchor2')
    predictor = None
    catalog, note = None, ''
    target_kind = 'star'
    search_px = 2.5

    if eph is not None:
        target_kind = 'asteroid'
        search_px = 3.0
        note = 'JPL Horizons predicted position; positions measured independently on each frame.'
    elif isinstance(anchor2, dict) and anchor2.get('frame') is not None:
        f2 = int(anchor2['frame'])
        x2, y2 = float(anchor2.get('x', 0.5)), float(anchor2.get('y', 0.5))
        if f2 == index or not (0 <= f2 < len(frames)) or not (0 <= x2 < 1 and 0 <= y2 < 1):
            raise ValueError('Choose a different frame inside the image for the 2nd anchor.')
        dt2 = float(frames[f2]['mjd'] - reference['mjd'])
        if abs(dt2) < 1e-4:
            raise ValueError('The 2nd anchor frame has the same timestamp as the 1st.')
        guess2 = grid.pixel_to_world(x2 * size - 0.5, (1 - y2) * size - 0.5)
        try:
            ref2, _ = centroid(paths[f2], guess2, search_px=4.0, allow_wing=True)
        except ValueError:
            ref2 = guess2
        de2, dn2 = ref.spherical_offsets_to(ref2)
        ve_day, vn_day = float(de2.arcsec / dt2), float(dn2.arcsec / dt2)
        ref_mjd0 = float(reference['mjd'])
        predictor = lambda mjd: ref.spherical_offsets_by(ve_day * (mjd - ref_mjd0) * u.arcsec, vn_day * (mjd - ref_mjd0) * u.arcsec)
        target_kind = 'asteroid'
        search_px = 4.0
        note = 'No ephemeris: two-frame linear guide supplied by the user, for unidentified objects only.'

    if predictor is None and eph is None:
        try:
            catalog, note = identify(ref, reference['mjd'], cache, progress)
        except Exception as e:
            catalog, note = None, 'Catalog unavailable: ' + str(e)[:180]
        if reference_warning and catalog is None:
            raise ValueError(reference_warning + '. No unique catalog counterpart was found. Select a clearer source or add a 2nd anchor.')
        if catalog is not None:
            target_kind = 'star'
        else:
            target_kind = 'source'

    # 3. Measure centroids across frames (using predictor / Gaia or sequential kinematic search)
    points = [None] * len(frames)
    if predictor is not None or catalog is not None or eph is not None:
        gaia_coord = space_coord(catalog) if catalog is not None else None
        for i, frame in enumerate(frames):
            progress(f'Measuring source position {i + 1} / {len(frames)}')
            if eph is not None:
                expected = pred[i]
            else:
                expected = gaia_coord.apply_space_motion(Time(frame['mjd'], format='mjd')) if gaia_coord is not None else predictor(frame['mjd'])
            if expected is None:
                points[i] = dict(index=i, id=frame['id'], mjd=frame['mjd'], timestamp=frame['timestamp'],
                                 predicted=None, source=frame.get('source'), sha256=frame['sha256'],
                                 accepted=False, reason='Outside moving-target epoch window')
                continue
            gx, gy = grid.world_to_pixel(expected)
            on_grid = -16 <= gx <= size + 16 and -16 <= gy <= size + 16
            item = dict(index=i, id=frame['id'], mjd=frame['mjd'], timestamp=frame['timestamp'],
                        predicted=[float((gx + 0.5) / size), float(1 - (gy + 0.5) / size)] if on_grid else None,
                        source=frame.get('source'), sha256=frame['sha256'])
            if eph is not None:
                pe, pn = ref.spherical_offsets_to(expected)
                r = rows[i]
                item.update(mjd_mid=mids[i], predicted_sky=[float(expected.ra.deg), float(expected.dec.deg)],
                            predicted_east_arcsec=float(pe.arcsec), predicted_north_arcsec=float(pn.arcsec),
                            rate_arcsec_per_hr=[float(r['dra_cosdec']), float(r['ddec'])],
                            delta_au=float(r['delta_au']), light_time_min=float(r['light_time_min']))
            if not on_grid:
                item.update(accepted=False, reason='Predicted position outside field of view')
                points[i] = item
                continue
            try:
                measured, q = centroid(paths[i], expected, search_px=search_px, allow_wing=True)
                mx, my = grid.world_to_pixel(measured)
                east, north = ref.spherical_offsets_to(measured)
                item.update(accepted=True, ra=float(measured.ra.deg), dec=float(measured.dec.deg),
                            xy=[float((mx + 0.5) / size), float(1 - (my + 0.5) / size)],
                            east_arcsec=float(east.arcsec), north_arcsec=float(north.arcsec), **q)
                if eph is not None:
                    oe, on = expected.spherical_offsets_to(measured)
                    tol = max(3 * q['error_arcsec'], 3.1)
                    off = float(np.hypot(oe.arcsec, on.arcsec))
                    item.update(offset_east_arcsec=float(oe.arcsec), offset_north_arcsec=float(on.arcsec),
                                offset_arcsec=off, tolerance_arcsec=float(tol), within_tolerance=bool(off <= tol))
            except ValueError as e:
                item.update(accepted=False, reason=str(e))
            points[i] = item
    else:
        # Blind local kinematic propagation outward from reference index in chronological order
        order_fwd = sorted([i for i in range(len(frames)) if frames[i]['mjd'] >= reference['mjd']], key=lambda i: frames[i]['mjd'])
        order_bwd = sorted([i for i in range(len(frames)) if frames[i]['mjd'] < reference['mjd']], key=lambda i: -frames[i]['mjd'])
        for direction in (order_fwd, order_bwd):
            cur_sky = ref
            cur_mjd = float(reference['mjd'])
            ve_day, vn_day = 0.0, 0.0
            for idx_num, i in enumerate(direction):
                frame = frames[i]
                progress(f'Measuring source position {i + 1} / {len(frames)}')
                dt = float(frame['mjd'] - cur_mjd)
                expected = cur_sky.spherical_offsets_by(ve_day * dt * u.arcsec, vn_day * dt * u.arcsec) if abs(dt) > 1e-4 else cur_sky
                step_lim = 8.0 if abs(dt) <= 2.0 else 3.0
                gx, gy = grid.world_to_pixel(expected)
                item = dict(index=i, id=frame['id'], mjd=frame['mjd'], timestamp=frame['timestamp'],
                            predicted=None, source=frame.get('source'), sha256=frame['sha256'])
                try:
                    measured, q = centroid(paths[i], expected, search_px=step_lim, allow_wing=True)
                    mx, my = grid.world_to_pixel(measured)
                    east, north = ref.spherical_offsets_to(measured)
                    item.update(accepted=True, ra=float(measured.ra.deg), dec=float(measured.dec.deg),
                                xy=[float((mx + 0.5) / size), float(1 - (my + 0.5) / size)],
                                east_arcsec=float(east.arcsec), north_arcsec=float(north.arcsec), **q)
                    if abs(dt) >= 0.02:
                        de_s, dn_s = cur_sky.spherical_offsets_to(measured)
                        ve_day = float(de_s.arcsec / dt)
                        vn_day = float(dn_s.arcsec / dt)
                    cur_sky, cur_mjd = measured, float(frame['mjd'])
                except ValueError as e:
                    item.update(accepted=False, reason=str(e))
                points[i] = item

    # Ephemeris mode: measured and predicted motion share the exposure midpoints and the accepted frames
    motion, segments, change = (_kinematics([dict(p, mjd=p['mjd_mid']) for p in points], ref, mids[index]) if eph is not None
                                else _kinematics(points, ref, reference['mjd']))
    limitations = DEFAULT_LIMITATIONS
    if eph is not None:
        offs = [p['offset_arcsec'] for p in points if 'offset_arcsec' in p]
        pp = [dict(accepted=p['accepted'], index=p['index'], timestamp=p['timestamp'], mjd=p['mjd_mid'], error_arcsec=0.3,  # _kinematics floor; predictions carry no centroid error
                   east_arcsec=p['predicted_east_arcsec'], north_arcsec=p['predicted_north_arcsec'])
              for p in points if 'mjd_mid' in p]
        pm, _, pc = _kinematics(pp, ref, mids[index])
        eph.update(time_scale='UTC, exposure midpoint (FITS MJD-AVG)', warnings=warnings,
                   offset_median_arcsec=float(np.median(offs)) if offs else None,
                   offset_max_arcsec=float(max(offs)) if offs else None,
                   compared=len(offs), flagged=sum(not p['within_tolerance'] for p in points if 'within_tolerance' in p),
                   tolerance_rule='max(3 × centroid error, 3.1″)', motion=pm, change=pc)
        limitations = DEFAULT_LIMITATIONS + [
            'The tolerance is a display rule, not a calibrated astrometric error model.',
            "Horizons' SPHEREx trajectory is built from two-line elements (checked to agree with the FITS header spacecraft position to about 2 km).",
        ]
    return dict(
        session=manifest['id'],
        reference_index=index,
        reference_warning=reference_warning,
        target_kind=target_kind,
        points=points,
        segments=segments,
        catalog=catalog,
        catalog_note=note,
        motion=motion,
        change=change,
        ephemeris=eph,
        model='Native-pixel 2D Gaussian core + PSF wing fallback; JPL Horizons predicted position (or Gaia / 2-frame guide) compared with measured centroids; quadratic kinematics',
        limitations=limitations,
    )
