# Nael handoff — SPHEREx app

Project: `outputs/spherex-prototype/`

## Milestones

- [ ] **Make track point work.** A user clicks a source in a SPHEREx frame and the app clearly marks that same source through the timeline. Test a source with measured positions, a bright source that requires a catalog prediction, and a frame where tracking fails. Keep measured positions distinct from predictions; show the reason for rejected points. Confirm the 3D button opens the selected source when reliable distance and velocity exist.
- [ ] **Refine the UI.** Keep the current Celestial Workbench graphite, ivory, and brass style. Make target selection, frame playback, tracking controls, quality warnings, and the 3D transition easy to find and understand. Clearly distinguish the patch-center cross, a clicked pixel, an archived Vesta guide, a measured star position, and a catalog prediction. Check desktop and narrow-screen layouts.
- [ ] **Make the spectrum a scatter graph.** Plot each real brightness measurement as an individual point at its measured wavelength, with error bars. Use detector color and a distinct mark for flagged or rejected measurements. Keep observation date and release available on each point, avoid connecting measurements into a misleading continuous line, and retain CSV/JSON/SVG export. Verify the display against original measurement records.

## Acceptance check

The three milestones are complete when a person can select a source, follow its marked positions across real frames, understand which marks are measured, open its supported 3D view, and read an honest scatter plot of its light measurements without consulting the source code.
