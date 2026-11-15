# Handoff: click-to-name, off-screen track, target box fixes

Written 2026-11-13. Branch `branch1`, worktree `worktrees/branch1`. App: `outputs/spherex-prototype/`.
Follows `handoff/trackingFix.md`, which still applies.

## What this work is for

A judge clicks a source and sees at once what it is, and the motion tracker never draws a path across a frame the object is not in.

## State of the branch

| Commit | Pushed | What |
|---|---|---|
| `c612ca0` | yes | **Load patch** no longer turns a saved target into an unnamed "Sky patch", so the gold box stays at any width or band |
| `76ed756` | **no** | Click-to-name, off-screen frames show no path, Vesta opens on a frame that shows it |

`branch1` is 1 commit ahead of `origin/branch1`. The user has not approved pushing `76ed756`. This file and `handoff/trackingFix.md` are not committed.

## What changed and why

### Requests from the user (2026-11-13)

1. When the object is off the screen, the predicted path must disappear as well.
2. Did the object really leave the screen, or is recognition broken?
3. Clicking an object should recognise it and fill the motion tracker with its name.
4. Explain how a pixel is judged to be the target.

The user's two screenshots did not reach the session. The work was done from their words and tested on Vesta and Barnard's Star.

### 1. No path on frames without the object (`tracking.js`)

- `inView(p)`: measured on that frame, or predicted inside the image. The server keeps predictions up to 16 px outside the image, so `predicted` alone is not enough.
- `offView(index)`: true only for tracks that have predictions (Horizons, Gaia, 2nd pick). A blind track has no prediction, so an unmeasured frame there still shows the old "Not measured in this frame" note.
- On an off-view frame, `paint` draws no trajectory, prediction or dots. It writes "<object> is not in this frame" and the dates the object is on the image. `kinds()` returns `{offscreen:true}` so the legend is empty but `app.js` still knows a track exists. `pick()` ignores path dots there.

### 2. Vesta really leaves the image

Measured with a Horizons track of Vesta, D3, 15′ (58 frames): 2 frames measured (0.9″ and 2.2″ from JPL), 56 with the JPL position outside the image. The nearest of those is 21′ away; the image reaches 7.5′ from centre. Most are more than 6° away. JPL positions do not come from the image, so this is not a recognition fault.

### 3. Click-to-name (`tracking.py` `name_source`, `server.py` `/api/identify`, `tracking.js` `identify`)

- `GET /api/identify?session&frame&x&y` shares the frame-file lookup with `/api/pixel`.
- `name_source` centroids the click with the tracker's own `centroid` (`search_px=3`, wing fallback). It then asks two catalogs in parallel at the frame's `MJD-AVG`:
  - IMCCE SkyBoT cone search, geocentric (`-loc=500`), for asteroids and comets. About 4 to 8 s. JPL `sb_ident` gave the same answer but took about 70 s, so it is not used.
  - SIMBAD TAP on `simbad.harvard.edu` (the CDS host returned 404). J2000 positions are moved by proper motion to the frame date. The query takes a 0.01° circle plus fast movers (above 300 mas/yr) within 0.1°. Planets (`otype` starting `Pl`) are skipped because they share their star's position.
- The match is the nearest object within 6.15″ (one SPHEREx pixel) of the centroid, or 12.3″ when the click cannot be centroided. If one catalog fails, the other still answers, and the failure is listed in `unavailable`.
- Answers are cached in `work/prototype-cache/identify/`.
- Client: the name fills the Object box and is drawn in blue next to the click, on the frame that was clicked only. On **Track point**, an asteroid's or comet's name is sent to Horizons as its record number (`4;`). A star's name is not sent, because Horizons has no stars, so the star is tracked from the image and Gaia. Text the user types in the box always wins. Stepping frames does not ask the catalogs again.
- The box label is now "Object (named from your click; asteroids and comets use JPL Horizons)". The Method & limits text and the README describe the rule.

### 4. How a pixel is judged to be the target (answered in chat)

It is not recognised. The tracker predicts where the object should be (Horizons, Gaia proper motion, a 2-click line, or the last measured position and speed). It takes the brightest clean pixel near that position, if it is more than 3σ above background, and fits a 2D Gaussian. The fit is accepted only if S/N ≥ 5, χ² ≤ 10, width ≤ 2.45 px and the centre is not at the search edge. A saturated core uses a wing fit. Horizons tracks flag frames that are more than max(3σ, 3.1″) off. A brighter neighbour near the prediction could be measured instead; the Horizons flag is what catches that.

### Bugs found and fixed on the way

- `app.js` `search-form` submit (`c612ca0`): pressing **Load patch** reset every view to "Sky patch". Editing RA or Dec already does that, so the reset was removed.
- `app.js` `sessionReady` (`76ed756`): it read the previous view's options after replacing them, so "same patch" was always true. A Vesta view opened after another target landed on a frame without Vesta. It now reads them first. Changing the band or width of the same patch keeps the time, choosing among Vesta's marked frames.

## Checked (headless browser on port 8765, after a server restart)

| Check | Result |
|---|---|
| Horizons track of Vesta, D3, 15′ | "4 Vesta (A807 FA)", Δ 0.9″, 2 s (files cached) |
| Barnard's Star at D5, 30′ after **Load patch** | Gold box on the star |
| Epsilon Indi B at D2, 5′ | Gold box on the star, off the field centre |
| RA edited, then **Load patch** | "Sky patch", no box (unchanged behaviour) |
| Click Barnard's Star | "Barnard's star · star, SIMBAD, 1.4″"; tracked with Gaia, 44/44, 10.46″/yr |
| Click Vesta on 2025-08-04 | "4 Vesta · IMCCE SkyBoT, 0.5″"; Horizons track "4 Vesta (A807 FA)" |
| Click the same pixel on frame 26 | No catalogued object (Vesta has moved on) |
| Frame 26 after a Vesta track | No path; note names the 2 dates |
| Barnard's Star, then Vesta | Opens on frame 18; stays on a Vesta frame at 10′ |

No console errors in any check.

## Running it

The 8765 server was restarted by this session at about 22:40, with `nohup` from `worktrees/branch1/outputs/spherex-prototype`, the same way as before. It logs to `work/server-8765.log`. Restart:

```bash
cd outputs/spherex-prototype
nohup ../../../fable/work/venv/Scripts/python.exe -X utf8 server.py --port 8765 >> ../../work/server-8765.log 2>&1 &
```

Kill the old process tree first (`taskkill //PID <nohup pid> //T //F`) and confirm nothing listens on 8765. A Python change needs a restart. A JS or CSS change needs `?v=` raised in `index.html` (now `app.js?v=15`, `tracking.js?v=10`).

A second server on port 8767 (started 22:33, not by this session) is also running. Its worktree is unknown.

## Not done or not checked

1. `76ed756` is not pushed.
2. Not tested: comets, unnumbered asteroids (sent to Horizons by name), and stars SIMBAD does not list.
3. SkyBoT positions are geocentric. SPHEREx parallax is about 1″ for main-belt asteroids but can be arcminutes for near-Earth objects, so a near-Earth object may not match within 6.15″.
4. When the click is a saved target, the blue name and the gold box name both show, for example "Barnard's star" and "Barnard's Star".
5. The panel's side info can show the previous frame's band while a new view loads (seen once on Barnard's Star D5). Not investigated.
6. The gstack upgrade is half done: the code is at v1.99.3.0, but `./setup --refresh-registered` was stopped for low memory. bun is in `~/.bun/bin` but not on PATH. Finish with `export PATH="$HOME/.bun/bin:$PATH"; cd ~/.claude/skills/gstack && ./setup --refresh-registered`.
7. Carried from `trackingFix.md`: whether R Draconis (about 520 frames per band) stays a saved target is still the user's decision.

## Next steps, in order

1. Push `branch1` when the user approves.
2. Have the user confirm the off-screen behaviour against their screenshot, since it was not seen.
3. Test click-to-name on a comet or an unnumbered asteroid.
4. Decide on R Draconis.
