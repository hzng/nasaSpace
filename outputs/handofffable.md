# SPHEREx handoff: `fable` branch, November 13, 2026

This file records where the work on the `fable` branch stands, so that a person or agent with no memory of the session can continue it. It follows on from `outputs/SPHEREx-handoff-2026-11-11.md`, which describes the project's goal and science rules and still applies. Where the two disagree, this file is newer.

Everything marked "checked" was exercised on the running app. Everything else is listed under "Not verified".

## The goal in one paragraph

A web app for the NASA SPHEREx challenge (a hackathon submission) that lets anyone inspect real archived SPHEREx observations: pick a sky position, play aligned frames over time, track a moving or fixed source, and measure its brightness against wavelength. Real dates, source files and quality warnings matter more than decoration.

## Where things are

| What | Where |
| --- | --- |
| Worktree | `C:\Users\Nael\Documents\GitHub\nasaSpace\worktrees\fable` (branch `fable`) |
| App | `outputs/spherex-prototype/` |
| Six bundled example fields | `outputs/spherex-viewer/data/` (22 FITS files, 191 MB) |
| Local cache and Python environment | `work/` (ignored by git) |
| Running log of tasks and evidence | `outputs/orchestrator-plan.md` |
| Earlier handoff | `outputs/SPHEREx-handoff-2026-11-11.md` |

The app is plain HTML, CSS and JavaScript served by `server.py` (Python standard-library HTTP server). There is no build step.

## How to run it on this machine

- Use `work/venv/Scripts/python.exe -X utf8`. The system `python` is 3.15, which has no PyYAML wheel, so it cannot run the app. The environment was made with `uv venv --python 3.14 work/venv`; packages are in `work/deps`.
- Start: `outputs/spherex-prototype/Launch SPHEREx.cmd`, or `start.ps1`, then open `http://127.0.0.1:8765/`. Both launchers were edited to use the venv but **have not been run since that edit**.
- Refresh the observation index: `Update featured data.cmd` (runs `sync_featured.py`).
- Supabase credentials live in Pane secrets, project `spherex`, as `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Run a command with them through `runpane secrets exec --project spherex -- <command>`. No `.env` file exists; `.env.example` shows the two names.
- Git Bash rewrites arguments that start with `/`. Set `MSYS2_ARG_CONV_EXCL='*'` when that matters, and unset it for `taskkill //PID`.
- Windows lets two servers bind the same port. Before a restart, end the old process and confirm nothing is listening on 8765.

## What is running right now

Checked on November 13 at the time of writing:

- **Updated November 13, later:** `fable` was merged into local `branch1` (`4bc0126`, not pushed), and the hosted server now runs that merge from `worktrees/branch1`. `worktrees/branch1/work` is a junction to `worktrees/fable/work`: remove it with `cmd /c rmdir` before deleting that worktree, or the cache and Python environment go with it.
- Local server on port 8765, listening process 26268 (launcher 22000), started from `worktrees/branch1` with `SPHEREX_PUBLIC=1` and no Supabase credentials (it uses the local copy of the index). The earlier `fable` server log is `work/host-server.fable.log`.
- Cloudflare quick tunnel, process 45444, at `https://riding-fundamental-arg-friendship.trycloudflare.com`. It returned 200.
- Logs: `work/host-server.log`, `work/host-tunnel.log`.

This link is temporary. It changes if the tunnel restarts and dies if the machine sleeps. Anyone who holds it can make this machine download cutouts from NASA, so remove the link from this file before pushing to a public repository if the tunnel is still up. Public mode blocks file import (403), never serves dotfiles, and checks the request origin.

The user was promised that the hosted server would not be restarted again without telling them first.

## What changed on this branch

### 1. Storage: small local cache, index in Supabase

The user asked to keep only the six examples locally and store the rest remotely. The free Supabase tier holds the index only, not the image files, and the full dataset from the other machine no longer exists.

- `remote_store.py` (new): `enabled()`, `pull(name, dest)`, `push(path, name)` against the private bucket `spherex`. It strips whitespace from the key.
- `sync_featured.py` (rewritten): six IRSA TAP footprint queries, no downloads. It writes `work/prototype-cache/featured-library.json` and `sync-status.json`, then uploads the index. Result: 4,256 observations in 3.6 MB (Vesta 351, Barnard's Star 358, Epsilon Indi 461, WISE 0855 258, RW Aurigae 335, R Draconis 2,493).
- `server.py`: pulls the index at start, then fetches view-sized cutouts on demand (`fetch_cutouts()`, six in parallel). `trim_cache()` holds the cache near `SPHEREX_CACHE_GB` (default 2) by deleting cutouts first and older views next; the newest view, imports, the index, spectra and calibrations are always kept. The cache measured 2.3 GB when this file was written.
- **DR1 is now public.** The earlier handoff said it was not. IRSA now returns `dr1` paths: 2,941 of the 4,256 observations are DR1 and 1,315 are QR3. `archive.py` accepts both release patterns and `archive-config.json` lists `spherex_dr1` first.

Checked: an upload and download through Supabase gave an identical file hash; the app starts from the local index when Supabase is unreachable; a Vesta 10-arcminute view fetched 60 cutouts in 72 to 155 seconds and reopened in 2 seconds; a 0.1 GB cap trimmed the cache to 97 MB without breaking the open view; an off-center position worked.

### 2. Marks, legend and the predicted path

- Five distinct marks on the image: ivory center cross, blue open crosshair, gold "Guide" circle, green or cyan measured position, dashed violet prediction. A legend sits under the image.
- A dashed violet predicted path with one ring per frame. Clicking a ring opens a card with the time, the basis of the prediction, predicted coordinates, measured minus predicted, and uncertainty.
- Frame chips show UTC time, loading shows a progress bar, and stepping between frames no longer wipes a track.

### 3. Image-first redesign of the Sky screen

The user judged an earlier detail pass invisible and chose this direction from three options.

- One slim toolbar. The six targets are in a switcher menu.
- The sky image is the main element: 670 px tall on a 1440 by 900 screen, up from about 495 px. View controls float over its top-right corner; playback floats over the bottom with a "Frame N / total" counter.
- One side panel, 420 px wide, holds the Vesta note, the Observation and Pixel tabs, and the motion tracker.
- The spectrum sits full width under the frame strip, because its axis text was unreadable inside the side panel.
- Below 1121 px the page is one column, with controls above the image and playback below it.

Checked on the live page, with no console errors: the switcher lists six targets and loads Barnard's Star (55 frames); play, next and the counter work; clicking a pixel opens the Pixel tab; Compare shows two panes and returns to Single; tracking and the path card fit the side panel; 3D Map hides the Sky layout and "Inspect sky" returns with the galaxy's coordinates; a spectrum drew 114 points.

Current asset versions in `index.html`: `app.css?v=9`, `app.js?v=6`, `tracking.js?v=6`. Raise the number when a file changes, or browsers will keep the old copy.

## Known problems

1. **"Measure light" rejects DR1 observations.** Calibration exists for QR2 and QR3 only, so `spectroscopy.py` refuses DR1 with "No validated science calibration adapter for this release". That is 2,941 of 4,256 observations, and it is the largest functional gap. On the default Vesta frame, a ±7-day spectrum returned 0 points; "All dates" returned points.
2. The toolbar wraps to a second row at about 1280 px wide, and with long target names.
3. On phones the width and band arrow buttons are 38 px tall (the target is 40 px), and the tracker's "Clear" button wraps to its own line.
4. For stars, the predicted path is about one pixel long over the data span, so it looks like a cluster unless zoomed in.

## Not verified

- Hover and press animations in motion. The headless browser takes still pictures, so only the computed values were read.
- Firefox and Safari.
- 60-arcminute views and the dense R Draconis field under the on-demand fetch.
- The violet "Predicted" circle was never seen on the live page.
- Supabase access from a second machine.
- Tablet and phone flows were run by the build pass only. The orchestrator read the phone screenshot and did not repeat the flows.
- The earlier handoff's milestone 1, "Make track point work", was not audited against its own wording, although tracking ran correctly in the checks above.

## Git state

Checked when this file was written. The working tree was clean before this file was added.

```
4683c0c  Squashed commits from tracking-star   <- local fable; holds the image-first redesign
6eb2cb2  Squashed commits from fable           <- local only
35d9288  SPHEREx Observation Lab: ...          <- main
```

- `origin/fable` is at `19e20f7 "Ui redesign"`. Local `fable` is 2 commits ahead and 1 behind it.
- `19e20f7` and `6eb2cb2` hold identical content (their diff is empty). They are two copies of one commit, so a plain push is rejected.
- `4683c0c` is titled "Squashed commits from tracking-star", but it contains the redesign: `app.css`, `app.js`, `index.html`, the plan, and the deletion of two preview files. It does not contain the `tracking-star` branch's work.
- The `tracking-star` branch (`9595e24`) is someone else's tracking work. It differs from `fable` in 19 files and has not been merged.
- This file and a one-line correction in `outputs/orchestrator-plan.md` are uncommitted.

To publish `fable`, the owner must choose one: force-push local `fable` over `origin/fable` (safe for content, because the remote commit's content is already in the local history), or rebase the redesign commit onto `19e20f7`. Neither has been done.

## Standing rules from the user

- Do not commit, push, deploy or contact anyone without asking first.
- Secrets go through environment variables only. Never print their values. Ask for a key with Pane's secret request, never in chat.
- Do not add or run tests unless asked.
- Do not add scope the handoff does not ask for. Flag it and defer it.
- Never report a feature as working without checking it.
- Use the gstack `/browse` skill for web browsing, never the `mcp__claude-in-chrome__*` tools. An earlier attempt to test localhost through computer use was denied; do not work around that.
- Update `outputs/orchestrator-plan.md` as tasks finish, with status, evidence and blockers.
- The Supabase key appeared once in a local error message during setup. The user was told to rotate it if that transcript is ever shared.

## What to do next, in order

1. **Decide the git question above**, then push if the user wants the branch published.
2. **DR1 calibration for "Measure light".** Find whether IRSA publishes DR1 calibration products, and add an adapter in `calibrations.py` and `spectroscopy.py` only if they can be validated. Until then the rejection message is the honest behavior.
3. **Bring the documents up to date.** `README.md` does not describe the redesigned layout, and its "currently public releases" line and `VERIFICATION_REPORT.md` predate DR1.
4. **Permanent hosting**, if the submission needs a link that survives a reboot. It needs a host that runs Python, an account, and a pushed branch, so it needs the user's approval.
5. Fix the three small layout problems listed under "Known problems".
6. Work through the "Not verified" list, starting with the launchers and a 60-arcminute view, because a judge is most likely to hit those.
