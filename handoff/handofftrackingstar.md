# Tracking-star handoff — real ephemeris for moving objects

Written 2026-11-13. Branch `tracking-star`, worktree `worktrees/tracking-star`. App: `outputs/spherex-prototype/`.

## What this work is for

The motion tracker used to guess where an asteroid should be (a polynomial through a few stored marker positions). It now takes the predicted position at every SPHEREx exposure from JPL Horizons and shows it against the centroid measured in the image, with the offset in arcseconds and a flag when they disagree.

## State of the branch

- **Committed** (`9595e24`, "Squashed commits from tracking-star", made by Nael through Pane): `ephemeris.py`, the tracker integration in `tracking.py` and `server.py`, the UI in `tracking.js`, `index.html`, `app.css`, the first Vesta fixture, and `outputs/orchestrator-plan.md`.
- **Uncommitted** (10 files, see `git status`): the fixes from the Codex review, the Vesta and Ceres fixtures, the README and `STAR_TRACKING.md` sections, two copy strings in `app.js`, and the plan log. Nothing is pushed or deployed.
- **Not in git** (`work/` is ignored): 6 extra Vesta frames, 15 Ceres frames and the Horizons response cache, all under `work/prototype-cache/`. A fresh clone has only the 2 bundled Vesta frames.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Fetch and cache | `ephemeris.py::fetch(designation, jd_utc_list, cache_dir)` | Asks the Horizons API (plain `requests`) for astrometric ICRF RA/Dec, apparent rate, distance and light time. Caches per object and observer in `work/prototype-cache/horizons/`, keyed by epoch. Reads `fixtures/horizons/` as a read-only cache. Raises `EphemerisError` with a user-facing message. Never estimates a position. |
| Tracker | `tracking.py::track`, the `if obj:` branch | Reads each frame's exposure midpoint, fetches all positions in one call, measures a centroid within 3 pixels of each prediction, and reports the offset per frame. |
| Request | `POST /api/track` | New optional field `object` (a designation such as `Vesta`, `4`, `Ceres`). With it, no click is needed. |
| UI | `tracking.js` | Input `#track-object`, dashed purple predicted track, offset label per frame, source label, agreement banner, predicted speed and heading next to the measured ones. |

Decisions that must not be changed without re-checking them:

- **Observer** is the SPHEREx spacecraft, Horizons center `500@-163182` (confirmed with the Horizons lookup API). Its position agrees with `X_SC/Y_SC/Z_SC` in two FITS headers to about 2 km. The geocenter `500@399` is used only when Horizons has no SPHEREx trajectory for a date, with a visible warning.
- **Time** is the exposure midpoint, FITS `MJD-AVG` in the `IMAGE` header, in UTC, sent to Horizons as JD UT. The frame `mjd` used elsewhere in the app is the exposure start, 57 s earlier. Treating UTC as TDB moves the spacecraft 519 km; that is the check that catches a time-scale mistake.
- **Predicted speed** comes from the predicted positions through `_kinematics`, not from the Horizons rate. The rate seen from a spacecraft includes its orbital swing (about 20 ″/hr for Vesta) and is shown only in the tooltip.
- **Tolerance** is `max(3 × centroid error, 3.1″)`. This is an assumption, not a calibrated error model.

## How to run it here

This worktree has no Python environment of its own. Use the one in the `fable` worktree, from Git Bash:

```bash
cd outputs/spherex-prototype
export PYTHONPATH="$(cygpath -w "$(pwd)/../../../fable/work/deps")"
../../../fable/work/venv/Scripts/python.exe -X utf8 server.py --port 8765
```

- `ephemeris.py` has an assert-based self-check: run it the same way with `ephemeris.py` in place of `server.py`. It needs the network and ends with `ephemeris self-check OK`.
- Kill an old server and confirm the port is free before starting a new one; on Windows two Python servers can bind the same port.

Views to load:

| Object | RA | Dec | Width | Detector | Dates | Type in the object box |
|---|---|---|---|---|---|---|
| Vesta (bundled, works on a fresh clone) | button **Load archived Vesta example** | | 15′ | D3 | 2025-08-04 to 05 | `Vesta` (prefilled) |
| Vesta (local cache) | 223.015 | -11.99 | 30′ | D3 or D6 | 2025-08-04 to 05 | `Vesta` |
| Ceres (local cache) | 13.82 | -5.763 | 30′ | D1 | 2025-06-24 | `Ceres` |

Use **Load patch**, not **Search IRSA**, for the cached views.

## Evidence so far

Measured centroid minus Horizons position, through the real session and tracking code, 2026-11-13:

| Object | Detector | Frames | Median | Max | Flagged | Speed measured / predicted |
|---|---|---|---|---|---|---|
| 4 Vesta | D3 | 3 | 0.75″ | 3.33″ | 0 | 48.92 / 48.92 ″/hr |
| 4 Vesta | D6 | 3 | 2.55″ | 3.28″ | 1 | 48.97 / 48.92 ″/hr |
| 1 Ceres | D1 | 7 | 2.70″ | 4.79″ | 1 | 34.04 / 34.06 ″/hr |

- All 13 centroids are wing fits on saturated cores (pixel size 6.15″).
- The same numbers come back with every network call forced to fail. The fixtures alone, with an empty cache, serve all 3 Vesta and 7 Ceres epochs.
- Hand check: Ceres frame `2025W26_1A_0376_1`, JD UT 2460851.301895483, app and a direct Horizons query both give RA 13.865503221, Dec -5.754458364.
- For one and the same Vesta exposure the offset differs by up to 2.8″ between D3 and D6 with an identical prediction, so that part comes from the centroid, not the ephemeris.
- The first version of the UI was seen working in a headless browser on the 2 bundled Vesta frames (offsets 0.90″ and 2.21″, no console errors).

## Not done or not checked

1. **The last UI fixes have not been seen in a browser.** They pass `node --check` and a stubbed-DOM run only. They cover: a failed rerun clears the old result, frames without a centroid are counted in the banner, the predicted path is drawn when nothing is measured.
2. **Ceres has never been tracked through the real UI.** It was run through `server.create_session` and `server.create_track` directly.
3. **Search IRSA may drop 2025 data.** IRSA appears to serve these exposures under `dr1` paths now, and `archive.py` line 72 accepts only `qr<n>`; `archive-config.json` lists no `dr1` collection. The filter is confirmed in the code; the behaviour in the app is not tested.
4. **A background star at the predicted position can be measured instead of the object** and reported as agreement (Codex finding 2, the one P1 still open). Agreement over several frames of a moving track is the real evidence.
5. **Never run:** the 2nd-anchor mode after the change, and the warning for a click far from the predicted position.
6. **Known limits, documented in the README:** cached rows never refresh; one date without a SPHEREx trajectory makes the whole request geocentric; offline lookup does not try the geocentric cache; comets with several orbit records need the record number typed.
7. **Small UI gaps:** the prefilled `Vesta` is also sent when the user clicks a star on the Vesta field (the server warns about the distance); once the user types in the object box it stops following field changes. The static gold "Vesta guide" marker still comes from the old archived positions.
8. **Ceres D4:** 8 frames are in the cache but the centroid fit fails on all of them, although a bright peak sits within a pixel of the prediction. Not investigated.

## Next steps, in order

1. Start the app, load the Ceres view, type `Ceres`, press **Track point**, and look at the banner, the dashed track and the offsets. Then repeat with a wrong name and with the network off.
2. Commit the uncommitted work once step 1 looks right.
3. Fix or confirm the `dr1` archive filter (item 3), since it affects every new search, not only moving objects.
4. Decide on the tolerance rule: it flags 2 of 13 frames on saturated sources.
5. Decide whether item 4 needs a guard, for example rejecting a centroid that also appears at the same sky position in another frame.

## Where to read more

- `outputs/orchestrator-plan.md`: task list, decisions with evidence, and a dated log of every audit.
- `outputs/spherex-prototype/README.md`, section *Moving objects and JPL Horizons*.
- `outputs/SPHEREx-handoff-2026-11-11.md`: the wider project handoff. Its other open items (180-view verification, spectrum end-to-end checks) were not touched here.
