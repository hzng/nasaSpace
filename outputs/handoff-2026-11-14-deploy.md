# Handoff: commit, branch1 merge and deploy (fable)

Written 2026-11-14 for a person or agent with no memory of the session. It follows `outputs/handoff-2026-11-14.md` (redesign, tracker verdict, critique and audit fixes). That file still describes what the interface does; this one is newer on repo and server state. Task log: `outputs/orchestrator-plan.md`. Teammate setup: `startguide.md`.

## State in one paragraph

All work is committed on `fable` (last commit `874f3f3`), and `branch1` was fast-forwarded to the same commit. Nothing is pushed. The deploy worked: the public link served the new interface. **But the public site is now down.** When this file was written, nothing listened on 8765 or 8767, `cloudflared` was not running, and `https://riding-fundamental-arg-friendship.trycloudflare.com` no longer resolved. The server and tunnel had been started from a Claude Code session that has since ended. Restarting them needs the user's approval, and a new quick tunnel gets a **new URL**.

## What happened this session

### 1. Cleanup from the previous handoff

- **Stray screenshots:** deleted `legend-1440.png` and `tracker-1440.png` from the repo root.
- **README palette:** `outputs/spherex-prototype/README.md` now describes the blue accent `#0071e3` (fills and icons only) and the D1–D6 band colour scale.
- **README demo limits:** two new entries under "Scientific scope & limits":
  - Measure light on Vesta lands on empty sky.
  - The first track with an empty frame cache can take more than 25 minutes.
- **Clear wrapping at 375 px:** `.tracking-actions` is a 2 × 2 grid at 620 px and narrower (`css/responsive.css`). This was checked in a screenshot of a 375 px iframe.

### 2. Commits on `fable`

| Commit | What |
|---|---|
| `d599251` | Everything from the previous handoff, plus the cleanup above |
| `26f6571` | Merge of branch1's `cea2773`, `c612ca0` and `76ed756`: click-to-name (SkyBoT and SIMBAD through `/api/identify`), no track path on frames without the object, cache fixes |
| `874f3f3` | Merge of branch1's `b2b836c`: 120-frame cap per view, periodic comets for Horizons, label placement |

`b2b836c` was committed by the session working in branch1, minutes before the merge.

### 3. Merge decisions

- **`index.html` versions:** kept fable's numbers and bumped the two merged scripts: `app.js` v=17 and `tracking.js` v=16.
- **Object label:** branch1's text ("Object (named from your click; asteroids and comets use JPL Horizons)"), with fable's `aria-describedby="track-object-note"`.
- **`tracking.js` header:** fable's `PRED` (`#b9a3f5` = `--predict`), announcer and busy state, plus branch1's `identity`, `idSeq` and `idText`.
- **New helper `toJPL()`:** returns the name that would go to Horizons. A clicked star's name returns ''. Both the Track point handler and the object note use it.
  - The note "Tracks X at its JPL-predicted position…" now shows only when the name really goes to Horizons.
  - `identify()` calls `noteObject()` after it fills the box.

### 4. Deploy

1. Fast-forwarded `worktrees/branch1` to `874f3f3`.
2. Stopped the old 8765 process. It had been started by another session **without `SPHEREX_PUBLIC=1` and without `SPHEREX_CACHE_GB`**, so:
   - the public link accepted file imports;
   - the default 2 GB limit, with 3.3 GB already in the shared cache, kept evicting the demo frames. This is why the Vesta frames vanished about an hour after they were warmed.
3. Restarted 8765 from branch1 with `SPHEREX_PUBLIC=1 SPHEREX_CACHE_GB=50`. The disk had 421 GB free.

## What was checked, and how

- **Before each merge commit (8767):** the dev server was restarted with the merged `server.py`. Then:
  - Edge headless loaded the page with no console errors: Frame 18 / 58, Vesta boxed and named.
  - A Vesta track run through the API completed.
- **Through the tunnel after the deploy:**
  - All 17 assets returned 200, with `tokens.css?v=16`, `app.js?v=17` and `tracking.js?v=16` served.
  - The page rendered Frame 18 / 58.
  - `/api/import` returned "File import is turned off on the shared link."
- **Cache:** the 58 Vesta D3 frames were downloaded again at 00:08 on 2026-11-14. With the 50 GB limit they should stay, but this was not rechecked after the servers stopped.
- **Syntax:** `node --check` on `app.js` and `tracking.js`, and `ast.parse` on `server.py` and `ephemeris.py`.

Not checked:
- A track started by clicking in the browser (only through the API).
- Click-to-name and the object note in the browser after the merge.
- The 2 × 2 tracker grid between 375 and 620 px.
- Comets and the 120-frame cap. branch1's own handoff says they are untested.

## How to run and deploy

- **Python:** `work/venv/Scripts/python.exe -X utf8` in the `fable` worktree. `branch1/work` is a junction to `fable/work`; remove it only with `cmd /c rmdir`.
- **Dev server** (from `fable/outputs/spherex-prototype`): `SPHEREX_CACHE_GB=50 ../../work/venv/Scripts/python.exe -X utf8 server.py --port 8767`.
- **Public server** (from `branch1/outputs/spherex-prototype`, only after the user approves):
  ```bash
  export PYTHONPATH="$(cygpath -w "$(pwd)/../../../fable/work/deps")"
  SPHEREX_PUBLIC=1 SPHEREX_CACHE_GB=50 nohup ../../../fable/work/venv/Scripts/python.exe -X utf8 server.py --port 8765 >> ../../work/server-8765.log 2>&1 &
  ```
  Never start it without both flags.
- **Tunnel:** `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8765 > work/host-tunnel.log 2>&1 &`, then read the new `https://….trycloudflare.com` URL from the log. The old URL will not come back.
- **Starting both from a Claude session:** they die when the session ends. To keep them up, the user should start them from their own terminal, or they should be started detached in a way that outlives the session. Neither has been set up.
- **Before any deploy:**
  - Run `git status` and `git log` in `branch1`; other sessions commit there.
  - Confirm nothing is listening on the port before starting a server, because Windows lets two processes bind the same port.
- **After a deploy, check through the public URL:**
  - every asset returns 200;
  - Frame 18 / 58 appears;
  - `/api/import` returns 403.
- **Warming the cache without a browser:**
  1. POST `/api/jobs` with `{ra, dec, fov: "15", detector: "3", start: "", end: "", source: "saved"}`, using Vesta's `ra` and `dec` from `/api/library`.
  2. Poll `/api/jobs/<id>`.
  3. POST `/api/track` with `{session, frame: 0, object: "Vesta"}`.

  The script used this session is `warm_vesta.py` in the session scratchpad. It is not in the repo, so rewrite it from these steps if needed.

## Known issues

1. **Public site down.** See the state paragraph. Restarting needs approval and gives a new URL, which has to be re-shared.
2. **gstack browse is broken** since the gstack update of 2026-11-13. It wants Playwright `chromium_headless_shell-1254`, and only 1234 is installed.
   - Workaround used: Edge headless (`msedge.exe --headless=new --screenshot --virtual-time-budget=…`). For a phone width, put the page in a 375 px iframe.
   - Likely fix: `npx playwright install chromium-headless-shell`. This downloads a browser and has not been run.
3. **Several sessions share branch1 and the 8765 server.** One restarted 8765 without the public flags. The flags are now in this file and in the user's memory notes.
4. **Untracked handoffs in branch1.** `handoff/clickIdentify.md` and `handoff/trackingFix.md` belong to the branch1 session and were left alone.
5. **`outputs/orchestrator-plan.md` is not committed.** It holds the entry for this deploy.
6. **Still open from earlier critiques:**
   - Echo the verdict on the image.
   - Plain-language labels ("Load patch", "Pick 2nd", "Full FOV", "z").
   - Consistent DR1/QR3 vs D1–D6 naming.
   - Chart code reading token colours.
   - Stop sideways swipes from panning at zoom 1.

## Standing rules from the user

- Do not commit, push, deploy or restart the public server without asking first. An approval does not carry over to the next action.
- Do not change data, tracking, ephemeris or science logic. Keep every feature.
- No new heavy dependencies, no build step.
- Do not claim something looks or works right unless it was checked in a screenshot or by running it.
- Do not add or run tests unless asked.
- Update `outputs/orchestrator-plan.md` as tasks finish.
- Never share or print `SUPABASE_SERVICE_KEY`.

## Suggested next step

1. Ask the user to approve restarting 8765 (with both flags) and the tunnel, then share the new URL.
2. Warm the Vesta cache, then check a track started from a click in the browser and click-to-name on a star.
3. Commit `outputs/orchestrator-plan.md` and this file.
4. Then `/impeccable clarify` for plain-language labels, and re-run `/impeccable critique`.
