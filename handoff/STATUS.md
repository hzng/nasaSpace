# Remaining work

| Item | State and next step |
| --- | --- |
| DR1 measurement validation | The code now accepts DR1 and fetches DR1 calibration data. Run a real DR1 source through the merged Lab and compare it against IRSA Spectrophotometry before treating the result as validated. Compare matched QR2 and DR1 reductions at the same exposure epoch. |
| More saved images | Run python -m scripts.prefetch_lab --per-field 4 from the project root. This run attempted five fixed fields; the IRSA SIA endpoint returned HTTP 502 for all five. The original 22 images remain available. For an offline expansion, index verified existing saved-spherex/cutouts and validate coverage before registering each FITS in the Lab. |
| Continuous DR1 sky explorer | No pan/zoom cube layer viewer, wavelength slider, three-band RGB composition or click-to-plot cube spectrum. Use the official HiPS notebook and mark the two blank display layers unavailable. Preserve dated FITS playback separately. |
| Tracking-linked spectra | **Implemented & validated.** The Lab tracker and light engine are now unified. Forced photometry tracks moving target coordinates per exposure (measured centroid or Horizons ephemeris), excludes frames outside the footprint, labels prediction-only points, and recovers flux on bright moving bodies like Vesta. |
| Motion and variability validation | One real Vesta track and one WISE 0855 matched-band history were tested. Complete a verified motion/brightness/insufficient-data result per featured field. Check matched wavelengths, release, masks and centroid errors. |
| Chemical demonstration | **Implemented.** Added 3.3 µm PAH hydrocarbon emission band (3.25–3.33 µm) with asymmetric continuum fitting and emission peak screening alongside existing absorption features. |
| Partner data | WiseView links, Gaia DR3 overlays and CADC NEOSSat footprint lookup exist. No integrated NEOSSat FITS importer or independent joint tracking test. |
| Production rollout | Handoff branch is for review; Render currently follows render-preview. The integrated teammate viewer, DR1 changes and footer fix need a build and smoke test on the handoff branch before switching it. |
| Laya on Render | The paid/model-capable runtime and GPU are separate deployment work. Local lab results are not a confirmed detection. |

References: [IRSA DR1 overview](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html), [DR1 HiPS cube notebook](https://caltech-ipac.github.io/irsa-tutorials/spherex-hipscube/), [IRSA photometry](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html).
