# Star tracking and isolated space view

1. Open a saved sky field, select a detector, and click the actual star in an image.
2. Press **Track selected star** below the viewer. The server fits the source in each displayed observation, using original FITS pixels, variance and flags.
3. Play the frames. A solid green ring marks an accepted centroid. A dashed gold ring marks a Gaia-predicted position when an image measurement was rejected. Predictions are never included in the measured drift fit.
4. Inspect the small offset plot and export JSON for all positions, rejected-frame reasons, fit diagnostics, original FITS hashes and catalog provenance.
5. If there is a unique Gaia association with a sufficiently reliable distance, **Star + Solar System** opens a separate two-object scene. Drag to orbit, scroll to zoom, and change the year or play motion when radial velocity is available.

## Solar System objects

When a designation is typed in **Solar System object**, the expected position on every frame comes from JPL Horizons (observer: the SPHEREx spacecraft, epoch: exposure midpoint in UTC), not from Gaia and not from a fit through earlier positions. The image centroid stays an independent measurement and the offset between the two is reported per frame. Source, observer check, cache, failure messages, tolerance and measured offsets are described in `README.md` under *Moving objects and JPL Horizons*.

## Measurement scope

Each native image is independently fitted with a circular Gaussian plus constant background, using variance weights. The fit searches within two native pixels of the expected location. The source core must be free of specified contamination flags; weak fits (amplitude S/N below 5), reduced chi-square above 10, broad fits and fits at a search boundary are rejected. Bright saturated sources may therefore have only catalog prediction rings. The display uncertainty includes a conservative 0.5-arcsecond floor, not an instrument-wide calibrated error model.

The Gaia DR3 lookup queries a small numeric bounding box from NOIRLab Astro Data Lab, then propagates candidate positions to the reference observation date. A counterpart is used only when exactly one candidate lies within 6.15 arcseconds. This is a positional association, not definitive source identification. Nearby blends and multiple sources inside a SPHEREx beam require inspection. The query and downloaded response hash accompany the result. The local query cache lives under `work/prototype-cache/tracking-catalog/`.

Without a Gaia match, the source search stays close to the reference centroid; fast objects may leave that search window. With Gaia, the catalog guides the search but the fitted position remains a separate image measurement. The prediction does not include observer-specific annual parallax. A weighted straight-line sky drift is reported only for at least three accepted points over 30 days. Apparent drift includes parallax, frame alignment errors and wavelength-dependent source shape; it is not automatically a clean proper-motion measurement. Formal fit errors and the empirical floor do not remove these systematics.

## Space view

Physical distance uses inverse Gaia parallax only when parallax/error exceeds 20 and RUWE is below 1.4. Full 3D motion additionally requires a measured radial velocity. Missing radial velocity leaves a static distance-based view; missing reliable distance disables the space-view button.

The space trajectory is calculated from Gaia's position, distance, proper motion and radial velocity. The SPHEREx image drift does not supply depth or radial velocity. Coordinates are relative to the Solar System barycenter, approximating a Sun-centered view. Motion is a straight-line projection over years 1516–2516, without gravitational acceleration, a parallax zero-point correction, or full astrometric covariance propagation. Sphere sizes and the atmospheric background are illustrative; the physical Cartesian positions and parsec distance readout use the catalog model.

## Verification

End-to-end local API checks: Barnard's Star associated with Gaia DR3 4472832130942575872 and provided a reliable catalog distance and full space velocity. All 58 tested image positions failed quality checks and were correctly retained only as catalog predictions. A separate fainter source at approximately RA 269.61970°, Dec +5.01767° yielded 16 accepted measured positions out of 43 real frames. These outcomes demonstrate why accepted image centroids and catalog predictions must be labeled separately.

`work/test_tracking.py` checks recovery of known injected displacements and rejection of a contaminated core, then measures a real archived SPHEREx source and tests its catalog association. Synthetic fixtures are used only in tests. `work/test-star-ui.cjs` exercises selection, job results, the offset plot, isolated scene, year control, close and session invalidation. Existing sky controls and atlas interaction tests also pass. Browser visual review remains unavailable under the earlier browser-origin restriction.

References: [Astropy space motion](https://docs.astropy.org/en/stable/coordinates/apply_space_motion.html), [Photutils centroiding](https://docs.astropy.org/projects/photutils/en/stable/user_guide/centroids.html), [Gaia DR3](https://www.cosmos.esa.int/web/gaia/data-release-3).
