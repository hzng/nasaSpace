# SPHEREx Observation Lab

A local, public-facing astronomy workspace for inspecting real archived NASA SPHEREx observations, measuring point-source light across wavelength and time, screening candidate absorption features with explicit quality and uncertainty, and exploring physically grounded 3D galaxy and nearby-star catalogs.

## Open the app

Double-click `Launch SPHEREx.cmd` in this folder (or run `start.ps1`). Wait for the ready message, then open [http://127.0.0.1:8765/](http://127.0.0.1:8765/). Keep the server window open while using the app and press `Ctrl+C` to stop it.

You can also start the server directly from the `outputs/spherex-prototype` folder:

```powershell
python -X utf8 server.py
```

The default port is `8765`. If that port is already occupied, run `python -X utf8 server.py --port 8766` and open `http://127.0.0.1:8766/`.

Use Python 3.12 to 3.14. Python 3.15 is not supported yet: the packages have no complete set of binary wheels for it (PyYAML is missing). On this machine a Python 3.14 environment was created with `uv venv --python 3.14 ..\..\work\venv`, and the packages are in `..\..\work\deps`. The launchers use `..\..\work\venv` when it exists, otherwise `python`. On a fresh machine, install dependencies from `requirements.txt` (including `photutils>=3`). Keep the sibling `../spherex-viewer/data/` directory alongside `spherex-prototype/` under `outputs/`, as it supplies the six bundled example fields and FITS cutouts.

The six bundled example fields work with no network. To load the full list of other observations, copy `.env.example` to `.env` in this folder and fill in `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (the Supabase secret or service-role key). `.env` is ignored by git. The key is used only by the local Python server and scripts and is never sent to the browser. Real environment variables take precedence over `.env`. At start, the server downloads the observation index from Supabase when credentials are set. If Supabase is unreachable or not configured, it uses the local copy. With neither, the app runs on the six bundled examples only.

## Interface layout

- **Styles**: the former single `app.css` is split into twelve files in `css/`, loaded in this order by `index.html`: tokens, controls, appbar, menu, stage, inspector, spectrum, atlas, tracker, dialogs, responsive, overrides.
- `css/tokens.css` holds every colour, spacing, radius, control height and timing. Other style files must use these tokens.
- The design rules are in `../ui-design-spec.md`. The problems they answer are in `../ui-audit.md`.
- **Palette**: neutral graphite with white as the primary accent. Amber is used only for data-quality warnings. Canvas mark colours are unchanged.
- **Dropdowns**: `ui-select.js` (no dependencies) replaces every native dropdown on screen with a custom menu. The native `<select>` stays in the page as the source of truth, so existing code is unchanged.
- Lists longer than 10 items get a search box. Keyboard: arrows, Home/End, Enter, Space, Esc, Tab and type-ahead. The target menu also moves with arrow keys.
- There is still no build step. The run steps above are unchanged.

## Workspace guide

### 1. Sky observations, flags & motion tracking

1. Choose one of the six saved fields (**Vesta**, **Barnard’s Star**, **Epsilon Indi B**, **WISE 0855**, **RW Aurigae**, **R Draconis**) or enter custom **RA** / **Dec** (decimal degrees or `hh:mm:ss` / `±dd:mm:ss`).
2. Use the **Width** (`5`, `10`, `15`, `30`, `60` arcminutes) and **Band** (`D1`–`D6`, `0.75–5.00 µm`) selectors or `‹`/`›` steppers. Changes apply automatically, coalesce rapid clicks to the latest request, and reuse cached aligned views.
3. **Play as a video**: Click **Play** (or press `Space`) to blink across exposures over time. Adjust speed (`0.7`, `1.2`, `3.0 fps`) or step manually (`‹` / `›`). Switch to **Compare** to inspect two dates side-by-side.
4. **Flags & detector artifact mask**:
   - Check **Flags** (or click the `% flagged` card) to display the red mask over dead, persistent, transient, or saturated pixels.
   - Hover over any red masked spot on the sky image to see the exact SPHEREx flag name (`Transient event`, `Dead pixel`, `Outlier`, etc.) in a floating badge.
   - Click any pixel to open the **Pixel** tab for brightness (`MJy/sr`), uncertainty, wavelength, native pixel coordinates, and flag details (including `Near (±1 px)` hints when close to a defect).
5. **Motion Tracker (stars, asteroids, and change of movement)**:
   - **Track point**: Click any star or asteroid in the image, then press **Track point**. The tracker measures 2D Gaussian centroids across all frames, falling back to clean PSF wing fitting when bright cores are flagged or saturated.
   - **Naming a clicked source**: a click centroids the source on that frame, then asks [IMCCE SkyBoT](https://ssp.imcce.fr/webservices/skybot/) (asteroids and comets at the frame's mid-exposure time, geocentric) and SIMBAD (stars, J2000 positions moved by proper motion to that time) in parallel. The nearest object within one SPHEREx pixel (6.15″; 12.3″ when the click cannot be centroided) names the source and fills the **Object** box. An asteroid or comet name is then tracked with JPL Horizons; a star name is shown for reference and the star is tracked from the image and Gaia. A match is positional, not proof. Answers are cached in `../../work/prototype-cache/identify/`.
   - **Frames without the object**: when a tracked object with a prediction is outside a frame's image, that frame shows no path, says the object is not in the frame, and lists the dates it is on the image.
   - **Solar System objects (JPL Horizons)**: Type a designation in **Object** (`Vesta`, `4`, `Ceres`, `433 Eros`) and press **Track point**; no click is needed. The predicted position at every exposure comes from JPL Horizons and is drawn as a dashed purple track. The measured centroid, the offset in arcseconds and a disagreement flag are shown next to it. For Vesta, click **Load archived Vesta example · Aug 4–5** first; the name is prefilled. See *Moving objects and JPL Horizons* below.
   - **Pick 2nd anchor**: Only for objects that have no designation. Click the object on Frame 1, press **Pick 2nd**, scrub to a later frame, click the object again, and press **Track point**. This is a straight-line guide from two clicks, not an ephemeris, and the result says so. It is never used when a designation is typed.
   - **Change of movement**: The tracker computes step-by-step velocity, heading (`PA°`), cumulative displacement, and quadratic acceleration/turning (`Steady motion`, `Speeding up`, `Slowing down`, or `Curving path`), displayed in big bold KPI cards and two interactive plots (`#track-plot` sky path and `#track-change-plot` speed/displacement over time).
   - **3D motion**: For stars with Gaia DR3 distance and radial velocity (such as Barnard’s Star), click **3D motion** to launch an interactive 3D trajectory view from year 1516 to 2516 relative to the Solar System.
   - Click **Export JSON** to export measured positions, fit modes, velocities, and kinematics.
6. **Coverage policy**: Aligned playback requires at least **99%** geometric detector footprint coverage inside the requested square and at least **80%** finite valid pixels. Partial exposures are excluded from playback and listed below the timeline with their original FITS links and reasons.

#### Moving objects and JPL Horizons

- **Source**: `ephemeris.py` queries the [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) with plain `requests`. It asks for astrometric ICRF RA/Dec (light-time corrected), the apparent rate, distance and light time. Positions are never interpolated, extrapolated or estimated from the image.
- **Observer**: the SPHEREx spacecraft itself, Horizons center `500@-163182` ("SPHEREx (spacecraft)", trajectory from concatenated two-line elements, 2025-Mar-12 to about 30 days ahead). Checked on 2026-11-12: Horizons' geocentric position of the spacecraft agrees with the `X_SC/Y_SC/Z_SC` values in two FITS headers to about 2 km. If Horizons has no SPHEREx trajectory for a date, the whole request falls back to the geocenter and the UI shows a warning; parallax from the orbit is then missing (about 1″ for main-belt asteroids, arcminutes for near-Earth objects).
- **Time**: each exposure is asked at its midpoint, FITS `MJD-AVG` (UTC, converted if `TIMESYS` says otherwise), sent to Horizons as JD UT. The frame timestamp shown elsewhere in the app is the exposure start.
- **Cache and offline use**: every response is stored in `../../work/prototype-cache/horizons/`, one JSON file per object and observer, keyed by epoch. `fixtures/horizons/` ships real Horizons output for the Vesta and Ceres examples, so they work with no network. A cached row is reused without asking Horizons again; the UI shows its retrieval date and the word "cached". Delete the cache file to refresh.
- **Failures are shown, not hidden**: unknown object, ambiguous name (the matching records are listed), no ephemeris for the date, or Horizons unreachable with exposure times missing from the cache. The tracker then stops with that message. It does not fall back to an approximation.
- **Agreement rule**: an offset is flagged when it exceeds `max(3 × centroid error, 3.1″)` (3.1″ is half a native pixel). This is a display rule, not a calibrated astrometric error model. Frames with no usable centroid are counted separately and are never reported as agreeing.
- **Examples and measured offsets** (2026-11-13, measured centroid minus Horizons position, all wing fits on saturated cores):

  | Object | View to load | Frames | Median | Max | Flagged |
  |---|---|---|---|---|---|
  | 4 Vesta | RA `223.015`, Dec `-11.99`, 30′, D3, 2025-08-04 to 2025-08-05 | 3 | 0.75″ | 3.33″ | 0 |
  | 4 Vesta | same view, D6 | 3 | 2.55″ | 3.28″ | 1 |
  | 1 Ceres | RA `13.82`, Dec `-5.763`, 30′, D1, 2025-06-24 | 7 | 2.70″ | 4.79″ | 1 |

  Measured against predicted speed: Vesta 48.92 against 48.92 ″/hr, Ceres 34.04 against 34.06 ″/hr. For one and the same Vesta exposure the offset differs by up to 2.8″ between D3 and D6 although the prediction is identical, so at least that much comes from the centroid side (wing fits on a saturated core), not from the ephemeris. The bundled Vesta example (15′, D3) holds 2 of these exposures and gives 0.90″ and 2.21″; the other frames and all Ceres frames live in the local cache (`../../work/prototype-cache/`) and are not in git.
- **Limits**: the centroid is searched within 3 pixels of the predicted position, so a background star that sits there can be measured instead of the object; agreement over several frames of a moving track is the evidence, not a single frame. A request that mixes dates with and without a SPHEREx trajectory is computed geocentrically as a whole. A periodic comet (`29P`, or `29P/Schwassmann-Wachmann 1`) is sent as `DES=29P;CAP;NOFRAG`, the return nearest today; for an older return, type its Horizons record number.

### 2. Measure the light (spectra, light curves & candidate screening)

1. Click a star in the aligned image (or keep the field center) and press **Measure light →**.
2. Choose the observation time scope (**Within 7 days of this frame**, **Selected date range**, or **All cached dates**) and an optional **Reference redshift** (`0` for foreground/Milky Way targets).
3. Measurements extract single-source forced ePSF photometry directly from the calibrated FITS `IMAGE`, `VARIANCE`, and `FLAGS` arrays using the official `spectral_wcs` (`CWAVE`/`CBAND`), `solid_angle_pixel_map`, and `epsf` calibration products.
4. Toggle between **Brightness / wavelength** (`µJy` vs. `µm`) and **Brightness / time** (light curve inside a narrow `µm` interval), filter by release (**QR3** / **QR2** kept separate), and toggle review-flagged points (plotted as crosses; accepted points as circles). Negative fluxes are retained rather than clipped to zero.
5. Click any plotted point to open its underlying observation frame in the sky viewer (switching detectors automatically when needed while keeping your graph visible).
6. Download measurements as **CSV**, full analysis + calibration provenance as **JSON**, or the plot as **SVG**.

### 3. Physical 3D map (`catalogs/galaxies.json` & `catalogs/stars.json`)

1. Switch to **Physical 3D map** in the top workspace bar.
2. Explore two real, quality-filtered catalog samples anchored at the Solar System barycenter in ICRS 3D coordinates:
   - **Galaxies · DESI DR1** (`10,000` records, units in **Mpc**): Planck18 comoving distances from spectroscopic redshifts (`0.01 < z < 1.0`, `zwarn = 0`, `deltachi2 > 40`), with lookback times and formal redshift-only distance error bars.
   - **Nearby stars · Gaia DR3** (`5,000` records within ~200 pc, units in **pc**): high-significance parallaxes (`parallax > 5 mas`, `parallax_over_error > 20`, `ruwe < 1.4`), inverse-parallax distances (`1000 / parallax`), and Gaia `BP−RP` display coloring.
3. Orbit (`Drag`), pan (`Shift-drag`), zoom (`Wheel`), move (`W/A/S/D`, `Q/E`), click any point to inspect its metadata and toggle its radial distance uncertainty interval, scrub **Projected year** (`1516`–`2516`) for stars, focus or reset the camera, and export selected object JSON.
4. **3D motion rule**: Stars are projected in 3D space using straight-line velocity **only where Gaia DR3 radial velocity is measured** (`1,559` of `5,000` stars). Stars without radial velocity stay fixed at their J2016.0 catalog 3D position with their sky-only proper motion noted explicitly.
5. Click **Inspect SPHEREx here →** to jump back to the sky viewer at the object’s coordinates (propagated to epoch `2026.8` for Gaia stars, and carrying measured redshift `z` for DESI galaxies so rest-frame feature markers shift appropriately). If no local cached exposures overlap that position, press **Search IRSA ↗** to query the public archive.

## Release status & archive refresh

- **Currently public SPHEREx spectral-image releases** (verified November 11, 2026 against IRSA and `nasa-irsa-spherex` S3): **QR3** (DOI `10.26131/IRSA662`, first released September 2026) and **QR2** (DOI `10.26131/IRSA652`, headers updated April 10, 2026). **QR1** was retired in February 2026.
- **DR1 file paths**: The archive returned DR1 file paths on 2026-11-12. On that date the IRSA archive query returned Level-2 files under `dr1` paths, and a DR1 cutout downloaded and passed the app's file checks. `archive-config.json` now lists `spherex_dr1` first.

### Storage: what is local and what is in Supabase

- **Bundled locally**: the six example fields (22 FITS frames, about 191 MB) in `../spherex-viewer/data/`. They work with no network.
- **Observation index in Supabase**: the list of all other observations is `featured-library.json`: 4,256 observations across the six fields (2,941 from release DR1 and 1,315 from QR3, observed 2025-04-24 to 2026-10-02). `sync_featured.py` builds it from six NASA IRSA archive footprint queries. The script downloads no image files. It stores the index in the private Supabase Storage bucket `spherex` and keeps a local copy in `../../work/prototype-cache/`.
- **Image pixels come from IRSA when needed**: opening a sky view downloads only the cutouts that view needs, sized to the view. Measuring light downloads 5-arcminute cutouts around the chosen point. The first open of a view needs the network and is slower; reopening it uses the cache. Measured example: a 10-arcminute Vesta view fetched 60 cutouts (about 4 MB each) in 72 to 155 seconds, and reopened in 2 seconds.
- **Cache cap**: after each job the server trims `../../work/prototype-cache/` to a size cap set by the environment variable `SPHEREX_CACHE_GB` (default `2`). Downloaded cutouts are deleted first (oldest first), then older rendered views. The most recently opened view, user-imported FITS files, the index, saved measurements and calibration files are never deleted. Calibration files (about 330 MB after one measurement) are outside the cap. An evicted cutout is downloaded again automatically when a pixel is inspected or a source is tracked.
- **Refresh the index**: run `Update featured data.cmd`, or execute `python -X utf8 sync_featured.py`. This only refreshes the index and uploads it. It does not download image files or pre-render views. `prepare_featured.py` still exists, but it would download and render every view, so it is not part of the normal workflow.

### Refreshing cached observations, calibrations, and catalogs

- **Refresh science calibrations (30 files: QR2/QR3 `spectral_wcs`, QR2/QR3 `solid_angle_pixel_map`, QR3 `epsf`)**:
  ```powershell
  python -X utf8 calibrations.py
  ```
  Saves files and SHA-256 / URL provenance under `../../work/prototype-cache/calibrations/`.
- **Rebuild 3D catalogs from NOIRLab Astro Data Lab TAP**:
  ```powershell
  python -X utf8 sync_catalogs.py
  ```
- **Live archive queries & user FITS imports**:
  **Search IRSA ↗** queries IRSA TAP (`spherex.artifact` / `spherex.plane`, falling back to SIA) for the entered coordinates, detector, and dates, using collections listed in `archive-config.json`. **Data & updates ↗** also supports importing user-supplied SPHEREx Level-2 FITS files (`IMAGE`, `FLAGS`, `VARIANCE`, `WCS-WAVE`). Restart the server after editing `archive-config.json`.

## Scientific scope & limits

- **Wavelength is not physical depth**: SPHEREx spectral images record brightness vs. wavelength across linear variable filter bands (`0.75–5.00 µm`), not radial distance. The 3D map uses independent physical distances from DESI redshifts (Planck18 cosmology) and Gaia parallaxes.
- **At most 120 frames per view**: near the ecliptic poles SPHEREx observes every orbit (R Draconis: about 520 frames per band). Such a view keeps 120 frames evenly spaced in time, first and last included, and the status bar says how many there were. Without the cap one view fills the 2 GB cache by itself. A fresh **Search IRSA** still downloads every match before the cap applies.
- **Exploratory single-source photometry**: `spectroscopy.py` fits one fixed-position ePSF at a time without joint multi-source deblending. Bright, saturated, crowded, or fast-moving sources (such as RW Aurigae, R Draconis, Barnard’s Star, or Vesta) can fail quality checks and are flagged or excluded from chemical screening rather than plotted as clean.
- **Time-separated wavelengths**: Different wavelengths at a fixed sky position are frequently observed on different dates. Intrinsic source variability or object motion across epochs can imitate spectral slopes or dips.
- **Candidate screening is not identification**: Absorption feature cards (`H2O`, `CH4`, `CH3OH`, `CO2`, `CO`) test a local linear continuum against reference wavelength windows using clean, same-detector, same-release points within 14 days, requiring `>= 5σ` depth including a conservative `5%` continuum error floor. This score is neither a statistical identification probability nor a composition percentage, and does not distinguish gas vs. ice or source vs. foreground absorption.
- **Catalog completeness**: `galaxies.json` and `stars.json` are quality-filtered samples (`10,000` galaxies, `5,000` stars within 200 pc), not volume-complete maps. Empty sky regions reflect survey footprints and selection cuts. DESI distance errors propagate formal redshift error only (no peculiar velocities or cosmological model uncertainty); Gaia distances apply no parallax zero-point correction.
- **Calibration releases**: "Measure light" has calibration support for QR2 and QR3 only. DR1 observations are listed as rejected with the reason "No validated science calibration adapter for this release".
- **Custom positions**: for a custom position that is not a saved field center, only observations whose archive footprint contains that position are fetched. Partly overlapping observations are not listed as excluded.
- **Vesta guide markers**: guide markers for non-bundled Vesta frames need the file `work/results.tbl`, which is not included.
- **Evicted cutouts**: the "FITS" download link of a cutout that was evicted from the cache returns 404 until the view is opened again.
- **Cutout fallback**: if the archive's cutout service fails for one file, the app falls back to downloading the full detector file (about 65 MB). The cache trim can remove that file later.

## Scientific & archive references

- NASA/IPAC SPHEREx Archive: [https://irsa.ipac.caltech.edu/Missions/spherex.html](https://irsa.ipac.caltech.edu/Missions/spherex.html)
- SPHEREx Quick Release Overview (QR2 / QR3): [https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html)
- SPHEREx Archive Documentation — Data Access: [https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/)
- SPHEREx Archive Documentation — Data Products: [https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/)
- SPHEREx Spectrophotometry Tool & Flags: [https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html)
- Official SPHEREx PSF Tutorial: [https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/](https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/)
- SPHEREx Planned Data Delivery Schedule: [https://spherex.caltech.edu/page/data-products](https://spherex.caltech.edu/page/data-products)
- DESI DR1 Public Access: [https://data.desi.lbl.gov/doc/releases/dr1/](https://data.desi.lbl.gov/doc/releases/dr1/)
- Gaia DR3 Documentation: [https://www.cosmos.esa.int/web/gaia/data-release-3](https://www.cosmos.esa.int/web/gaia/data-release-3)
- NASA Webb Chamaeleon I Dark Cloud Ice Spectra: [https://science.nasa.gov/asset/webb/chamaeleon-i-dark-cloud-nircam-nirspec-and-miri-spectra/](https://science.nasa.gov/asset/webb/chamaeleon-i-dark-cloud-nircam-nirspec-and-miri-spectra/)
