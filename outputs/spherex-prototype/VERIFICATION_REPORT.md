# SPHEREx Observation Lab — Verification Report

**Report date:** November 11, 2026 (`2026-11-11` PST)  
**Deliverable:** `outputs/spherex-prototype/`  
**Local service URL:** `http://127.0.0.1:8765/`

---

## 1. Archive Release Status (Verified Live November 11, 2026)

| Endpoint / Prefix | Observed Status | Details |
| --- | --- | --- |
| `https://irsa.ipac.caltech.edu/Missions/spherex.html` | HTTP `200` | Active releases listed: **QR2** (Oct 2025; headers updated Apr 10, 2026) and **QR3** (Sept 2026) |
| `https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html` | HTTP `200` | DOIs: **QR2** `10.26131/IRSA652`, **QR3** `10.26131/IRSA662`; **QR1** retired Feb 2026 |
| `https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html` | HTTP `404` | DR1 documentation not published at check time |
| `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/?list-type=2&delimiter=/&prefix=` | HTTP `200` | Public S3 prefixes: `qr2/` and `qr3/` only (no `dr1/` prefix) |
| `https://spherex.caltech.edu/page/data-products` | HTTP `200` | Documents planned SPHEREx delivery cadence; scheduled releases are not treated as public until verified at IRSA |

---

## 2. Verified Data & Cache Inventory (`work/prototype-cache/` & `catalogs/`)

### Featured SPHEREx Cutouts (`sync-status.json`)
- **Total archive records checked & cached:** `4,227 / 4,227` (`0` failures; `status: "complete"`)
- **Per-field observation counts** (sky areas centered on target coordinates; not confirmed detections in every exposure):
  - **Vesta:** `349` (`D1: 56, D2: 58, D3: 62, D4: 56, D5: 56, D6: 61`)
  - **Barnard’s Star:** `359` (`D1: 60, D2: 61, D3: 59, D4: 59, D5: 61, D6: 59`)
  - **Epsilon Indi B:** `447` (`D1: 43, D2: 92, D3: 97, D4: 43, D5: 80, D6: 92`)
  - **WISE 0855:** `256` (`D1: 36, D2: 48, D3: 45, D4: 36, D5: 48, D6: 43`)
  - **RW Aurigae:** `333` (`D1: 56, D2: 55, D3: 56, D4: 56, D5: 56, D6: 54`)
  - **R Draconis:** `2,483` (`D1: 584, D2: 89, D3: 575, D4: 581, D5: 89, D6: 565`)

### Science Calibrations (`calibrations.py`)
- **Cached products:** `30 / 30` official FITS calibration files (`qr2/spectral_wcs` D1–D6, `qr3/spectral_wcs` D1–D6, `qr2/solid_angle_pixel_map` D1–D6, `qr3/solid_angle_pixel_map` D1–D6, `qr3/epsf` D1–D6), indexed in `work/prototype-cache/calibrations/index.json` with URLs and SHA-256 checksums.
- **CLI check:** `python -X utf8 calibrations.py` bootstraps `work/deps` and completes with exit code `0`.

### Precomputed Sky Views (`prepared-all.json`)
- **Prepared target × detector × width combinations:** `180 / 180` (`0` processing failures)
- **Total playable frames across 180 views:** `17,403` (all satisfy `footprint_coverage >= 99%`, `coverage >= 80%`, `center_inside = True`)
- **Total excluded partial/low-coverage frames:** `3,742`
- **Zero-frame views (`2`):** `rw-aur` `D2` `60'` (`55` excluded partial exposures) and `rw-aur` `D5` `60'` (`56` excluded partial exposures); both display explicit coverage reasons and excluded frame download links.
- **60-arcminute render spot checks:** `34` non-empty `60'` combinations render `586 × 586` RGBA PNGs (`99.57%–100.0%` nonzero alpha), including all `6` detectors for `r-dra` (`40`–`355` frames per detector) and `4` detectors for `rw-aur` (`D1: 15`, `D3: 27`, `D4: 17`, `D6: 26`).
- **Date filtering & legacy cache audit:**
  - `rw-aur` `D3` `60'` (`2025-09-17` to `2025-09-20`): `13` playable frames.
  - `r-dra` `D1` `60'` (`2025-06-06` to `2025-07-10`): `6` playable frames.
  - Out-of-range dates (`1900-01-01` to `1900-01-02`): `0` frames with explicit `empty_reason` and `stretch: null`.
  - All `30` entries in `session-index.json` map to current `prepared-all.json` sessions (`0` legacy collisions); `create_session` calls on Barnard `D1`/`D2` and R Dra `D1` resolve to the current `prepared-all.json` session IDs.

### 3D Catalog Samples (`catalogs/`)
- **`catalogs/galaxies.json`:** `10,000` DESI DR1 galaxies (`0.01097 <= z <= 0.99956`, `48.48–3,394.53 Mpc` comoving distance under Planck18 `H0=67.66, Om0=0.30966`, formal redshift-only distance errors, `velocity: null`).
- **`catalogs/stars.json`:** `5,000` Gaia DR3 stars (`parallax > 5 mas`, `parallax_over_error > 20`, `ruwe < 1.4`, `199.75–200.00 pc` inverse-parallax distance; `1,559` have measured `radial_velocity` and 3D `velocity` vectors in `pc/yr`, `3,441` have sky-only proper motion and remain fixed at J2016.0 3D positions).

---

## 3. Real Sightline & Screening Examples (`spectroscopy.py`)

| Sightline | Coordinates (ICRS) & Redshift | Overlapping / Measured | Accepted / Chemical Eligible | Negative Fluxes | Screening Result |
| --- | --- | --- | --- | --- | --- |
| **RW Aurigae** | `76.956525°, 30.4014389°`, `z=0` | `333` / `320` | `0` / `0` | `0` | `0` candidates — bright/saturated/background-flagged points excluded from chemistry |
| **WISE 0855** | `133.7951292°, -7.2451472°`, `z=0` | `256` / `254` | `164` / `164` | `20` | `0` candidates (`Insufficient clean coverage / resolution` per 14d same-detector/release window); negative fluxes retained |
| **Gaia DR3 1648421264388120704** (in R Dra field) | `247.7898235°, 67.4501327°` (epoch `2026.8`), `z=0` | `2,152` / `1,887` | `1,746` / `1,745` | `1` | `0` candidates — tested `H2O` (`1.71σ`, `31` QR3 pts), `CH4` (`0.10σ`, `24` QR2 pts), `CO2` (`-0.94σ`, `6` QR2 pts), `CO` (`0.71σ`, `50` QR2 pts); `CH3OH` insufficient coverage |
| **DESI target `39627618168868798`** (in WISE 0855 field) | `133.8497664°, -6.8928628°`, `z=0.960067` | `256` / `229` | `197` / `197` | `3` | `0` candidates (`Insufficient clean coverage / resolution`) |

- **Synthetic unit-test fixture (non-discovery verification only):** A clean synthetic `40%` `H2O` absorption dip triggers at `7.98σ` (`candidate=True`) and is verified to be suppressed when points are contaminated (`chemical_eligible=False`), mixed across `QR2`/`QR3` releases, or unshifted for a redshifted dip without matching `redshift`.

---

## 4. Code & Automated Test Results

| Check | Result | Scope Covered |
| --- | --- | --- |
| `node --check app.js`, `light.js`, `universe.js` | PASS | JavaScript syntax validation for all frontend modules |
| `node work/test-controls.cjs` | PASS | HTML ID uniqueness, auto-apply width/detector steppers, cycle wrapping, request coalescing, cache reuse |
| `node .../scratch/test_ui_integration.cjs` | PASS | CSS selector coverage for light/3D UI, `Sky observations` ↔ `Physical 3D map` mode switch, `openPoint` detector switch preserving spectrum plot, 3D galaxy/star picking, RV-only vs sky-only motion, `W/A/S/D/Q/E`, `"Inspect SPHEREx here →"` carrying coordinates & redshift, empty states |
| `python -X utf8 work/test_coverage.py` | PASS | Coordinate parsing & bounds, flag bit decoding, Vesta Aug 4–5 `60'` session (`3` frames, `100%` min footprint, `0.012s` cache hit), pixel readout, explicit empty date message, `400`/`403` error paths |
| `python -X utf8 .../scratch/test_spectroscopy.py` | PASS | RW Aur contamination exclusion, WISE 0855 negative flux retention, `scope="near"` 7-day filtering (`30` pts), synthetic candidate gates |
| `python -X utf8 .../scratch/smoke_http.py` | PASS | Live HTTP `200` on `/`, `app.css`, `app.js`, `light.js`, `universe.js`, `catalogs/*.json`, `/api/library`, Vesta session, pixel readout, updated out-of-cache `empty_reason`, `WISE 0855` spectrum job, `403` origin check, `400` bad coordinate rejection |

---

## 5. Scientific Limits & Open Testing Scope

- **No browser GUI automation on localhost:** Browser-based interactive visual inspection of `http://127.0.0.1:8765/` was earlier blocked by the environment's local-origin approval check and was not bypassed. Desktop browser walkthroughs remain recommended for final visual QA across viewport widths.
- **Physical interpretation limits:** Spectral wavelength (`0.75–5.00 µm`) is never mapped to 3D physical depth. Point-source spectra are single-source forced ePSF fits without joint deblending, often spanning multiple dates. Chemical screening cards report simplified `>= 5σ` local-continuum dip tests, never confirmed molecular detections, gas/ice phase distinctions, or abundance percentages. DESI and Gaia 3D catalogs are quality-filtered samples with explicit model assumptions (`Planck18` redshift-only distances; inverse-parallax distances without zero-point correction; straight-line 3D motion only when Gaia radial velocity exists).
