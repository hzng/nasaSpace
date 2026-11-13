# SPHEREx project handoff — November 11, 2026

Development is paused at the user's request. This file records the current state and the work still to do. Do not treat unfinished controls or scientific analysis as verified.

## User's goal

Build a local, public-facing astronomy web app for the NASA SPHEREx challenge. Users choose right ascension and declination, play aligned observations over time, change field width and detector immediately, inspect real measurements, graph brightness versus wavelength or time, and see possible chemical signatures with clear uncertainty. The user also wants a physically grounded 3D catalog map, using independent distances from Gaia and galaxy redshifts. Real observations, dates, source files, and quality warnings matter more than decorative imagery.

The user supplied a summary of an otherwise inaccessible shared ChatGPT conversation. It emphasizes real distances for 3D positions; the wavelength axis of a spectral cube is **not** physical depth. Chemical dips are candidates, never proof or a composition percentage. Galaxy redshift maps and Milky Way ice absorption are different scientific tasks. Do not infer 3D motion from image brightness, reverse stars to the Big Bang, or paint a continuous chemical map from a handful of measurements.

## Workspace and entry points

- App: `outputs/spherex-prototype/`
- Launcher: `outputs/spherex-prototype/Launch SPHEREx.cmd`
- Local URL, when the server is running: `http://127.0.0.1:8765/`
- User-facing readme: `outputs/spherex-prototype/README.md`
- Large working cache and FITS data: `work/prototype-cache/` (outside the deliverable folder)
- Original earlier data: `outputs/spherex-viewer/data/`
- Python dependency target: `work/deps/`; Python used: `C:\Users\usethisfolder\python.exe`
- Use `python -X utf8` for scripts on this Windows installation.

The app is plain HTML/CSS/JavaScript served by Python's standard-library HTTP server. `server.py` provides image session, import, pixel-inspection, archive-search, and new spectrum-job APIs. `science.py` performs FITS/WCS alignment and keeps original calibrated pixels available. `archive.py` discovers and downloads official IRSA files. `spectroscopy.py` fits source brightness and screens candidate absorption features. `sync_catalogs.py` builds physically positioned DESI and Gaia sample catalogs.

## Verified data and completed work

- The latest publicly verified SPHEREx spectral-image release is **QR3**, with QR2 retained for earlier observations. A claimed DR1 release in the pasted conversation was checked: the referenced IRSA DR1 documentation returned 404 and the public cloud `dr1/` prefix was empty at the time checked. A scheduled November 2026 release is not evidence that files are public. Check again before claiming DR1 availability.
- The official IRSA TAP query collected **4,227** FITS observation records across Vesta, Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, and R Draconis. All 4,227 files downloaded successfully; `work/prototype-cache/sync-status.json` reports zero failures. Vesta 349, Barnard 359, Epsilon Indi 447, WISE 0855 256, RW Aur 333, R Dra 2,483. These are observations of the selected sky fields, not necessarily detections of the named objects in every image.
- The five widths (5, 10, 15, 30, 60 arcminutes) and six detectors give **180** target/detector/width combinations. `work/prototype-cache/prepared-all.json` now contains 180 prepared results. Some combinations correctly have zero usable full-field frames; their actual detector coverage does not span the chosen 60-arcminute square. Do not claim all 180 have playable frames without checking.
- Padded source cutouts (90 arcminutes for a 60-arcminute target) avoid the earlier tiny square caused by stretching a small download into a large viewer. Images are aligned onto a fixed north-up/east-left sky grid. Playback requires at least 99% detector footprint coverage and 80% usable finite pixels. Genuine detector-edge gaps cannot be filled scientifically; partial observations are excluded from playback and listed with their original FITS links. The earlier Vesta August 4–5 example was checked with complete field coverage.
- Field width and detector steppers and direct select changes auto-apply. Rapid repeated choices coalesce to the latest request; prepared views are cached. The Vesta example shortcut and notes explain that a fixed sky field does not always contain the moving asteroid. Existing control and coverage tests passed before the latest spectrum and 3D markup additions.
- The official latest publicly listed wavelength, wavelength-width, pixel-area, and point-source-shape calibration products were downloaded into `work/prototype-cache/calibrations/` (30 files). `calibrations.py` indexes them and records URL and SHA-256.
- `spectroscopy.py` uses actual calibrated FITS pixel arrays, variance, flags, the official wavelength/pixel-area maps, and the point-source shape to estimate flux and error in each observation. It records rejected and cautionary points rather than inventing zero values. A real RW Aur test found a very bright but contaminated/saturated fit and **rejected it for chemistry**. The candidate screen requires nearby-in-time measurements, local continuum on both sides, adequate wavelength coverage, and a 5-sigma dip with a conservative floor. This is a screening model, not a confirmed molecule identifier or ML probability.
- `outputs/spherex-prototype/catalogs/galaxies.json` contains 10,000 real DESI DR1 galaxy records with measured positions/redshifts, comoving distances under Planck18, 3D ICRS coordinates, formal redshift-related distance error, and lookback time. `catalogs/stars.json` contains 5,000 real Gaia DR3 stars selected for relatively reliable parallaxes, with coordinates, distance, proper motion, and full 3D velocity only where a radial velocity exists. These are quality-filtered samples, not complete catalogs. Metadata says which model/epoch and approximations are used.
- `index.html` contains new spectrum and 3D UI markup. `light.js` contains a spectrum/time plot, detector colors, error bars, release filters, candidate cards, quality records, CSV/JSON/SVG exports, and API job polling. It was added immediately before this pause and has **not been syntax-tested or exercised end-to-end**.

## Work to do before claiming the app complete

1. Create `outputs/spherex-prototype/universe.js`, which `index.html` already references. Implement an interactive 3D canvas using the real `catalogs/*.json` coordinates; click/select, rotate/pan/zoom, focus/reset, scale in pc or Mpc, metadata and source citations, and export. For stars, project positions by the actual 3D velocity only where radial velocity is measured; leave others at the catalog position or clearly show limited sky-only motion. Use the existing `universe-*` element IDs in `index.html`. Clicking “Inspect SPHEREx here” should switch to the sky viewer at the object's coordinates, carrying redshift for galaxy feature markers where appropriate.
2. Add responsive styles for the new main mode navigation, spectrum panel/plot, candidate cards/tables, 3D canvas and details in `app.css`. Check the new markup and controls against CSS and DOM IDs. Existing UI tests predate these features.
3. Integrate `app.js` with the 3D object-open event, mode switching, and correct loading/empty states. Current `app.js` dispatches `sky-session-ready` and `sky-point-picked`; `light.js` listens. Ensure selecting a spectrum point can open the corresponding observed frame safely and does not silently lose the result. Keep fixed-position versus moving-source behavior explicit.
4. Verify `light.js` syntax and the spectrum API end-to-end on real cached observations. Check actual wavelength/flux/error values, reference markers, negative or non-detections, missing calibration/flags, time filtering, and that no contaminated point is shown as a strong chemical candidate. Test a clean candidate fixture only as synthetic **test data**, never as a displayed real discovery. Consider an explicit analysis report for a selected real sightline.
5. Verify all 180 prepared combinations: count 180, no processing failures, every playable frame meets footprint/finite thresholds, and zero-frame views display their actual coverage reason. Spot-check full 60-arcminute renders across detectors, including R Dra and RW Aur, and date filtering. Check for any cached sessions made before current source-selection logic.
6. Restart the local app server to load changed Python code. Before stopping anything, identify the process that owns port 8765 and confirm it is this project's server. Then use the launcher or a hidden background process. The old server was still running during development and may be serving stale module memory. Run API smoke tests after restart.
7. Update `README.md`, `requirements.txt` (include the installed `photutils` dependency), and update instructions. Distinguish currently public QR3/QR2 data from planned DR1. Describe archive-refresh steps, calibration cache, catalog sample selection, scientific limits, large disk use, and URLs. Verify the calibration CLI bootstraps `work/deps` if it is meant to be run directly.
8. Make a final verification report in the deliverable folder with data counts, archive release status and check date, code/test results, scientific limits, and exact example fields. Browser visual testing of localhost was denied earlier by the computer-use origin check; do not work around that denial. Backend, file, numeric image and DOM/JS tests remain available.

## Relevant files

`outputs/spherex-prototype/`: `index.html`, `app.css`, `app.js`, `light.js`, `server.py`, `science.py`, `archive.py`, `archive-config.json`, `sync_featured.py`, `prepare_featured.py`, `calibrations.py`, `spectroscopy.py`, `sync_catalogs.py`, `catalogs/galaxies.json`, `catalogs/stars.json`, `Launch SPHEREx.cmd`, `Update featured data.cmd`, `README.md`, `requirements.txt`.

`work/`: `test-controls.cjs`, `test_coverage.py`, `prototype-coverage-verification.json`, `measurement-real-example.json`, `prototype-cache/featured-library.json`, `prototype-cache/sync-status.json`, `prototype-cache/prepared-all.json`, `prototype-cache/view-index/`, `prototype-cache/spectra/`, `prototype-cache/calibrations/`.

## Scientific and archive sources

- [NASA/IPAC SPHEREx archive](https://irsa.ipac.caltech.edu/Missions/spherex.html)
- [SPHEREx quick-release documentation](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html)
- [SPHEREx data access](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/)
- [SPHEREx data products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/)
- [Spectrophotometry tool and flags](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html)
- [Official point-source shape tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/)
- [SPHEREx planned release schedule](https://spherex.caltech.edu/page/data-products)
- [DESI public access](https://data.desi.lbl.gov/doc/access/)
- [Gaia DR3](https://www.cosmos.esa.int/web/gaia/data-release-3)
- [NASA Webb example ice spectra](https://science.nasa.gov/asset/webb/chamaeleon-i-dark-cloud-nircam-nirspec-and-miri-spectra/)

## Resume instruction

Respect this pause. When the user asks to continue, start with the missing `universe.js` and end-to-end verification. Preserve cached FITS files and source provenance. Do not redo the completed 4,227 downloads or 180 precomputations unless data has changed or validation finds a concrete problem. Check archive status again before describing the “latest” SPHEREx release.
