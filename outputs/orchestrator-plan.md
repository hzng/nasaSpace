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
