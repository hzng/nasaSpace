# Handoff: frame cap, periodic comets, click labels

Written 2026-11-14. Branch `branch1`, worktree `worktrees/branch1`. App: `outputs/spherex-prototype/`.
Follows `handoff/clickIdentify.md`, which follows `handoff/trackingFix.md`. Both still apply.

## What this work is for

The demo must stay quick and clear: one saved target must not fill the cache, a comet a judge clicks must track, and the screen must not show stale or doubled labels.

## State of the branch

| Commit | Pushed | What |
|---|---|---|
| `76ed756` | yes (2026-11-13, approved by the user) | Click-to-name, no path on frames without the object |
| `b2b836c` | **no** | 120-frame cap, periodic comets, click label, side panel band |

`branch1` is 1 commit ahead of `origin/branch1`. The user has not approved pushing `b2b836c`. The three handoff files in `handoff/` are not committed.

## What changed and why

The user asked for items 1 to 5 of `clickIdentify.md`.

### 1. Push

`76ed756` pushed to `origin/branch1`.

### 2. Off-screen path

Nothing changed. The user's screenshot never reached a session, so it is still not compared. Ask the user to look at a Vesta track on frame 26.

### 3. Click-to-name on comets and unnumbered asteroids (`ephemeris.py`)

Tested against the live catalogs (SkyBoT at a known position, then `ephemeris.fetch` with the name it returned), not on a SPHEREx frame that contains a comet:

| Object | SkyBoT name | Horizons |
|---|---|---|
| `2017 ON155` (unnumbered asteroid) | `2017 ON155`, 0.002″ | works |
| `C/2020 P1` (non-periodic comet) | `C/2020 P1`, 0.002″ | works, "NEOWISE (C/2020 P1)" |
| `29P` (periodic comet) | `29P`, 0.41″ | **failed before the fix**: "matches several objects" |
| `12P` (periodic comet) | not found at its Horizons position | not reached |

Fix: `_fetch` rewrites `NNP` or `NNP/Name` to `DES=NNP;CAP;NOFRAG`. CAP picks the return nearest today, and NOFRAG drops fragments. The self-check (`python ephemeris.py`) now also checks `29P` and `29P/Schwassmann-Wachmann 1`, and it passes. The README limit line says this.

Side finding: SkyBoT omits the `Num` key for unnumbered objects. `row.get('Num')` already handles that.

### 4. R Draconis: cap at 120 frames (`server.py`, `app.js`)

Asked with a Pane card. The user chose "Cap at 120 frames" over dropping the target or keeping it as is.

- `create_session`: after deduplication, a view with more than `MAX_FRAMES = 120` frames keeps 120, evenly spaced in time, first and last included. This runs before the cutouts are fetched, so the dropped frames are never downloaded.
- The manifest has `limited` (this flag existed but was always false) and a new field, `matched_frames`. The status bar adds "· evenly spaced from N".
- Only R Draconis reaches the cap (D1 584, D3 575, D4 581, D6 565). The next largest saved view is Epsilon Indi B D3 with 97. Custom patches near the ecliptic poles are capped too.
- The README "Scientific scope & limits" section describes the cap.

### 5. Loose ends

- **Doubled name** (`tracking.js` `paint`): the blue click name is not drawn when the click is within ±21 px of the gold target box, because the box already names the target.
- **Previous band in the side panel** (`app.js` `search`): `metadata` and `quality-card` are cleared when a load starts. Before, they kept the previous frame's "Band D5" while a D6 view loaded.
- **gstack upgrade**: `./setup --refresh-registered` finished (v1.99.3.0). Playwright Chromium 1254 is now installed. `/cso` reports itself unavailable until the Visual Studio 2022 C++ Build Tools are installed.

`index.html`: `app.js?v=16`, `tracking.js?v=11`.

## Checked

| Check | Result |
|---|---|
| `python ephemeris.py` | "ephemeris self-check OK", including 29P |
| R Draconis D2, 5′, through the API | 72 frames of 89 matches, `limited=False`, 814 s (all files re-downloaded) |
| R Draconis D3, 5′, through the API | 118 frames, `matched_frames=574`, `limited=True`, 2025-04-24 to 2026-06-12, 351 s cold |
| Barnard's Star D5, 30′, click on the star | "Barnard's star · star, SIMBAD, 1.4″"; only the gold label drawn |
| Same view, click a star outside the box | "ASAS J175719+0445.6", blue label drawn |
| Band D5 → D6 | Side panel empty while loading, then "D6 · DR1" |
| Console errors | none |

The browser checks used gstack's headless browser (`$B`) on port 8765. The clicks ran the same code as the canvas `pointerup` handler (`state.point = …; inspect(…)`), not a real pointer event. To list the labels drawn, `window.markLabel` was wrapped in the page.

## Running it

The 8765 server was restarted by this session at about 23:42 on 2026-11-13, with `nohup` from `worktrees/branch1/outputs/spherex-prototype`, logging to `work/server-8765.log`:

```bash
cd outputs/spherex-prototype
export PYTHONPATH="$(cygpath -w "$(pwd)/../../../fable/work/deps")"
nohup ../../../fable/work/venv/Scripts/python.exe -X utf8 server.py --port 8765 >> ../../work/server-8765.log 2>&1 &
```

Kill the old process tree first (`taskkill //PID <parent pid> //T //F`) and confirm nothing listens on 8765. Windows lets two servers bind the same port.

Headless browser: `export PATH="$HOME/.bun/bin:$PATH"; B=~/.claude/skills/gstack/browse/dist/browse`. Aside does not run on Windows.

Many cached FITS were evicted, so the first load of a view can take minutes while it re-downloads from IRSA (Barnard D6: 58 files). Warm the demo views before presenting.

## Not done or not checked

1. `b2b836c` is not pushed.
2. The off-screen path has still not been compared with the user's screenshot.
3. Pressing **Track point** on a comet in the app was not tried. Only naming and the Horizons lookup were tested.
4. 12P/Pons-Brooks: SkyBoT did not return it at its Horizons position, so clicking it gives no name. Not investigated.
5. A comet that SkyBoT names in another form (for example `P/2010 A2`, or a comet with a fragment letter) is sent to Horizons unchanged and may fail.
6. CAP picks the return nearest today. For a comet whose SPHEREx-era return is not the latest one, type its Horizons record number.
7. **Search IRSA** (`source == 'archive'`) downloads every match before the cap applies. Only saved views are protected.
8. Old uncapped R Draconis views may still sit in the cache. The trim removes them in time.
9. The worktree is `worktrees/branch1`. The `tracking-star` worktree has none of this work.

## Next steps, in order

1. Push `branch1` when the user approves.
2. Have the user confirm the off-screen behaviour against their screenshot.
3. Warm the cache for the demo views (Vesta D3 15′, Barnard's Star, Epsilon Indi B, R Draconis D3) so no view re-downloads during the demo.
4. If comets matter for the demo, track one in the app end to end.
