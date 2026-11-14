# Orchestrator plan: real ephemeris for moving objects

Last updated: 2026-11-12. Branch `tracking-star`. Nothing is committed.

## Goal

SPHEREx Observation Lab is a local web app for the NASA SPHEREx challenge: pick a sky position, play aligned real observations over time, measure light, and track moving sources with honest uncertainty. The priority item is that every Solar System object gets its predicted position at each exposure from JPL Horizons, shown against the measured centroid with the offset in arcsec.

Deadline: **not stated** in the handoff or the brief. Tasks are ordered so the demo path works first.

## State found (from the handoff and the code)

- Done: viewer, flags, spectra, 3D catalog map, star tracking with Gaia, kinematics (`tracking.py::_kinematics`).
- Approximate today: `tracking.py::_build_ephemeris_predictor` fits a degree-2 polynomial through IRSA MOST marker positions baked into the Vesta field. The 2nd-anchor mode extrapolates linearly from two clicks.
- Broken for moving objects: frames carry `mjd` from FITS `DATE-OBS`, which is exposure **start**. The midpoint is `MJD-AVG`, 57 s later (0.7″ for Vesta).
- This worktree has no `work/` folder. Python runs from the sibling worktree: `../fable/work/venv/Scripts/python.exe -X utf8` with `PYTHONPATH` set to `..\fable\work\deps` (read only). The app starts with the bundled frames only (2 Vesta frames).
- Only one featured moving object exists (Vesta). The acceptance check needs two, so a second one must be found (T5).

## Decisions made by the orchestrator (T0, HARD, done)

Measured on 2026-11-12 against the live service.

| Question | Decision | Evidence |
|---|---|---|
| Observer | SPHEREx itself: Horizons center `500@-163182` | Horizons lookup API returns `SPHEREx (spacecraft)`, spkid `-163182`, pdes `2025-047E`. Trajectory is concatenated TLEs, 2025-Mar-12 to now + 30 d. |
| Is that ephemeris right? | Yes, to about 2 km | Horizons geocentric vector of `-163182` at exposure midpoint against FITS header `X_SC/Y_SC/Z_SC`: 1.63 km and 2.17 km on the two bundled Vesta frames. |
| Time scale | FITS times are UTC (`TIMESYS=UTC`). Send JD UTC with `TIME_TYPE='UT'` to observer tables. | Passing the UTC value as TDB moves the spacecraft 519 km (69.18 s). The correct conversion gives 2 km. |
| Epoch | Exposure midpoint, FITS `MJD-AVG` in the `IMAGE` header | `DATE-OBS` = `DATE-BEG` = start. |
| Fallback observer | Geocenter `500@399`, only when Horizons has no SPHEREx ephemeris for the epoch, and always with a visible warning | Horizons replies `No ephemeris for center "SPHEREx (spacecraft)" prior to A.D. 2025-MAR-12`. |
| Rates | Horizons `dRA*cosD`, `dDEC/dt` from SPHEREx are instantaneous and include the spacecraft's orbital parallax swing (Vesta dDec: -4.0 ″/hr from SPHEREx, -23.3 ″/hr geocentric at the same instant). Predicted speed between exposures comes from the predicted positions, through the existing `_kinematics`. The instantaneous rate is shown per point and labelled. | Hand query, both observers. |
| Tolerance | Offset flagged when it exceeds `max(3 × centroid error, 3.1″)` (3.1″ is half a native pixel) | Assumption, not a calibrated error model. |
| 2nd-anchor mode | Kept for unidentified objects only, relabelled "no ephemeris, user guide". Never used when a designation is given. | Scope choice. Say so if you want it removed. |

First offsets (hand check, 2 bundled Vesta frames, wing fits on a saturated core, centroid error 0.9″): measured minus Horizons from SPHEREx = 0.90″ and 2.21″. Geocentric gives 0.37″ and 2.37″. Two frames cannot separate the observers for Vesta (parallax difference about 1.2″).

## Contract between tasks

`ephemeris.py`:

```python
fetch(designation, jd_utc_list, cache_dir) -> dict   # raises EphemerisError(message)
# {'source': 'JPL Horizons', 'object': '4 Vesta (A807 FA)', 'command': 'Vesta;',
#  'observer': 'SPHEREx (spacecraft) (-163182)', 'observer_code': '500@-163182',
#  'retrieved_utc': '2026-11-12T21:16:28Z', 'from_cache': False, 'warnings': [],
#  'rows': [{'jd_utc', 'ra', 'dec', 'dra_cosdec', 'ddec', 'delta_au', 'deldot_km_s', 'light_time_min'}]}
```

`/api/track` request gains `object` (designation). Result gains `ephemeris` (the dict above without `rows`, plus `offset_median_arcsec`, `offset_max_arcsec`, `compared`, `flagged`, `tolerance_rule`, `time_scale`, `motion`, `change`). Each point gains `mjd_mid`, `predicted_sky`, `predicted_east_arcsec`, `predicted_north_arcsec`, `rate_arcsec_per_hr`, `delta_au`, `light_time_min`, and for accepted points `offset_arcsec`, `offset_east_arcsec`, `offset_north_arcsec`, `tolerance_arcsec`, `within_tolerance`.

## Tasks

| ID | Outcome | Files | Depends on | Difficulty | Owner | Status |
|---|---|---|---|---|---|---|
| T0 | Observer, time scale, epoch and tolerance decided with evidence | none | none | HARD | orchestrator | done |
| T1 | `ephemeris.py`: Horizons fetch, disk cache, fixture lookup, visible errors | `ephemeris.py` (new), `fixtures/horizons/` (new) | T0 | MEDIUM | sonnet subagent | done, audited |
| T3 | UI shows predicted track, measured centroid, offset, flag and source label | `tracking.js`, `index.html`, `app.css` | contract only | MEDIUM | sonnet subagent | done, diff audited, seen in browser |
| T5 | A second moving object with real frames in the local cache, plus more Vesta frames | `work/` only (not in git) | T0 | MEDIUM | sonnet subagent | done; its date for Ceres was wrong (2025-06-24, not 06-26) |
| T2 | Tracker uses the ephemeris as the prediction; MOST polynomial removed | `tracking.py`, `server.py` | T1 | MEDIUM | sonnet subagent | done, diff audited |
| T4 | Fixtures for both objects, README and STAR_TRACKING updated | `fixtures/horizons/`, `README.md`, `STAR_TRACKING.md` | T2, T5 | EASY | orchestrator (subagent API returned 403) | done |
| F1 | Six backend fixes from the Codex challenge | `ephemeris.py`, `tracking.py` | T2 | MEDIUM | orchestrator (sonnet failed twice on a 403 sign-in error) | done, checked |
| F2 | Four UI fixes from the Codex challenge | `tracking.js`, `app.css` | T3 | MEDIUM | orchestrator (same reason) | done, checked with a stubbed DOM, not seen in a browser |
| T6 | Audit: diffs read, offsets for 2 objects, hand check of one epoch, offline run | none | all | HARD | orchestrator | done, except a browser look at F2 |

Parallel now: T1, T3, T5 (no shared files). Then T2. Then T4 and T6.

## Cut or deferred

- Replacing the static gold "Vesta guide" marker with the Horizons position. The tracker no longer uses it.
- Bundling the second object's FITS in git as a seventh featured field. Its frames stay in the local cache; a fresh clone needs one online IRSA search.
- Automatic choice among multiple comet apparitions. The error lists the matches.
- SBDB, SkyBoT, `astroquery`. Plain `requests` is enough and is what the project uses.
- All other handoff items (180-view verification, spectrum end-to-end checks). Not part of this work item.

## Log

- 2026-11-12: T0 done. T1, T3, T5 started.
- 2026-11-12: T1 done. Audit: file read in full (129 lines, plain `requests`), self-check re-run by the orchestrator against live Horizons and passed (Vesta position to 1e-6 deg, cache hit, unknown object, ambiguous name, pre-launch geocentric fallback with warning, offline with and without cache). Known limits: a request that mixes pre-launch and in-range times falls back to geocentric as a whole; the "no ephemeris for target" message is untested live. T2 started.
- 2026-11-12: T2 done. Audit: full `git diff` read. Polynomial predictor and `guide_skies` are gone; predicted position is the Horizons row for that frame's `MJD-AVG`; offsets are measured minus predicted. Agent's live run reproduced the hand check (0.904″, 2.212″, both within tolerance, both wing fits) and the unknown-object and offline messages. Orchestrator changed one value: predicted points go to `_kinematics` with the 0.3″ floor instead of 1.0″. Not run: 2nd-anchor path, the click-far-from-prediction warning. Note: the Vesta field needs width 15′ or more, at 5′ and 10′ Vesta is outside the field.
- 2026-11-12: T3 done. Audit: full diff read (114 lines added across 3 files, `app.js` untouched). Orchestrator ran the real app in a headless browser on port 8774: Vesta example, Track point with the prefilled designation. On screen: "JPL Horizons · 4 Vesta (A807 FA) · observer: SPHEREx (spacecraft) (-163182) · retrieved 2026-11-13 05:20 UTC · cached", "Offset median 1.6″ · max 2.2″ over 2 frames", "All 2 compared frames agree", speed 48.6 ″/hr measured against 48.8 ″/hr predicted, heading 119° both. No console errors. Orchestrator added `white-space:pre-line` so the multi-line ambiguous-name error keeps its rows. Open: the prefilled "Vesta" is also sent when the user clicks a star on the Vesta field (the server then warns that the click is far from the ephemeris position); once the user types in the box, it no longer follows field changes. Stale copy remains in `app.js` ("Archived Vesta guide · position unverified"); moved into T4.
- 2026-11-12 22:01: the user squashed T1 to T3 into commit `9595e24` through Pane. Not done by the orchestrator. Everything below is uncommitted.
- 2026-11-13: T5 done after a usage-limit pause. 6 Vesta frames (3 exposures in D3 and D6) and 7 Ceres D1 frames are in `work/prototype-cache/` and in `imports.json`; 8 Ceres D4 frames are also there but fail the centroid fit. Its finding, not yet verified with the app: IRSA now serves these 2025 exposures under `dr1` paths, and `archive.py` line 72 only accepts `qr<n>`, so **Search IRSA** would drop them.
- 2026-11-13: Codex adversarial challenge run at the user's request (14 findings). Fixed: rows matched to epochs by returned JD (confirmed live that Horizons reorders a descending list), lock around the cache read-merge-write, designation validated and cache file checked against the command, `TIMESYS` honoured, measured and predicted motion on the same midpoints and the same accepted frames, failed rerun clears the old result, frames without a centroid counted in the verdict, predicted path drawn when nothing is measured, rate tooltip wording. Not fixed, documented in the README: a background star at the predicted position can be measured instead of the object; cached rows never refresh; one date without a SPHEREx trajectory makes the whole request geocentric; offline lookup does not try the geocentric cache.
- 2026-11-13: T6 acceptance, run through `server.create_session` and `server.create_track` without the HTTP server (the audit server was stopped by the system for low memory and was not restarted).

  | Object | Detector | Frames | Median | Max | Flagged | Speed measured / predicted |
  |---|---|---|---|---|---|---|
  | 4 Vesta | D3 | 3 | 0.75″ | 3.33″ | 0 | 48.92 / 48.92 ″/hr |
  | 4 Vesta | D6 | 3 | 2.55″ | 3.28″ | 1 | 48.97 / 48.92 ″/hr |
  | 1 Ceres | D1 | 7 | 2.70″ | 4.79″ | 1 | 34.04 / 34.06 ″/hr |

  All 13 centroids are wing fits on saturated cores. Same numbers with every network call forced to fail (`from_cache` true). Fixtures alone, with an empty cache and no network, serve all 3 Vesta and 7 Ceres epochs. Hand check: Ceres frame `2025W26_1A_0376_1`, JD UT 2460851.301895483, app RA 13.865503221 Dec -5.754458364, direct Horizons query returns the same digits at 2025-Jun-24 19:14:43.770 UT, which is the FITS exposure start plus half the exposure.
- Open: F2 not seen in a browser; 2nd-anchor path and the click-far-from-prediction warning never run; `dr1` archive filter; tolerance rule is an assumption and flags 2 of 13 frames.

# Orchestrator plan — Supabase storage, small local cache

Updated 2026-11-12 (end of session). Branch `fable`. Nothing committed.

## Goal

Keep only the six bundled example fields on disk and hold the list of all other SPHEREx observations in Supabase, with pixels fetched from NASA when a view needs them. The demo path (six examples) must keep working offline.

## Decisions (user, 2026-11-12)

- Supabase free tier, index only. No pixel mirror.
- The full dataset from the other machine is gone or out of reach.
- User created the project. URL and key are Pane secrets `spherex/SUPABASE_URL` and `spherex/SUPABASE_SERVICE_KEY`.

## Design as built

- Index = `featured-library.json`, built from six IRSA footprint queries with no file downloads, stored as one object in the private Supabase Storage bucket `spherex`. No database table.
- Server pulls the index at start; the local copy is the offline fallback.
- Opening a view downloads only the missing cutouts, sized to that view, six at a time. Measuring light downloads 5-arcminute cutouts around the point. Positions other than a saved field center are checked against archive footprints first.
- After each job the cache is trimmed to `SPHEREX_CACHE_GB` (default 2): cutouts first, oldest first, then older rendered views. The newest view, user imports, the index, measurements and calibrations are never deleted.
- The archive now returns DR1 file paths. `archive.py` and `archive-config.json` accept them.

## Tasks

| ID | Outcome | Owner | Status and evidence |
|----|---------|-------|---------------------|
| T1 | App boots on this machine | haiku, then orchestrator | Haiku failed (no PyYAML wheel for Python 3.15). Fixed with `uv venv --python 3.14 work/venv`; packages in `work/deps` import. Server booted with no index: 6 fields, Vesta example view rendered 2 bundled frames. |
| T2 | Storage decisions and credentials | user | Done. |
| T3 | `remote_store.py`, `.env.example` | sonnet | Done. Live self-check printed `remote store OK`. Orchestrator added whitespace stripping for pasted keys. |
| T4 | Fetch on demand, cache cap, index pull | orchestrator | Done. Evidence below. |
| T5 | Index-only `sync_featured.py`, updated `.cmd` | sonnet | Done after one correction: first run dropped DR1 rows (1,315 records). After the DR1 fix: 4,256 records, exit 0, uploaded. |
| T6 | README, launchers | haiku | Done. Diff read; numbers match the measured facts. |
| T7 | Audit | orchestrator | Done. Evidence below. |

## Evidence (all run on 2026-11-12)

- Index: Vesta 351, Barnard 358, Epsilon Indi 461, WISE 0855 258, RW Aur 335, R Dra 2,493; total 4,256 (2,941 DR1, 1,315 QR3). 0 FITS downloaded by the sync. File is 3.6 MB.
- Supabase round trip: local index removed, server restarted with credentials, pulled file has the same SHA-256 as the uploaded one; `/api/library` showed the same six counts.
- Offline fallback: server restarted without credentials used the local copy (4,256).
- On-demand view: Vesta D3 10 arcmin fetched 60 cutouts in 72 s (155 s on a second cold run), 58 frames, 4 excluded, 0 failures. Reopen: 2 s, "Ready from local cache".
- Pixel inspection on a fetched frame returned a value and uncertainty.
- Light measurement (within 7 days): fetched 52 small cutouts, 70 points, 58 accepted, 176 s including calibration downloads.
- Tight cap (0.1 GB): after a job, counted cache was 97 MB, the open view was kept, pixel inspection and a 58-frame track re-fetched evicted files and completed, a stale view id returned "This sky view is no longer cached. Open it again."
- Custom position 0.3 degrees off the Vesta center: footprint check ran, 60 frames, 0 failures.
- Date-filtered Barnard D3 view returned 0 frames; the index confirms no observations in that window.
- Trim rules checked in a temp folder with a one-off script (not added to the repo).
- A bug found and fixed during the audit: the first trim policy deleted the view that was open.

## Not checked

- The browser UI. All checks were against the HTTP API.
- 60-arcminute views and the dense R Draconis field (large downloads).
- `Launch SPHEREx.cmd` and `start.ps1` were edited but not run.
- Supabase access from a second machine.

## Known limits

- "Measure light" rejects DR1 observations (2,941 of 4,256): calibration support exists for QR2 and QR3 only.
- First open of a view needs the network and takes one to three minutes for about 60 frames.
- Custom positions list only observations whose footprint contains the position.
- Vesta guide markers for non-bundled frames need `work/results.tbl`, which is not on this machine.
- "FITS" links of evicted cutouts return 404 until the view is reopened.
- One cutout failed at the archive and fell back to a 65 MB full detector file (existing fallback).
- Calibration files (332 MB after one measurement) are outside the cap.
- `VERIFICATION_REPORT.md` and the README bullet "Currently public releases (verified November 11)" predate the DR1 finding.

## Security note

- The Supabase key appeared once in a local error message during testing (the pasted value contained a line break). It was not sent outside this session. Rotate it if this transcript is shared.

## Deferred (not asked)

- DR1 calibration support for "Measure light".
- Re-verifying handoff items 1–8 and the milestones in `handoff/naelHandoff.md`.
- Mirroring pixels or rendered views (needs the Supabase Pro plan).

## Hosting (2026-11-12, user request)

- Temporary public link through a Cloudflare quick tunnel to the server on this machine, port 8765. The URL changes every time the tunnel restarts and stops when this machine sleeps or either process ends.
- Server runs with `SPHEREX_PUBLIC=1` and without Supabase credentials (it uses the local index copy).
- Added for the public link: host-only origin check (HTTPS tunnel), file import turned off in public mode, dotfiles such as `.env` never served.
- Checked through the public URL: page 200, library 4,256 observations, a view job posted with the page origin completed with 58 frames, frame image 200, dotfile 404, foreign-origin POST 403, import 403.
- Logs: `work/host-server.log`, `work/host-tunnel.log`.
- Not done: permanent hosting. It needs a Python host with disk, an account, and a commit and push.

## UI refinement (2026-11-12, user request; milestone 2 of `handoff/naelHandoff.md`)

Owner: sonnet subagent, audited by the orchestrator in a headless browser. Files: `index.html`, `app.css`, `app.js`, `tracking.js`.

- Five distinct marks: ivory cross (field center), blue open crosshair (clicked pixel), gold circle labelled "Guide" (archived Vesta guide), green or cyan circle (measured, wing fit), dashed violet circle (prediction).
- One legend directly under the image, listing only marks on screen.
- One Vesta callout instead of three strips; wording updated to "ivory cross".
- Frame chips and the Compare menu show date and UTC time.
- Disabled tracker buttons have titles and a helper line; the 3D reason is derived from `tracking.py` (unique Gaia match within 6.15 arcsec; parallax over 20 times its error and RUWE below 1.4).
- Progress bar while a view downloads.

Evidence (orchestrator, browser at 1440 px unless noted):
- Uncached Barnard view: bar showed 4 of 55 at 7.3 percent, then 55 frames, bar removed.
- Barnard track: 55 of 55 wing fit, "3D motion" enabled, helper "3D motion is ready for this Gaia star", legend Field center, Clicked pixel, Wing fit.
- Vesta example track from the guide position: 2 of 3 measured, asteroid, 48.6 arcsec per hour, 3D disabled with reason, legend shows the guide entry.
- No console errors in any flow. Subagent measured no horizontal scroll at 390 and 768 px and 40 px buttons; the 390 px screenshot was read.
- Orchestrator fix: the "Guide" label collided with the tracker label; moved below the circle and re-checked.

Not seen live: the violet "Predicted" mark (no test track produced a prediction; code path read only), and plain green "Measured" (both test stars were wing fits; it was seen before the pass).
Not in this pass: the 3D Map workspace, the spectrum panel, showing a reason for rejected track points (milestone 1), the view title still naming the previous target while a new one loads.

## Predicted path overlay (2026-11-12, user request)

Owner: sonnet subagent, then orchestrator fixes and audit. Files: `tracking.js`, `app.js`, `app.css`, `index.html`. No server change, no restart.

- After a track, a dashed violet line and one ring per frame mark the predicted position at each observation time (Gaia motion, archived ephemeris, or the user's two picks). Nothing is drawn for a track with no prediction source, and the tracker says so.
- Clicking a ring opens a card on the image: UTC time and release, what the prediction is based on (server text), predicted RA/Dec, measured or not with the server's reason, measured minus predicted in arcseconds and pixels, uncertainty and S/N, plus Earlier, Later, Go to this frame. Also reachable from a "Predicted path details" button. Escape closes it.
- Frames with no measurement and no prediction now show "Not measured in this frame" and the reason on the image.
- Subagent also fixed: stepping frames after a track wiped the track.
- Orchestrator changes after audit: card moves to the corner opposite the selected ring; predicted path drawn above the measured trail as hollow rings; note kept clear of the card.

Evidence (orchestrator, headless browser):
- Vesta example: 2 rings; cards read 2025-08-04 11:04 (0.90 arcsec from prediction) and 2025-08-05 00:07 (1.48 arcsec); third frame shows "Predicted position outside field of view"; clicking a ring left the clicked pixel unchanged; Go to this frame kept the track; Escape closed the card.
- Barnard: 55 rings clustered on the star, card shows the Gaia source name.
- RA/Dec conversion residual against measured points (subagent): 4.1e-10 arcsec max.
- 390 px: no horizontal scroll, card inside the image pane (64 percent of its height). No console errors.
- Public link serves the new files (`tracking.js?v=6`).

Limits: for stars the path is about one pixel long over the data span, so it looks like a cluster unless zoomed. Where prediction and measurement coincide the two lines overlap. The hover cursor was not observable in the headless browser. A click within 9 px of a ring opens the card instead of selecting that pixel.

## UI finish pass (2026-11-12, user request: premium, minimalist, button animations)

Owner: orchestrator, using the `impeccable` (polish, animate) and `better-ui` skills. Files: `app.css`, `app.js`, `index.html`. Refinement only: same layout, palette and content.

Measured before: 17 font sizes, weights 500 to 800, radii 4 to 14 px with 7, 9 and 11 px strays, monospace on labels, four filled brass buttons in view, helper text at about 3.6:1 contrast, unstyled file button, no selection or scrollbar theming.

Changed:
- Type: one scale (11, 12, 13, 14, 16, 20, 28 px), weights 400, 500, 600 (wordmark 700), headings in the Segoe UI Variable Display face at 600. Monospace kept for data only.
- Two decorative kicker lines above headings hidden; "TARGETS" label now "Targets".
- Helper text color raised to meet 4.5:1.
- Radii tidied (7, 9, 11 px removed).
- Buttons: brass gets an inset highlight, base shadow, hover lift and pressed-in state; every button variant scales to 0.96 on press; ghost buttons get a hover surface; trailing icons nudge on hover; Play is now tonal brass so each panel has one filled primary.
- Browser surfaces: selection, caret, scrollbar, placeholder and file button themed.
- Motion: a newly fetched view comes into focus (blur and fade, 700 ms); revisited views switch instantly. Track results and the path card rise in (300 ms). Reduced-motion users get short fades.
- Layout: inspector column stays in view on desktop as its own scrolling pane; frame strip fades at its edge; tracker result buttons sit in one row.

Evidence: computed sizes and weights read from the live page match the scale; no console errors on Sky, tracked state, 3D Map and Archive dialog; no horizontal scroll at 390 px; screenshots read at 1440 and 390 px. Public link serves `app.css?v=7`.

Not verified: hover and press motion in motion (headless screenshots are static; computed transition values were read). Spectrum results state after a measurement. Firefox and Safari.

## Image-first redesign of the Sky screen (2026-11-13, user-approved direction)

The detail pass was judged invisible by the user, who then chose the image-first direction from three options.
Owner: opus subagent (interrupted by the usage limit, resumed), audited by the orchestrator. Files: `index.html`, `app.css`, `app.js`. Built in preview files and swapped in after checks.

- One slim toolbar replaces the two-row settings card; the six targets live in a switcher popover.
- The sky image is the hero (670 px tall at 1440x900, was about 495 px); view controls float top-right, playback floats bottom-center with a "Frame N / total" counter.
- One side panel (420 px, stays in view) holds the Vesta note, Observation and Pixel tabs, and the motion tracker.
- Spectrum sits full width under the frame strip: at 420 px its axis text was unreadable (subagent's measured call under the brief's rule).
- Below 1121 px: single column, controls above the image, playback below it.

Evidence (orchestrator, live page): target switcher opens with 6 targets, picking Barnard loads 55 frames and closes the popover; frame counter moves on next and during play; pixel click opens the Pixel tab; Compare shows two 478 px panes and returns to Single; 3D Map hides the Sky layout, and "Inspect sky" on a galaxy returns to Sky with its coordinates and the empty-state message; no console errors; no horizontal scroll at 1440. Screenshots read: desktop default, tracked with path card, spectrum result (114 points), empty state, phone. Subagent reports all 14 brief checks passed, including 768 and 390 px.

Known imperfections: toolbar wraps to a second row at 1280 px and with long target names; stepper buttons are 38 px tall at 390 px; tracker "Clear" wraps on phones.

Git (updated 2026-11-13): the redesign is committed locally as `4683c0c` (titled "Squashed commits from tracking-star", content is the redesign), not pushed. Local `fable` is 2 ahead and 1 behind `origin/fable`; the diverging pair `6eb2cb2` and `19e20f7` have identical content. Handoff written to `outputs/handofffable.md`.

## Merge into `branch1` and re-host (2026-11-13, user request)

- Done: `fable` merged into local `branch1` as `4bc0126` (six conflicts resolved by hand; asset versions `app.css` v10, `app.js` v7, `tracking.js` v7). Not pushed.
- Done: hosted server replaced with the merge, run from `worktrees/branch1` on port 8765 in public mode, behind the same Cloudflare quick tunnel (URL unchanged).
- Evidence: on a spare port, the Vesta view opened with 58 frames, no console errors; tracking "Vesta" returned a JPL Horizons result in the side panel (2 of 58 frames measured, both within tolerance; the other 56 report "Predicted position outside field of view"). Through the public URL: page 200 with `app.css?v=10`, library 6 fields, dotfile 404, foreign-origin POST 403, import 403.
- Not checked: the result panel on phone widths; a track run through the public URL.
- Caution: `worktrees/branch1/work` is a junction to `worktrees/fable/work`. Remove the junction with `cmd /c rmdir` before deleting that worktree.

# Orchestrator plan: UI redesign (2026-11-13, user request)

Goal: a visual and interaction pass that makes the app feel like a polished product. Minimalist, every feature kept, no logic changes. Audit: `outputs/ui-audit.md`. Contract: `outputs/ui-design-spec.md`.

Where: the `fable` worktree, fast-forwarded to `branch1` (`cd0b7d3`). Development server on port 8767 (`SPHEREX_CACHE_GB=50`, so it never trims the cache it shares with the live site). The live site runs from `worktrees/branch1` on port 8765 and is not touched. Nothing is committed.

## Tasks

| ID | Outcome | Files | Depends on | Difficulty | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| U0 | Audit, design spec, stylesheet split into `css/*.css`, tokens and shared buttons and fields | `outputs/ui-audit.md`, `outputs/ui-design-spec.md`, `css/tokens.css`, `css/controls.css`, `css/overrides.css`, `index.html` links | none | HARD | orchestrator | done |
| U1 | `ui-select`: every native `<select>` replaced on screen by a keyboard-navigable listbox; target menu and all popovers share one menu style | `ui-select.js` (new), `css/menu.css`, `index.html` (script tag only) | U0 | HARD | opus | done |
| U2 | App bar and toolbar: one row at 1280 px, 32 px controls, grouped status | `css/appbar.css`, `index.html` header and toolbar | U0 | MEDIUM | sonnet | done |
| U3 | Stage: image inside its frame, floating bars, legend, frame strip, notes | `css/stage.css`, `index.html` stage | U0 | MEDIUM | sonnet | done |
| U4 | Side panel and tracker: no clipping, calm callout, metadata, flags, tracker results, path card | `css/inspector.css`, `css/tracker.css`, `index.html` aside | U0 | MEDIUM | sonnet | done |
| U5 | Spectrum panel, dialogs and footer | `css/spectrum.css`, `css/dialogs.css`, `index.html` spectrum, footer, dialogs | U0 | MEDIUM | sonnet | done |
| U6 | 3D Map screen | `css/atlas.css`, `index.html` universe section | U0 | MEDIUM | sonnet | done |
| U7 | Responsive pass at 375, 768 and 1280 px | `css/responsive.css`, `css/overrides.css` | U1 to U6 | MEDIUM | sonnet | done |
| U8 | README and verification notes describe the new files and look | `README.md`, `VERIFICATION_REPORT.md` | U7 | EASY | haiku | done |
| U9 | Audit: read every diff, screenshots at three widths, keyboard and mouse test of menus, demo flow, final spacing pass | none | U1 to U8 | HARD | orchestrator | done |

## Contract between U1 and the area tasks

U1 leaves each `<select>` in the DOM as the source of truth (class `ui-select-native`, hidden from sight and from the tab order) and adds next to it:

```html
<span class="ui-select" data-for="fov">
  <button type="button" class="ui-select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false">
    <span class="ui-select-value">15 arcmin</span><svg class="ui-select-chevron">…</svg>
  </button>
</span>
```

The list is a `div.ui-menu[popover]` in the top layer holding `div.ui-menu-list[role=listbox]` with `div.ui-menu-item[role=option]` rows. The trigger is a bordered field `var(--control-h)` tall, and borderless when it sits inside `.stepper` or `.transport`. Area tasks do not style `select` or anything named `ui-select*` or `ui-menu*`; they may only size the `.ui-select` wrapper (width, flex).

## Rules for every task

Tokens only, no new hard-coded colours. IDs and classes read by the JavaScript stay. No edits to `*.py`, `app.js`, `tracking.js`, `light.js`, `universe.js` (U1 adds `ui-select.js`). No commit, no server restart, nothing under `worktrees/branch1`. Each task uses its own browser state file under `work/browse/<id>/`.

## Log
- 2026-11-13: all subagents stopped at the usage limit before any edit; resumed after the reset.
- U1 to U8 done. Orchestrator review: read `ui-select.js` in full; keyboard and mouse test of the dropdowns (arrows, Esc, Enter, Tab, search, outside click, target menu arrows) passed; demo flow passed (play, pixel, compare, Vesta track with Horizons, spectrum 2 points, 3D Map, Inspect sky); computed-contrast script over every visible text node: all pass WCAG AA on both screens at 1440; no horizontal scroll at 375, 768, 1280, 1440; no console errors.
- Orchestrator fixes after review: stepper values truncated (sent to U7, fixed); star dialog rules duplicated in tracker.css and dialogs.css (merged into dialogs.css); chart drawn as a box inside a box (well padding removed); FOV badge beside the other pane's date in compare (hidden in compare); 3D Map badge under the camera buttons at 375 (badge moved below them). Stylesheet versions raised to v=12.
- Allowed hard-coded colours left: the dialog backdrop, and the flag swatch that repeats the canvas mask colour.
- Not checked: Firefox and Safari, screen readers, the R Draconis 2,493-option list with real data, dragging the 3D map by hand, hover and press motion in a live browser.
- Screenshots: `work/ui-shots/before/` and `work/ui-shots/after/`. Not committed, not deployed.
