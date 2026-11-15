# SPHEREx Observation Lab

A browser workspace for real, archived NASA SPHEREx observations. You can:

- blink through infrared images of one patch of sky over time;
- track a star, asteroid or comet across those images and compare its motion with JPL Horizons;
- measure a source's brightness across wavelength and time;
- explore measured 3D positions of galaxies (DESI DR1) and nearby stars (Gaia DR3).

Every image, flag and number comes from public archive data (NASA/IPAC IRSA, JPL Horizons, Gaia, DESI). Nothing is simulated.

The app is a small Python server with a plain HTML/JS front end in `outputs/spherex-prototype/`. There is no build step.

## Quick start

1. Install Python 3.12, 3.13 or 3.14 (3.15 does not work yet).
2. From the repo root, create the environment:
   ```
   uv venv --python 3.14 work/venv
   uv pip install --python work/venv -r outputs/spherex-prototype/requirements.txt
   ```
3. Start the server:
   - **Windows:** double-click `outputs/spherex-prototype/Launch SPHEREx.cmd`.
   - **Mac/Linux:** `cd outputs/spherex-prototype && ../../work/venv/bin/python -X utf8 server.py`
4. Open http://127.0.0.1:8765/.

The six example fields work with no network and no account. To list all 4,256 archived observations of those fields, build the index once with `sync_featured.py`. [startguide.md](startguide.md) has the full setup, the index step and troubleshooting.

## Features and how to use them

The top bar switches between the two workspaces, **Sky** and **3D Map**. **Archive** opens archive search details and FITS import.

### 1. Sky: view a patch of sky over time

**Choose what to look at**

- **Target menu** (top left): pick one of six saved fields: Vesta, Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis.
- **RA / Dec:** or type any position, in decimal degrees or `hh:mm:ss` / `±dd:mm:ss`.
- **Width:** 5, 10, 15, 30 or 60 arcminutes.
- **Band:** one of the six detectors, D1 to D6 (0.75–5.00 µm). Each band has its own colour dot.
- **Date filter:** optional From and To dates.
- **Load patch** loads the view from saved observations. Changing Width or Band reloads by itself.
- **Search IRSA** asks the live NASA archive for observations at the typed position, band and dates.

A view holds at most 120 frames. If there were more, the status line says so.

**Play and compare**

- **Play** (or `Space`) blinks through the frames. Choose 0.7, 1.2 or 3.0 fps.
- The previous and next buttons, the slider, the `←` / `→` keys and the filmstrip under the image all step through frames.
- **Compare** shows two dates side by side. Pick the second date in the **Compare** menu above the filmstrip.
- **Zoom** slider up to 5×, drag to pan, **Reset** to go back.

**Overlays**

- **Guides:** the target box and the other marks drawn on the image.
- **Flags:** a red mask over pixels the SPHEREx pipeline flagged (dead, saturated, transient and so on). Hover a red pixel to see the flag name.
- **Tint:** colours the image with its band colour.

**Inspect**

- Click any pixel, then open the **Pixel** tab: brightness (MJy/sr), uncertainty, wavelength, native pixel coordinates and flags.
- With the image focused, the arrow keys move a crosshair one pixel (`Shift` for ten) and `Enter` inspects it.
- The **Observation** tab shows the date, observation ID, band, wavelength, exposure and percentage of flagged pixels. Click the flagged card to preview the mask.
- **FITS** downloads the cutout. **Full FOV** shows the whole detector image. **IRSA** opens the archive record.
- **Link** copies a URL of the current view. **JSON** exports the session.
- Frames that do not cover the patch well enough are left out of playback and listed under the timeline with the reason.

### 2. Motion tracker: follow a moving object

The tracker is in the right panel under the inspector.

**Track something you click**

1. Click a star or asteroid in the image.
2. The app tries to name it: it asks IMCCE SkyBoT (asteroids and comets) and SIMBAD (stars) for an object within one SPHEREx pixel (6.15″) of the click. A match fills the **Object** box. A match is positional, not proof.
3. Press **Track point**. The tracker measures the source's position on every frame.

**Track a Solar System object by name**

1. Type a designation in **Object**, for example `Vesta`, `4`, `Ceres`, `433 Eros` or `29P`. No click is needed.
2. Press **Track point**.
3. The predicted position at every exposure comes from JPL Horizons, as seen from the SPHEREx spacecraft. It is drawn as a dashed purple path next to the measured positions.

**Track a moving object with no name**

1. Click the object on one frame.
2. Press **Pick 2nd**, step to a later frame and click the object again.
3. Press **Track point**. This is a straight-line guide from two clicks, not an ephemeris, and the result says so.

**Read the result**

- **Verdict:** one line that compares measured and JPL speed and heading, with the confidence and how many frames were measured.
- **Speed, Heading, Change, Measured:** the main numbers. Change says whether the motion is steady, speeding up, slowing down or curving.
- **Two charts:** the path on the sky, and speed and distance over time. Click a point or bar to jump to that frame.
- **Offsets:** the gap between measured and predicted position in arcseconds, flagged when it is larger than the agreement rule allows.
- On a frame where the object is outside the image, no path is drawn and the dates that do contain it are listed.
- **3D motion:** for a tracked Gaia star with a reliable distance (such as Barnard's Star), opens a 3D view of the star moving relative to the Solar System from year 1516 to 2516.
- **Export JSON** saves positions, fit modes, velocities and kinematics. **Clear** resets the tracker.

### 3. Spectrum: measure a source's light

The Spectrum panel is under the image.

1. Click a star in the image, or press **Center** to use the field centre.
2. Choose the **Window**: ±7 days of the current frame, the viewer's dates, or all dates (slow).
3. Optionally set **z**, a reference redshift (leave 0 for stars and other nearby targets).
4. Press **Measure**.

The result:

- **Spectrum:** brightness (µJy) against wavelength (µm), with error bars. Point colour is the detector band.
- **Time:** brightness over time inside a narrow wavelength interval that you set.
- **Release:** show QR3, QR2 or both. Releases are never mixed in one check.
- **Flagged:** show or hide points that failed a quality check (drawn as crosses).
- Click a point to open the frame it came from.
- **Dip checks:** cards that test for absorption dips near H₂O, CH₄, CH₃OH, CO₂ and CO wavelengths. These are screening indicators, not identifications.
- **CSV**, **JSON** and **SVG** export the measurements, the full analysis with its calibration sources, and the chart.

### 4. 3D Map: where things are in space

Press **3D Map** in the top bar.

- **Catalog:** *Galaxies · DESI DR1* (10,000 galaxies, distances in Mpc from measured redshifts) or *Stars · Gaia DR3* (5,000 stars within about 200 pc, distances from parallax). The Solar System is at the origin.
- **View:** a thin slice (less overlap), the full volume, or the neighbourhood of the selected object. **Distance limit** and **Slice thickness** narrow it down.
- **Move around:** drag to orbit, `Shift`-drag to pan, scroll to zoom, `W/A/S/D` and `Q/E` to fly. **Top view**, **Fit visible objects**, **Focus** and **Reset** set the camera.
- **Find an object:** search by catalog name or ID, sort by distance or name, and pick a row to locate it. Or click a point.
- **Details panel:** the object's measured values. **Error bars** shows its distance uncertainty.
- **Year** (stars only): move stars from 1516 to 2516. Only stars with a measured radial velocity move in 3D; the others stay fixed.
- **Inspect sky** jumps to the Sky workspace at the object's coordinates.
- **Export JSON** saves the selected object.

### 5. Archive: more data

- **Search IRSA** (Sky toolbar) fetches observations for any position from the public archive and caches the cutouts locally.
- **Archive → Import FITS** adds your own SPHEREx Level-2 FITS files, with a release label. Import is turned off on a shared public link.

## A five-minute tour

1. Open the app. Vesta loads by default.
2. Press **Load archived Vesta example · Aug 4–5** in the right panel. This uses bundled files and works offline.
3. Press **Play** and watch the bright source move against the stars.
4. Press **Track point** (the Object box already says Vesta). Read the verdict: measured speed against JPL's.
5. Turn on **Flags** and hover the red pixels.
6. Choose **Barnard's Star**, click the star, press **Track point**, then **3D motion**.
7. Open **3D Map**, pick a galaxy and press **Inspect sky**.

## Limits to know

- **The first load of a view is slow.** Image cutouts are downloaded from IRSA on demand and cached. A first track on an empty cache can take many minutes; later runs take seconds.
- **The cache is capped at 2 GB** unless `SPHEREX_CACHE_GB` is set. Past the cap, frames are deleted and downloaded again.
- **Do not measure a spectrum on a moving object.** Measure uses one fixed sky position, so an asteroid leaves it. Use a star field.
- **Spectra are exploratory.** One source is fitted at a time. Bright, saturated or crowded sources can fail the quality checks.
- **Dip checks are not chemical identifications.**
- **The 3D catalogs are samples**, not complete maps. Wavelength is not depth: the 3D distances come from DESI and Gaia, not from SPHEREx.
- **Measure supports releases QR2 and QR3 only.** DR1 frames are listed as rejected.

## More documentation

- [startguide.md](startguide.md): setup on a new machine, the observation index, troubleshooting.
- [outputs/spherex-prototype/README.md](outputs/spherex-prototype/README.md): methods, data sources, science limits, running a shared server.
- [outputs/spherex-prototype/STAR_TRACKING.md](outputs/spherex-prototype/STAR_TRACKING.md): how the tracker measures positions.
