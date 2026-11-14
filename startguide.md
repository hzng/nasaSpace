# Start guide: run SPHEREx Observation Lab locally

The app is a small Python server with a plain HTML/JS front end. There is no build step and no Node.js. You need Python 3.12–3.14 and six packages. One script then builds the observation index from public NASA data. No accounts or keys are needed.

## 1. Get the code

```
git clone <repo-url>
cd nasaSpace
```

If you already have the repo, run `git pull` on `main`.

The repo already contains everything the six example fields need:

- **Example fields:** 22 FITS frames and previews in `outputs/spherex-viewer/data/` (about 191 MB).
- **3D Map catalogs:** `outputs/spherex-prototype/catalogs/`.
- **Saved JPL Horizons replies** for Vesta and Ceres (`outputs/spherex-prototype/fixtures/horizons/`), so those two work offline.

## 2. Create the Python environment

Use **Python 3.12, 3.13 or 3.14**. Python 3.15 does not work yet: PyYAML, which astropy needs, has no build for it.

From the repo root, with [uv](https://docs.astral.sh/uv/):

```
uv venv --python 3.14 work/venv
uv pip install --python work/venv -r outputs/spherex-prototype/requirements.txt
```

Without uv (Windows):

```
py -3.14 -m venv work\venv
work\venv\Scripts\pip install -r outputs\spherex-prototype\requirements.txt
```

Without uv (Mac/Linux):

```
python3.14 -m venv work/venv
work/venv/bin/pip install -r outputs/spherex-prototype/requirements.txt
```

Create the environment at exactly `work/venv` in the repo root. Both launchers look for that path, and fall back to whatever `python` is on PATH if it is missing. `work/` is gitignored.

## 3. Build the observation index (no account needed)

Without an index, each of the six targets only has its few bundled frames (Vesta has 2). The index lists all 4,256 archived observations of the six fields. It is one file, `work/prototype-cache/featured-library.json` (about 3.5 MB). Images are not part of it: the server downloads them from NASA IRSA when you open a view.

Build it once from public NASA IRSA archive queries. You need no account and no keys, and no images are downloaded:

```
cd outputs/spherex-prototype
..\..\work\venv\Scripts\python -X utf8 sync_featured.py      (Windows)
../../work/venv/bin/python -X utf8 sync_featured.py          (Mac/Linux)
```

- **When it works:** it prints "Index upload skipped: Supabase is not configured". That is expected. The index is saved locally, and the server picks it up without a restart.
- **If a field's query fails:** that field keeps its previous records. Run the script again later to fill it in.
- **To refresh the index later**, run the same command again.

**Alternative:** ask Nael for a copy of `featured-library.json` and put it in `work/prototype-cache/` (create the folder if needed).

### Supabase is optional (maintainer only)

Supabase stores exactly one file: a shared copy of this index. If `outputs/spherex-prototype/.env` holds `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`, the server downloads the index at start, and `sync_featured.py` uploads a fresh one after a complete run. Nothing else uses Supabase: images, tracking, JPL Horizons, spectra and the 3D Map do not.

Do not share `SUPABASE_SERVICE_KEY`. It is a service-role key with full admin access to the Supabase project, not just this file. Teammates should use the script above instead.

## 4. Run it

**Windows:** double-click `outputs/spherex-prototype/Launch SPHEREx.cmd`, or run `outputs/spherex-prototype/start.ps1`.

**Mac/Linux:**

```
cd outputs/spherex-prototype
../../work/venv/bin/python -X utf8 server.py
```

When the window says the server is ready, open **http://127.0.0.1:8765/**. Keep that window open while you use the app, and press `Ctrl+C` to stop it.

If port 8765 is already in use, start it on another port and open that one instead:

```
python -X utf8 server.py --port 8766
```

## 5. What to expect the first time

- **The first page load takes about 10 seconds** while frames load. The image area is black until then.
- **The first track of an object can be slow.** Frame images come from NASA IRSA on demand, and the server downloads every frame a track needs before it reports any progress. On a cold cache, a first Vesta track can sit on "Preparing star tracking" for many minutes. Later tracks of the same view use the cache and take seconds.
- **For a quick offline demo**, choose Vesta and press **Load archived Vesta example · Aug 4–5**. It uses the bundled files and the saved Horizons data.
- **The first spectrum measurement is slow too.** The first **Measure** downloads about 330 MB of calibration files. Don't demo **Measure spectrum** on Vesta: the asteroid moves out of the fixed measurement position, so the result is one point of empty sky. Use a star field.
- **"All dates · slow"** in the Spectrum window can mean thousands of files and several minutes per measurement.

### Cache size

Downloads are cached in `work/prototype-cache/`. Without settings the cache is capped at **2 GB**. Downloaded frames past that cap are deleted and fetched again later, which makes tracks slow again. If you have the disk space, raise the cap before starting the server:

```
set SPHEREX_CACHE_GB=50          (Windows cmd)
$env:SPHEREX_CACHE_GB = "50"     (PowerShell)
export SPHEREX_CACHE_GB=50       (Mac/Linux)
```

## Troubleshooting

- **`No module named 'astropy'`:** the packages were installed into a different Python. Re-run step 2 and start the app with `work/venv`'s Python (the launchers do this for you).
- **The install fails on PyYAML or astropy:** you are on Python 3.15. Use 3.14.
- **Each target shows only a handful of observations** (for example Vesta with 2 frames instead of hundreds): the index is missing. Run `sync_featured.py` (step 3) and check that `work/prototype-cache/featured-library.json` exists. The app still works on the bundled examples without it.
- **The page loads an old look after an update:** hard-refresh the browser (`Ctrl+Shift+R`).
- **Two servers on one port:** on Windows, Python's server lets two processes bind the same port. Stop old server windows before starting a new one.

More detail on every feature, the science limits and the data sources is in `outputs/spherex-prototype/README.md`.

## For whoever merges to `main`

- Commit all the work on `fable` before merging. Uncommitted changes in a worktree are not part of the merge.
- `outputs/spherex-prototype/README.md` still says the palette uses white as the primary accent. It now uses Apple-style action blue (`#0071e3`) and a D1–D6 band colour scale, so update that line.
- `.impeccable/`, `outputs/handoff-ui-voice.md` and `outputs/fableRedesign.md` are gitignored and will not be merged.
