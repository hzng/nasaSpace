# Tracking fix handoff: target boxes, Vesta frames, tracker stall

Written 2026-11-13. Branch `branch1`, worktree `worktrees/branch1`. App: `outputs/spherex-prototype/`.
Follows `handoff/handofftrackingstar.md` (the JPL Horizons tracker), which still applies.

## What this work is for

A judge opening a target must see at once which source is the target, and the motion tracker must not look frozen. Three problems were reported by the user and fixed:

1. Nothing on the image said which star was Vesta, Barnard's Star, and so on.
2. The Vesta highlight "disappeared after 2 frames".
3. The motion tracker sat on "Preparing star tracking" and seemed not to work.

## State of the branch

| Commit | What |
|---|---|
| `cd0b7d3` | Gold named box on the selected target; Horizons tracks box and name the object and jump to a frame that contains it |
| `91ad0bd`, `21e8c16` | Interface redesign and server backlog fix, made by another session, not by this work |
| `cea2773` | Cache keeps the open view's files; tracker reports re-downloads; Vesta "not in this frame" note |

`branch1` is 4 commits ahead of `origin/branch1`. **Nothing is pushed.** This file is not committed.

## What changed and why

### Target box (`app.js`: `targetAt`, `drawTarget`, `MOVERS`)

- Shown before any tracking whenever **Guides** is on. The legend reads "<target> · expected position, not measured".
- Vesta: the archived MOST prediction (`frame.marker`), which exists only on the frames that contain Vesta.
- Barnard's Star, Epsilon Indi B, WISE 0855: SIMBAD J2000 position and proper motion (`MOVERS`, looked up 2026-11-13 through the `simbad.harvard.edu` mirror; the CDS host returned 404). Without this, Epsilon Indi B's box sat about 11 pixels off the star.
- RW Aurigae, R Draconis: the field centre (they barely move).
- Custom patches: no box.
- After a Horizons track the gold box steps aside; the tracker draws its own named box (`tracking.js`), so only one box shows.
- A newly opened Vesta patch starts on the first frame with a marker instead of frame 1.
- Known limit, marked `shortcut:` in the code: the proper-motion offset is a flat-sky approximation, exact to well under a pixel near the field centre.

### Vesta "disappears after 2 frames" (`app.js`, in `paint`)

Not a bug in the box. The Vesta view is a fixed patch of sky; Vesta crosses it in under a day, so it is in only 2 of the 58 D3 frames (2025-08-04 and 2025-08-05). Frames without Vesta now say "Vesta is not in this frame. It crosses this patch on 2025-08-04 and 2025-08-05". A band with no such frame (D4) says "No frame in this band shows it. Try D3 or D6."

### Tracker stuck on "Preparing star tracking" (`server.py`: `trim_cache`, `create_track`)

Root cause: `trim_cache` keeps the cache near 2 GB (`SPHEREX_CACHE_GB`). Loading R Draconis (about 1,050 frames over D3 and D4) pushed it over, and the trim deleted the FITS cutouts of views still in use. It protected only the open view's folder, not the cutouts that view reads. Measured before the fix: the Vesta D4 view had 51 of 51 FITS missing, Barnard D5 58 of 58. `create_track` then re-fetched every frame from IRSA before tracking, with no status message.

Fix:
- `trim_cache` also keeps every cutout listed in the open view's `manifest.json`.
- `create_track` counts evicted files and reports "Downloading observation N of M again from the NASA archive".

Checked on a test server (port 8766): first track of Vesta D4 showed the counter and finished in 46 s; afterwards 0 of 51 files were missing although the cache was still at 2.3 GB; a second track took 2 s; no console errors.

## Running it

The server on port 8765 was restarted from `worktrees/branch1/outputs/spherex-prototype` (process 35696 at the time of writing), log in `work/server-8765.log`. It was started from a Claude session and may stop when that session ends. Restart from Git Bash:

```bash
cd outputs/spherex-prototype
export PYTHONPATH="$(cygpath -w "$(pwd)/../../../fable/work/deps")"
../../../fable/work/venv/Scripts/python.exe -X utf8 server.py --port 8765
```

End the old process and confirm nothing listens on 8765 first; Windows lets two servers bind the same port. Raise `?v=` in `index.html` when a JS or CSS file changes.

## Quick test

1. Open Vesta, D3, 15′. It opens on frame 18 (2025-08-04) with a gold box labelled "Vesta" on the bright source.
2. Step to frame 26. The image says Vesta is not in this frame and names the two dates.
3. Press **Track point** with `Vesta` in the object box. The box becomes "4 Vesta (A807 FA)" with an offset of about 0.9″.
4. Open Barnard's Star, Epsilon Indi B, RW Aurigae. Each has a gold named box on its star on every frame.
5. Open a view not loaded for a while and track. The status counts re-downloads instead of sitting on "Preparing".

## Not done or not checked

1. Nothing tracked on the restarted 8765 server; the tracking fix was tested on the 8766 copy.
2. R Draconis: its views never finished loading in the headless browser, and tracking 500+ frames was not tried.
3. "Try D3 or D6": D6 is taken from the earlier handoff, not seen in this app.
4. The target box was checked on D3 at 15′ only. Other detectors and widths are untested.
5. WISE 0855 is boxed at its expected position but is not visible in these images; the legend's "not measured" is the only cue.
6. Evicted views of other targets still need one slow re-download on their first track. The cache cap is unchanged at 2 GB.
7. Star tracking after `cea2773` was not re-run (the Barnard's Star track worked after `cd0b7d3`, 55 of 55 measured).

## Next steps, in order

1. Push `branch1` when the user approves.
2. Track once on the restarted server to confirm the fix in place.
3. Decide whether R Draconis should stay a saved target: at about 520 frames per band it fills the cache by itself.
4. Check the box on another detector and width.
