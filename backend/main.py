import io
import json
import threading
from collections import deque
import time
import uuid
from datetime import datetime, timezone

def progress(job, stage):
    job.update(stage=stage, last_progress_at=datetime.now(timezone.utc).isoformat())
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, as_completed, wait
from pathlib import Path
import numpy as np
from PIL import Image
from matplotlib import colormaps
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from astroquery.simbad import Simbad
from .archive import CONFIG, CACHE, ROOT, discover, fetch_frame, atomic_json, prune_cache, ensure_frame_files, key_for, blink_levels
from .coordinates import parse_coordinates

app = FastAPI(title="Planet X / SPHEREx Observatory", version="1.0.0")
JOBS = {}
GUARD = threading.RLock()
CLIENTS = {}
PRESET_LOCK = threading.Lock()
PRESETS = [
    dict(id="barnard", name="Barnard’s Star", simbad="Barnard's Star", kind="NEARBY STAR", description="A nearby red dwarf with exceptionally fast proper motion."),
    dict(id="epsilon", name="Epsilon Indi B", simbad="eps Indi B", kind="BROWN DWARF", description="A nearby brown-dwarf system, bright in the infrared."),
    dict(id="wise", name="WISE 0855", kind="COLD BROWN DWARF", description="An exceptionally cold nearby brown dwarf; a demanding motion target.", ra=133.79512916666667, dec=-7.245147222222222, coordinate_source="User-supplied coordinates; reference epoch unspecified."),
    dict(id="rw", name="RW Aurigae", simbad="RW Aur", kind="YOUNG STAR", description="A young variable star with a dusty, changing environment."),
    dict(id="rdraconis", name="R Draconis", simbad="R Dra", kind="VARIABLE STAR", description="A pulsating Mira variable; look for brightness changes."),
]


@app.get("/api/health")
def health():
    return {"status": "ok", "data_source": "IRSA SPHEREx", "synthetic_images": False}


from .partner_data import install_partner_routes
install_partner_routes(app)


FEATURED_SESSIONS = {
    'vesta': ('Vesta · asteroid motion', 'e73b15d70f48408b9b7932aee4bb2c59'),
    'barnard': ('Barnard’s Star', 'd1fa8853f3c340c8822a3a48e80ba444'),
    'epsilon-indi': ('Epsilon Indi B', '4d9dd1c752e84d27946cad613ad1c1f4'),
    'wise-0855': ('WISE 0855', '7a66c2411dd440758a1336a839d8bde7'),
    'rw-aur': ('RW Aurigae', 'daccb2b332db4c15867d0027796672a3'),
    'r-dra': ('R Draconis', '4ac83d693bac4c97968f8326d99f485c'),
}


@app.get('/api/examples/{key}')
@app.post('/api/examples/{key}')
def open_example(key: str):
    identity = 'example-'+key
    if key in FEATURED_SESSIONS:
        title, sid = FEATURED_SESSIONS[key]
        manifest_file = CACHE / 'observation-lab' / sid / 'manifest.json'
        if manifest_file.is_file():
            session_data = json.loads(manifest_file.read_text())
            frames = []
            for idx, f in enumerate(session_data.get('frames', [])):
                wave = f.get('wavelength') or f.get('wavelength_um')
                frame_entry = dict(
                    f,
                    id=f.get('id', f'frame-{idx}'),
                    index=idx,
                    status='ready',
                    date=f.get('timestamp') or f.get('date') or '',
                    mjd=float(f.get('mjd') or 0.0),
                    detector=int(f.get('detector') or session_data['options'].get('detector', 3)),
                    band=f.get('band') or f"SPHEREx-D{f.get('detector', 3)}",
                    release=f.get('release', 'QR2'),
                    wavelength_um=wave,
                    cache_id=f.get('id', f'frame-{idx}'),
                    preview=f.get('preview') or f"/cache/{sid}/{idx}.png",
                    session_dir=sid
                )
                frames.append(frame_entry)
            det = session_data['options'].get('detector', 3)
            contrast = session_data.get('stretch', {}).get('contrast') or {'black': 0.0, 'white': 1.0}
            with GUARD:
                JOBS[identity] = {
                    'id': identity,
                    'example': key,
                    'source': 'example',
                    'title': title,
                    'status': 'complete',
                    'stage': 'complete',
                    'created': time.monotonic(),
                    'ra': session_data['options']['ra'],
                    'dec': session_data['options']['dec'],
                    'fov': session_data['options']['fov'],
                    'frames': frames,
                    'session_dir': sid,
                    'contrast': contrast,
                    'contrasts': {f'D{det}': contrast},
                    'discovery_complete': True,
                    'discovery_note': f"Complete multi-frame observation sequence: {len(frames)} frames loaded."
                }
            return dict(id=identity, job=job_status(identity))

    from .example_field import featured, prepare_starter, prepared_starter
    item = featured().get(key)
    if item is None:
        raise HTTPException(404,'Unknown featured target.')
    with GUARD:
        current = JOBS.get(identity)
        if not current or current['status']=='error':
            snapshot = prepared_starter(key)
            if snapshot:
                JOBS[identity] = dict(snapshot,created=time.monotonic())
            else:
                current = dict(id=identity,example=key,source='example',title=item['title'],
                               status='querying',stage='loading',created=time.monotonic(),
                               ra=item['ra'],dec=item['dec'],fov=item['fov'],frames=[],contrast=None)
                JOBS[identity] = current

                def prepare():
                    try:
                        job = prepare_starter(key)
                    except (OSError, ValueError) as exc:
                        with GUARD:
                            current.update(status='error',message='The featured cutouts could not be loaded from IRSA.',detail=str(exc))
                        return
                    with GUARD:
                        current.update(job)
                threading.Thread(target=prepare,daemon=True,name='featured-'+key).start()
    return dict(id=identity,job=job_status(identity))


@app.get("/api/archive/prefetch-status")
def archive_prefetch_status():
    from .saved_archive import prefetch_status
    import sqlite3
    try:
        return prefetch_status()
    except sqlite3.Error:
        raise HTTPException(503, "The archive inventory is temporarily busy.") from None


@app.get("/api/presets")
def presets():
    cache = CACHE / "presets.json"
    with PRESET_LOCK:
        if cache.exists() and time.time() - cache.stat().st_mtime < 30 * 86400:
            return json.loads(cache.read_text())
        items = [dict(p) for p in PRESETS]
        try:
            names = [p["simbad"] for p in items if "simbad" in p]
            from .simbad_client import query_names
            table, server = query_names(names)
            if table is None:
                raise ValueError("SIMBAD returned no coordinates.")
            # Modern astroquery returns decimal degree ra/dec columns.
            for item in items:
                if "simbad" not in item:
                    continue
                matches = table[np.char.strip(np.asarray(table["user_specified_id"]).astype(str)) == item["simbad"]] if "user_specified_id" in table.colnames else []
                if len(matches) != 1:
                    raise ValueError("SIMBAD did not uniquely resolve " + item["simbad"])
                row = matches[0]
                if np.ma.is_masked(row["ra"]) or np.ma.is_masked(row["dec"]) or not np.isfinite(float(row["ra"])) or not np.isfinite(float(row["dec"])):
                    item["error"] = "SIMBAD has no valid coordinates for this target."
                    continue
                item.update(ra=float(row["ra"]), dec=float(row["dec"]), coordinate_source="SIMBAD via astroquery ("+server+"); ICRS J2000 catalog position, not propagated.")
            atomic_json(cache, items)
        except Exception as exc:
            for item in items:
                if "ra" not in item:
                    item["error"] = "SIMBAD is unavailable. Enter verified coordinates manually or retry."
            # Failures aren't cached. Never replace catalog positions with invented coordinates.
        return items


class Search(BaseModel):
    ra: str = Field(max_length=80)
    dec: str = Field(max_length=80)
    fov: float = Field(default=8, ge=2, le=20, description="Square field width in arcminutes")
    exposure_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{24}$")
    frame: int | None = Field(default=None, ge=0)


def prioritize_exposure(job, exposure_id, frame):
    if exposure_id is None and frame is None:
        return
    selectors = job.setdefault("priority_exposures", [])
    selector = (exposure_id, frame)
    if selector in selectors:
        selectors.remove(selector)
    selectors.append(selector)
    del selectors[:-8]


def run_job(job, resume=False):
    with GUARD:
        if job.get('worker_active'):return
        job['worker_active']=True
    try:
        progress(job, "discovering" if not resume else "loading")
        discovered = job["frames"] if resume else discover(job["ra"], job["dec"])
        rows = discovered if resume else sorted(discovered, key=lambda f: (float(f["mjd"]), f["id"]))
        with GUARD:
            if not resume:
                job["discovery_source"] = getattr(discovered, "source", "IRSA TAP")
                job["discovery_complete"] = getattr(discovered, "complete", True)
                job["discovery_note"] = getattr(discovered, "detail", None)
                job["frames"] = [dict(r, status="pending", index=i) for i, r in enumerate(rows)]
            job["status"] = ("paused" if job.get("prefetch_paused") else "fetching") if rows else "empty"
            progress(job, "loading" if rows else "empty")
        if not rows:
            job["message"] = "No released spectral images cover this position. Try a nearby field or another preset."
            return
        # Hydrate genuine cached products before any network call. The manifest stays chronological.
        for frame in job['frames']:
            key=key_for(f"{frame['url']}|{float(job['ra'])}|{float(job['dec'])}|{float(job['fov'])}|native-analysis-v2")
            if all((CACHE/(key+ext)).exists() for ext in ('.json','.npy','.npz')):
                try:
                    meta=json.loads((CACHE/(key+'.json')).read_text())
                    with GUARD:frame.update(meta,cache_id=key,status='ready',ra=job['ra'],dec=job['dec'],fov=job['fov'])
                except (ValueError,OSError):pass
        job.setdefault('contrasts',{})
        for f in job['frames']:
            band='D'+str(f.get('detector'))
            if f['status']=='ready' and band not in job['contrasts']:
                a=np.load(CACHE/(f['cache_id']+'.npy'),allow_pickle=False);lo,hi=blink_levels(a)
                job['contrasts'][band]=dict(black=float(lo),white=float(max(hi,lo+1e-8)),reference_frame=f['index'],unit=f['unit'])
        if job['contrast'] is None:
            cached=next((f for f in job['frames'] if f['status']=='ready'),None)
            if cached:
                a=np.load(CACHE/(cached['cache_id']+'.npy'),allow_pickle=False);lo,hi=blink_levels(a)
                with GUARD:job['contrast']=dict(black=float(lo),white=float(max(hi,lo+1e-8)),reference_frame=cached['index'],unit=cached['unit'])
        def load(frame):
            with GUARD:
                if job.get("prefetch_paused"):
                    if frame.get("status") == "queued":
                        frame["status"] = "pending"
                    return
                if frame.get("status") == "ready":
                    return
                frame.update(status="downloading", stage="downloading")
            try:
                identity, metadata = fetch_frame(frame, job["ra"], job["dec"], job["fov"])
                with GUARD:
                    band='D'+str(frame.get('detector'))
                    if band not in job['contrasts']:
                        a=np.load(CACHE/(identity+'.npy'),allow_pickle=False);low,high=blink_levels(a)
                        job['contrasts'][band]=dict(black=float(low),white=float(max(high,low+1e-8)),reference_frame=frame['index'],unit=metadata['unit'])
                    # A physical surface-brightness range is locked for each detector.
                    # It never auto-rescales between frames while prefetching.
                    if job["contrast"] is None:
                        arr = np.load(CACHE / (identity + ".npy"), allow_pickle=False)
                        lo, hi = blink_levels(arr)
                        if hi <= lo:
                            hi = lo + 1
                        job["contrast"] = {"black": float(lo), "white": float(hi), "reference_frame": frame["index"], "unit": metadata["unit"]}
                    frame.update(metadata, cache_id=identity, status="ready", stage="prepared", ra=job["ra"], dec=job["dec"], fov=job["fov"])
                    progress(job, "paused" if job.get("prefetch_paused") else "loading")
            except Exception as exc:
                with GUARD:
                    frame.update(status="error", stage="failed", error=str(exc), detail=type(exc).__name__)
                    progress(job, "loading")
        by_id = {frame["id"]: frame for frame in job["frames"]}

        def take_prioritized():
            with GUARD:
                selectors = job.pop("priority_exposures", [])
            selected = []
            for exposure_id, index in reversed(selectors):
                frame = (by_id.get(exposure_id) if exposure_id is not None else
                         job["frames"][index] if index < len(job["frames"]) else None)
                if frame is not None and frame["status"] == "pending":
                    selected.append(frame)
            return selected

        # Keep the first-frame contrast deterministic and load a shared frame next.
        load(job["frames"][0])
        with ThreadPoolExecutor(max_workers=CONFIG["concurrent_downloads"]) as executor:
            # Seed a sparse span of real epochs in each detector before filling the rest.
            # The manifest remains chronological; download order is not an observation time.
            priority=[];seen={job['frames'][0]['id']}
            same=[f for f in job['frames'][1:] if f.get('detector')==job['frames'][0].get('detector') and abs(f['mjd']-job['frames'][0]['mjd'])>=1]
            for fraction in (1,.75,.5,.25):
                if same:
                    f=same[round((len(same)-1)*fraction)]
                    if f['id'] not in seen:priority.append(f);seen.add(f['id'])
            for fraction in (0,1,1/3,2/3):
                for detector in range(1,7):
                    group=[f for f in job['frames'] if f.get('detector')==detector]
                    if not group:continue
                    f=group[round((len(group)-1)*fraction)]
                    if f['id'] not in seen:priority.append(f);seen.add(f['id'])
            priority.extend(f for f in job['frames'][1:] if f['id'] not in seen)
            queue = deque(priority)
            active = set()
            submitted = {job["frames"][0]["id"]}
            while queue or active:
                if not job.get("prefetch_paused"):
                    queue.extendleft(reversed(take_prioritized()))
                    while queue and len(active) < CONFIG["concurrent_downloads"]:
                        frame = queue.popleft()
                        with GUARD:
                            if frame["id"] in submitted or frame["status"] not in ("pending", "error"):
                                continue
                            submitted.add(frame["id"])
                            frame["status"] = "queued"
                        active.add(executor.submit(load, frame))
                if not active:
                    break
                done, active = wait(active, return_when=FIRST_COMPLETED)
                for future in done:
                    future.result()
        with GUARD:
            ready = sum(f["status"] == "ready" for f in job["frames"])
            job["status"] = "paused" if job.get("prefetch_paused") else ("complete" if ready else "error")
            progress(job, "failed" if job["status"]=="error" else job["status"])
            job["message"] = f"{ready} of {len(rows)} cutouts available. " + ("Background loading paused; resume to continue." if job.get("prefetch_paused") else "Missing or flagged pixels remain blank.")
    except Exception as exc:
        with GUARD:
            job.update(status="error", message="IRSA could not be reached or returned an invalid response. Retry shortly. No substitute images are displayed.", detail=type(exc).__name__+": "+str(exc))
            progress(job, "failed")

    finally:
        with GUARD:
            job['worker_active']=False
            if not job.get('prefetch_paused') and job['status'] not in ('error','empty','querying') and any(f.get('status')=='pending' for f in job['frames']):
                job['status']='fetching'
                threading.Thread(target=run_job,args=(job,True),daemon=True).start()


@app.post("/api/search", status_code=202)
def search(body: Search, request: Request):
    try:
        coord = parse_coordinates(body.ra, body.dec)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    now = time.monotonic()
    client = request.client.host if request.client else "unknown"
    with GUARD:
        ra, dec = float(coord.ra.deg), float(coord.dec.deg)
        for job in JOBS.values():
            if abs(job["ra"]-ra)<1e-9 and abs(job["dec"]-dec)<1e-9 and job["fov"]==body.fov and now - job["created"] < CONFIG["query_ttl_seconds"] and job["status"] != "error":
                prioritize_exposure(job, body.exposure_id, body.frame)
                if job["status"]=="paused":
                    if sum(j["status"] in ("querying","fetching") for j in JOBS.values())>=CONFIG["max_active_jobs"]:
                        raise HTTPException(429,"The observatory is busy. Please retry shortly.")
                    job["prefetch_paused"]=False;job["status"]="fetching"
                    threading.Thread(target=run_job,args=(job,bool(job["frames"])),daemon=True).start()
                return {"id": job["id"]}
        hits=[t for t in CLIENTS.get(client,[]) if now-t<60]
        if len(hits)>=10:raise HTTPException(429,'Please wait a minute before requesting another new field.')
        CLIENTS[client]=hits+[now]
        active = sum(j["status"] in ("querying", "fetching") for j in JOBS.values())
        if active >= CONFIG["max_active_jobs"]:
            raise HTTPException(429, "The observatory is processing other fields. Please retry shortly.")
        if active == 0:
            # Evict completed manifests before their cache files can be pruned.
            for old_id in list(JOBS):
                if now - JOBS[old_id]["created"] > CONFIG["query_ttl_seconds"]:
                    del JOBS[old_id]
            if not JOBS:
                prune_cache()
        job = dict(id=uuid.uuid4().hex, ra=ra, dec=dec, fov=body.fov, created=now,
                   status="querying", frames=[], contrast=None, message="Searching released SPHEREx spectral images…")
        prioritize_exposure(job, body.exposure_id, body.frame)
        JOBS[job["id"]] = job
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return {"id": job["id"]}


def get_job(identity):
    if identity not in JOBS:
        raise HTTPException(404, "This session expired. Search this field again.")
    return JOBS[identity]


@app.post('/api/jobs/{identity}/pause')
def pause_job(identity:str):
    with GUARD:
        job=get_job(identity)
        if job.get('source') not in ('cloud','example') and job['status'] in ('querying','fetching'):
            job['prefetch_paused']=True
            job['status']='paused'
            progress(job,'paused')
        return {'id':identity,'paused':bool(job.get('prefetch_paused'))}


@app.post('/api/jobs/{identity}/resume')
def resume_job(identity:str):
    with GUARD:
        job=get_job(identity)
        if job['status']=='paused':
            if sum(j['status'] in ('querying','fetching') for j in JOBS.values())>=CONFIG['max_active_jobs']:
                raise HTTPException(429,'The observatory is busy. Please retry shortly.')
            job['prefetch_paused']=False;job['status']='fetching'
            threading.Thread(target=run_job,args=(job,bool(job['frames'])),daemon=True).start()
        return {'id':identity}


@app.get("/api/jobs")
def active_jobs():
    with GUARD:
        return [dict(id=j["id"], ra=j["ra"], dec=j["dec"], status=j["status"], stage=j.get("stage"), last_progress_at=j.get("last_progress_at"), discovered=len(j["frames"]), loaded=sum(f.get("status")=="ready" for f in j["frames"])) for j in JOBS.values()]


@app.get("/api/jobs/{identity}")
def job_status(identity: str):
    with GUARD:
        job = get_job(identity)
        publish=job['contrast'] is not None
        visible=[dict(f, status='pending') if f['status']=='ready' and not publish else dict(f) for f in job['frames']]
        public_job = {key: value for key, value in job.items() if key != "priority_exposures"}
        return dict(public_job, frames=visible, discovered=len(visible), loaded=sum(f['status']=='ready' for f in visible), prepared=sum(f['status']=='ready' for f in visible), pending=sum(f['status'] not in ('ready','error') for f in visible), reviewed_by_laya=None, scientifically_comparable=None, ready=sum(f['status']=='ready' for f in visible),
                    failed=sum(f["status"] == "error" for f in job["frames"]),
                    notes=["Observed SPHEREx IMAGE data; false-color display, not visible-light photography.",
                           "Frames vary in wavelength and date. Brightness differences and artifacts can mimic motion.",
                           "North-up WCS registration is computed. Masked pixels are transparent; no data are synthesized.",
                           "Positions are not corrected for target proper motion. A preset name does not establish a source identification.",
                           "Physical contrast range locked to the first usable frame in each detector; zodiacal background is not subtracted."])


@app.get("/api/jobs/{identity}/frames/{index}.png")
def frame_png(identity: str, index: int, cmap: str = "infrared", stretch: str = "asinh", black: float | None = None, white: float | None = None, thumbnail: bool = False, enhanced: bool = False, changes: bool = False, reference_index: int | None = None):
    with GUARD:
        job = get_job(identity)
        if index < 0 or index >= len(job["frames"]):
            raise HTTPException(404, "Unknown frame")
        frame = job["frames"][index]
        if frame["status"] != "ready":
            raise HTTPException(425, "Frame is not ready yet.")
        session_dir = frame.get('session_dir') or job.get('session_dir')
        if session_dir:
            preview_file = CACHE / 'observation-lab' / session_dir / f'{index}.png'
            if preview_file.is_file():
                return FileResponse(str(preview_file), media_type='image/png')
        if frame.get('preview'):
            clean_path = frame['preview'].lstrip('/')
            if clean_path.startswith('cache/'):
                clean_path = clean_path[6:]
            preview_file = CACHE / clean_path
            if not preview_file.is_file():
                preview_file = CACHE / 'observation-lab' / clean_path
            if preview_file.is_file():
                return FileResponse(str(preview_file), media_type='image/png')
    try:
        if not (CACHE / (frame["cache_id"] + ".npy")).exists():
            ensure_frame_files(frame,job)
    except Exception:
        raise HTTPException(503,"This cached observation expired and IRSA could not refresh it. Please retry.")
    contrast = job.get('contrasts',{}).get('D'+str(frame.get('detector')),job['contrast'])
    file = CACHE / (frame["cache_id"] + ".npy")
    if contrast is None:
        try:
            values=np.load(file,allow_pickle=False)
            if not np.isfinite(values).any():raise HTTPException(422,'No usable observed pixels.')
            low,high=blink_levels(values)
        except FileNotFoundError:raise HTTPException(410,'Cached frame expired; reload this field.')
        with GUARD:
            band='D'+str(frame.get('detector'))
            contrast=job.setdefault('contrasts',{}).setdefault(band,dict(black=float(low),white=float(max(high,low+1e-8)),reference_frame=index,unit=frame.get('unit','MJy/sr')))
            if job['contrast'] is None:job['contrast']=contrast
    lo = contrast["black"] if black is None else black
    hi = contrast["white"] if white is None else white
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        raise HTTPException(422, "White point must exceed black point.")
    if cmap not in ("inferno", "magma", "viridis", "gray", "infrared") or stretch not in ("linear", "sqrt", "log", "asinh"):
        raise HTTPException(422, "Unknown colormap or stretch")
    try:
        arr = np.load(file, allow_pickle=False)
    except FileNotFoundError:
        raise HTTPException(410, "Cached frame expired. Search again.")
    if enhanced:
        from .quicklook import enhanced_rgba,comparable
        reference=None
        if changes:
            candidates=[f for f in job['frames'] if f.get('status')=='ready' and comparable(frame,f) and f['mjd']<frame['mjd'] and (reference_index is None or f['index']==reference_index)]
            if not candidates:raise HTTPException(422,'No comparable wavelength/detector on another date is loaded. Load more frames or turn off red changes.')
            reference=max(candidates,key=lambda f:(f['mjd'],f['index']))
        try:rgba=enhanced_rgba(frame,reference)
        except ValueError as e:raise HTTPException(422,str(e))
        image=Image.fromarray(np.flipud(rgba));stream=io.BytesIO();image.save(stream,format='PNG')
        return Response(stream.getvalue(),media_type='image/png',headers={'Cache-Control':'private, max-age=300'})
    valid = np.isfinite(arr)
    norm = np.clip((np.nan_to_num(arr, nan=lo) - lo) / (hi - lo), 0, 1)
    if stretch == "sqrt": norm = np.sqrt(norm)
    elif stretch == "log": norm = np.log1p(100 * norm) / np.log(101)
    elif stretch == "asinh": norm = np.arcsinh(5 * norm) / np.arcsinh(5)
    if cmap == "infrared":
        from matplotlib.colors import LinearSegmentedColormap
        color = LinearSegmentedColormap.from_list("infrared", ["#050914", "#3e124f", "#a32b72", "#e77352", "#ffd18a", "#fff4d8"])
    else:
        color = colormaps[cmap]
    rgba = (color(norm) * 255).astype(np.uint8)
    rgba[..., 3] = valid.astype(np.uint8) * 255
    image = Image.fromarray(np.flipud(rgba))
    if thumbnail: image.thumbnail((96, 96), Image.Resampling.NEAREST)
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return Response(stream.getvalue(), media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


from .routes_analysis import install_analysis_routes
install_analysis_routes(app, JOBS, GUARD, CLIENTS)

from .routes_context import install_context_routes
install_context_routes(app, JOBS, GUARD, frame_png)

from .routes_space import install_space_routes
install_space_routes(app)

from .palette import install_palette_routes
install_palette_routes(app)

from .solar import install_solar_routes
install_solar_routes(app)

from .exploration import install_exploration_routes
install_exploration_routes(app)

from .laya_review import install_laya_routes
install_laya_routes(app,JOBS,GUARD)

from .systems import install_system_routes
install_system_routes(app)


from .laya_sequence import install_sequence_routes
install_sequence_routes(app,JOBS,GUARD)

from .time_science import install_time_routes
install_time_routes(app,JOBS,GUARD)

from .companions import install_companion_routes
install_companion_routes(app)

@app.get('/api/jobs/{identity}/observing-view/{index}')
def observing_view(identity: str, index: int):
    from .observing_view import exposure_geometry
    with GUARD:
        job = get_job(identity)
        if not 0 <= index < len(job['frames']) or job['frames'][index]['status'] != 'ready':
            raise HTTPException(422, 'Choose a loaded exposure.')
        frame = dict(job['frames'][index])
    return exposure_geometry(job, frame)


from .routes_satellite_view import install_satellite_view_routes
install_satellite_view_routes(app, JOBS, GUARD)

from .guide import install_guide_routes
install_guide_routes(app, JOBS)

DIST = ROOT / "web"
if DIST.exists():
    class FreshStaticFiles(StaticFiles):
        async def get_response(self, path, scope):
            response = await super().get_response(path, scope)
            if Path(path).suffix in (".js", ".css", ".html") or path in ("", "."):
                response.headers["Cache-Control"] = "no-cache"
            return response
    from .observation_lab import install_lab_routes
    install_lab_routes(app)

    @app.get('/cache/{path:path}', include_in_schema=False)
    def serve_cache_fallback(path: str):
        from fastapi.responses import FileResponse
        p = CACHE / 'observation-lab' / path
        if p.is_file():
            return FileResponse(p)
        p2 = CACHE / path
        if p2.is_file():
            return FileResponse(p2)
        raise HTTPException(404)

    app.mount("/", FreshStaticFiles(directory=DIST, html=True), name="frontend")
