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
