# Parallax context and archive recovery — 2026-11-15

## Changes

- Observation Lab now reuses saved archive identities when IRSA TAP and SIA return proxy errors. Results explicitly say they are an incomplete saved subset; the app does not claim to have fetched the latest discovery list.
- Live discovery requests DR1 and QR3 (including deep collections). Saved QR2 observations remain usable during an outage. Duplicate observations prefer DR1.
- Image retrieval uses Parallax's existing bounded cutout transfer and official S3 mirror fallback, retaining native FITS pixels, identity checks, coverage validation and provenance.
- Failed live footprint discovery no longer aborts recovery of previously indexed exposures; native image validation still decides whether a frame covers the field.
- Earth-flight context handles an expired IERS table by approximating UT1 with UTC for the illustrative landing longitude only. Catalog positions, distances and the planetary ephemeris are unchanged. The API reports this approximation.
- Companion lookup no longer delays enabling a prepared Earth flight.
- New Sun-centered scope buttons: Solar System, Nearby Stars (10 pc), Stellar Neighborhood (100 pc). Stellar views use available catalog distances and are explicitly incomplete samples.

## Verification

- 43 Python checks passed across recovery, solar, context, cache and core suites.
- Existing frontend startup/navigation test passed.
- Browser completed a real animated Barnard-to-Earth flight, then all three scope transitions; no page JavaScript errors.
- Discovery fallback returned Vesta 349, Barnard 359, Epsilon Indi B 447, WISE 0855 256, RW Aurigae 333 and R Draconis 2483 indexed observations. These are available index counts, not guarantees that every exposure passes coverage/quality checks.
- Retrieved an actual Barnard QR3 D3 exposure and completed a 5 arcminute aligned Observation Lab job for August 20–22, 2026, with an explicit discovery-outage notice.
- Desktop, tablet and mobile scope layouts checked. Screenshots are local under runtime/.

The live IRSA discovery service was returning HTTP 502 during verification. The app cannot repair that external service; fields without saved coverage receive a readable retry message. Latest release completeness requires successful live discovery.
