# Cosmic atlas update and accuracy review

## Interface

Preserves the existing graphite, ivory and brass design. The map now opens on a thinner ICRS Z slice through the catalog's median Z coordinate. This reduces overlap while keeping all plotted coordinates unchanged. Use Full catalog volume to see the full sample, or select an object and use Selected neighborhood to examine surrounding objects.

Controls include distance and slice thickness, searchable catalog names/IDs, nearest/name ordering, paginated object selection, camera zoom, top view, fit visible objects, focus selected object and the existing Inspect sky action. Search applies to the current filtered sample; widen the filters or select Full catalog volume when searching for another catalog entry. Catalogs contain stars and galaxies; there is no planet catalog in this view.

Soft point glows are illustrative symbols. Their radius is not a measured physical size. Color in galaxy mode represents redshift; star colors are based on Gaia BP−RP. No artificial galaxy arms or background objects have been inserted. Spatial filtering never relocates objects.

## Accuracy audit

Revalidated all 10,000 DESI galaxy entries and 5,000 Gaia star entries against the saved original VOTable downloads. Download SHA-256 values match the provenance recorded in each catalog, identifiers are unique, and coordinates match source rows. Galaxy redshifts and star parallaxes match their source records.

Recomputed all Cartesian coordinates with Astropy SkyCoord. Maximum absolute component differences from the stored calculations are 4.55e-13 Mpc for galaxies and 2.84e-14 pc for stars (floating-point rounding). Recomputed all galaxy distances with Planck18 comoving distance and all stellar distances as 1000 / parallax in milliarcseconds. Recomputed Gaia 3D velocity vectors where radial velocity is present and checked that missing radial velocity leaves 3D velocity unavailable.

The map is a physically scaled representation of these catalog samples under their stated models. It is not a complete reconstruction of the universe. Survey coverage and sample selection affect apparent empty regions. The Gaia sample is not a complete local stellar census. Inverse-parallax distances omit the parallax zero-point correction. Galaxy distances depend on the cosmological model; the displayed formal errors exclude peculiar velocities and cosmological parameter uncertainty. Different galaxy lookback times do not form a simultaneous snapshot. Stellar trajectories use straight-line extrapolation, and their displayed distance error does not propagate full position/velocity covariance over time.

The renderer now consistently uses each star's own reference epoch, instead of assuming the catalog-wide epoch in one rendering path. Camera scale text now explicitly describes camera-to-focus distance and the approximate span at that plane.

Numerical results are saved in `catalogs/accuracy-check.json`. Verification scripts are `work/verify_atlas.py` and `work/test-atlas.cjs` relative to the overall project root. Interaction checks exercise real catalog loading, canvas drawing calls, filtering, selection, no-match behavior, pagination, coordinate guides, changing catalogs, stellar epoch, and camera buttons. The existing sky-control regression checks also pass. Browser visual inspection was not performed because the earlier browser-origin access restriction remains in effect; these checks do not replace a rendered-browser review.

Sources: [DESI data access](https://data.desi.lbl.gov/doc/access/), [Astropy cosmological distances](https://docs.astropy.org/en/stable/api/astropy.cosmology.FLRW.html), [Gaia DR3](https://www.cosmos.esa.int/web/gaia/data-release-3).
