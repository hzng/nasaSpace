# UI audit: SPHEREx Observation Lab, before the redesign

Audited on 2026-11-13 from the running app (`cd0b7d3`, port 8767) at 1440, 1280, 768 and 375 px wide. Screenshots are in `work/ui-shots/before/`. Every item below was seen in a screenshot or measured in the DOM, except items 23, 26 and 28, which come from reading the stylesheet.

## Constraints that win over taste

From `outputs/SPHEREx-handoff-2026-11-11.md` and `outputs/handofffable.md`:

- Real dates, source files and quality warnings matter more than decoration.
- The sky image is the main element of the Sky screen.
- Demo flow: pick a target, play frames, click a pixel, compare two frames, track a point (with or without a JPL Horizons object), measure a spectrum, open the 3D Map and return with "Inspect sky".
- The canvas marks keep their meaning and colours: ivory field centre, blue clicked pixel, gold guide, green measured, cyan wing fit, violet predicted. The UI must not reuse those hues for its own chrome.

## Problems

### Colour and hierarchy

1. **Brass is used for everything.** Primary buttons, Play, the active tab, checkboxes, sliders, the callout text, disclosure rows, flag chips and the mode switch are all gold. Nothing reads as the main action, and the gold "Guide" mark on the image competes with the chrome.
2. **Four filled primary buttons in one view**: Load patch, Play, Measure, Track point.
3. **The callout panel uses a brown tint and gold body text**, so the first thing in the side panel looks like a warning.
4. **Warm ivory text on warm graphite** gives the page a sepia cast. Muted text is `#a39f97` and subtle text `#8e8a82`; the subtle value measures 4.57:1 on the `#20232a` surface, which passes WCAG AA with no margin.

### Type

5. **Seven font sizes** (11, 12, 13, 14, 16, 20, 28 px) and weights from 400 to 750 are used without a rule. 12 px is the most common body size, which is small for labels people must read.
6. **`Cascadia Code` is the data font.** Its coding ligatures and slashed glyphs make dates, IDs and coordinates look like terminal output; values in the metadata grid are bold monospace and louder than the headings.
7. **Labels and values are not separated consistently**: some use uppercase micro labels, some sentence case, some a prefix inside the field.

### Layout and spacing

8. **The side panel is clipped at 1440 px.** It is sticky with a fixed height and no visible scrollbar, so the Motion tracker's input and all of its results (KPIs, charts, export) are cut off below the panel edge. A user who tracks an object sees no result unless they find the hidden scroll.
9. **The sky image overflows its frame at the bottom**: the image runs under the playback bar and is cut by the frame border, with a bright star sliced at the edge.
10. **The toolbar has six differently shaped controls in one row** (thumbnail switcher, two prefix fields, two three-part steppers, two buttons) plus three loose status texts at the right ("58 frames", "Date filter", "Synced 20:34") with no grouping.
11. **Spacing has no scale.** Gaps of 5, 6, 8, 10, 12, 14, 16 and 20 px appear side by side; radii of 4, 6, 8, 10, 11, 12, 14, 16 px and pills are mixed.
12. **Under the image, three unrelated hairline rows** ("1.66–2.39 µm · DR1/QR2/QR3", "4 partial frames", "Coverage policy") look like leftovers, and the partial-frames row is gold.
13. **The Spectrum controls are an unstructured row**: native select, number field, checkbox, then a "Center" button pushed to the far right, then a bold "Ready".
14. **3D Map**: the page title "Cosmic atlas" at 28 px, an uppercase eyebrow, a controls band, a context sentence and the canvas each sit in their own bordered band, so the map starts 290 px down. The canvas is shorter than the side list, leaving a 250 px empty panel under it.
15. **Dialogs**: the Archive dialog shows the native "Choose Files" control inside a dashed box and an unlabelled status line.

### Controls and dropdowns

16. **Nine native `<select>` elements** (`fov`, `detector`, `speed`, `reference-date`, `light-scope`, `light-release`, `universe-kind`, `atlas-view`, `atlas-sort`). The closed state is styled; the open list is the operating system's white-on-dark or grey list, which breaks the look and differs per browser.
17. **`reference-date` lists every frame (58 here, 2,493 for R Draconis) in one native list** with no search.
18. **The Width and Band steppers show three chevrons each**: previous, the select's own arrow, and next.
19. **The target menu is the only custom menu.** It has no arrow-key navigation, its selected row is a gold outline, and it does not look like any other control.
20. **Checkboxes are native boxes recoloured gold**, sitting beside custom icons, so each toggle chip carries two glyphs (box and icon).
21. **Control heights differ** (measured at 1440 px): toolbar 34 and 36 px, view controls 24 and 28 px, playback 32 px, tabs 47 px, tracker buttons 38 px.

### States

22. **Disabled buttons differ by place**: "Pick 2nd" and "3D motion" are dimmed outlines, "Inspect sky" is a muddy brown fill, "Export JSON" in the map is barely visible.
23. **Focus rings are inconsistent**: some controls show the browser default ring, some a gold outline, some none inside the floating bars.
24. **Loading and empty states are bare text** ("Loading…", "Ready", "Click sky pixel") with different sizes and weights.

### Responsive

25. **375 px**: the toolbar takes 280 px before any image; the view controls wrap to three rows with "Reset" alone on the third; playback wraps to three rows (buttons, speed, slider); the image is 240 px tall; the page is about 6,600 px long, with the Spectrum section above the observation details.
26. **768 px**: one column, but controls keep desktop sizes, so tap targets are 28 to 32 px tall.
27. **1280 px**: the toolbar wraps to a second row.
28. **Phone tap targets**: stepper arrows are 38 px, checkboxes 16 px, tabs 30 px.

## What already works and should stay

- The image-first layout, the floating view controls and the playback bar.
- The mark legend under the image and the per-frame chips with UTC time.
- Tokens: most colours already come from CSS variables, so the palette can change in one place.
- No console errors on load, on tracking or on measuring.
