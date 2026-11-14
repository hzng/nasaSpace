# UI design spec: SPHEREx Observation Lab

Written 2026-11-13. This is the contract for every restyling task. Where a task brief and this file disagree, this file wins. The problems it answers are in `outputs/ui-audit.md`.

## Direction: a quiet instrument

The data is the only colourful thing on the page. The chrome is neutral graphite with white-on-dark controls, hairline borders and no decoration. One filled button per region. Patterns are borrowed from well-known product UIs (calm spacing and type, command-style menus, the select-only combobox pattern); no brand, logo, font or layout is copied.

Rules:

- Remove before adding. No gradients, glows, glass blur, drop shadows on flat content, uppercase eyebrows or decorative icons.
- The canvas mark colours are reserved for data: ivory `#f3efe6`, blue `#6cb8ff`, gold `#eab354`, green `#68d391`, cyan `#71d9f6`, violet `#b9a3f5`. Chrome never uses them, except amber for warnings about data quality, which is the same meaning.
- Dark theme only. A light theme is not cheap here: the sky canvas, the 3D map and the SVG charts set their colours in JavaScript.

## Colour tokens

Defined once in `css/tokens.css`. Nothing else may hard-code a colour.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0b0c0e` | page |
| `--panel` | `#121316` | panels, menus, dialogs |
| `--surface` | `#191b1f` | controls, cards inside panels |
| `--surface-hover` | `#212328` | hover and pressed fill |
| `--canvas-bg` | `#060709` | image and chart wells |
| `--line` | `rgba(255,255,255,0.08)` | hairlines, default borders |
| `--line-strong` | `rgba(255,255,255,0.16)` | control borders, hover borders |
| `--text` | `#ededef` | primary text |
| `--muted` | `#a0a3ab` | secondary text, labels |
| `--subtle` | `#858892` | tertiary text, placeholders |
| `--accent` | `#ededef` | filled primary button, checked and selected states |
| `--accent-hover` | `#ffffff` | primary hover |
| `--accent-ink` | `#0b0c0e` | text on `--accent` |
| `--accent-soft` | `rgba(255,255,255,0.08)` | selected row, pressed toggle |
| `--focus` | `#6ea8fe` | keyboard focus ring only |
| `--warning` | `#e5b25d` | data-quality warnings, flags |
| `--warning-soft` | `rgba(229,178,93,0.12)` | warning fill |
| `--danger` | `#f0806e` | errors, out-of-tolerance |
| `--positive` | `#68d391` | confirmed, within tolerance |
| `--sky`, `--predict` | unchanged | only where the DOM repeats a canvas mark (legend swatches, path card) |

Contrast, computed with the WCAG formula (AA needs 4.5:1 for text): `--text` on `--bg` 16.7:1; `--muted` on `--surface` 6.8:1 and on `--surface-hover` 6.2:1; `--subtle` on `--surface` 4.9:1; `--accent-ink` on `--accent` 16.7:1; `--warning` on `--surface` 8.9:1; `--danger` on `--panel` 7.1:1; `--positive` on `--panel` 10.0:1; `--focus` on `--surface` 7.1:1. `--subtle` must not be used on `--surface-hover`. Disabled text is exempt and uses 45% opacity.

## Type

- UI font: the system stack already in use, `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif`. No web font.
- Data font `--mono`: `ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace` (no ligatures). Use it only for identifiers, hashes and coordinates. Numbers elsewhere use the UI font with `font-variant-numeric: tabular-nums`.
- Scale (px / line-height): 11 / 16 micro, only for badges on the image; 12 / 16 secondary and labels; 13 / 20 body and controls; 14 / 20 section titles; 16 / 24 panel and dialog titles; 20 / 28 screen title. Nothing else.
- Weights: 400 body, 500 controls and labels that act, 600 titles and key values. Nothing above 600.
- Sentence case everywhere. No uppercase labels, no letter-spacing above 0.
- Labels are `--muted` 12 px above or before the value; values are `--text` 13 px. Values are never bolder than the nearest heading.

## Spacing, radii, borders, shadows

- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px. Tokens `--s1` to `--s7`. Gaps inside a control group 8; between groups 16; panel padding 16; between page sections 24.
- Control height: 32 px (`--control-h`), compact 28 px, and 40 px when `pointer: coarse` or the viewport is 768 px or narrower. Horizontal padding 12 px.
- Radii: 6 px controls and chips (`--r-control`), 10 px panels, menus, dialogs and the image frame (`--r-panel`), 999 px only for status pills.
- Borders: one 1 px hairline. A surface has a border or a different fill from its parent, not both plus a shadow.
- Shadows: only on layers that float above content (menus, popovers, dialogs, the bars over the image): `--shadow-float: 0 0 0 1px var(--line-strong), 0 12px 32px rgba(0,0,0,0.5)`.

## Components

- **Buttons**: primary (`.btn-brass`, name kept so the JavaScript is untouched) is filled `--accent`; at most one per region (toolbar, spectrum, tracker, map details). Default (`.btn-outline`) is `--surface` with a `--line-strong` border. Ghost (`.btn-ghost`) has no border and `--muted` text. Play is a default button, not a primary.
- **Fields**: `--surface` fill, `--line-strong` border, label outside or as a muted prefix. Focus changes the border to `--focus` and adds the ring.
- **Select and menu**: every native `<select>` is replaced on screen by the `ui-select` component (trigger button plus a listbox in the top layer); see the component brief in the plan. The target switcher and every popover share the same surface, row and selection styles. Selected rows show a check mark and `--accent-soft` fill, never a coloured outline.
- **Toggles**: a pressed toggle chip is `--accent-soft` fill with `--text`; unpressed is `--muted`. The native checkbox box is hidden inside chips that carry an icon; standalone checkboxes are 16 px, neutral, with a white check.
- **Tabs and segmented controls**: text only; active is `--text` with a 2 px `--text` underline (tabs) or an `--accent-soft` fill (segmented).
- **Status pill**: 20 px tall, 11 px text, tinted by meaning (neutral, positive, warning, danger).
- **Disclosure rows** (`details`): muted 13 px summary with a chevron that rotates; never coloured.
- **Empty and loading states**: one line of `--muted` 13 px text, optionally a 2 px progress bar; no icons, no bold.

## States

Every interactive element has all of these:

- Hover (fine pointers only): fill moves to `--surface-hover`, or text from `--muted` to `--text`.
- Active: `transform: scale(0.98)` on buttons, no colour jump.
- Focus-visible: `outline: 2px solid var(--focus); outline-offset: 2px`. Never removed, never gold.
- Disabled: 45% opacity, `cursor: not-allowed`, no hover. The same everywhere.
- Selected or pressed: `--accent-soft` fill and `--text`.
- Error: `--danger` text, one line, next to the control that caused it.

## Motion

- Colour and border transitions 120 ms; menus and popovers 160 ms (opacity plus a 4 px rise); dialogs 200 ms. Easing `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Nothing loops, nothing bounces, nothing animates on page load except content that is loading.
- Under `prefers-reduced-motion: reduce`, all transitions and animations are off.

## Layout

- App bar 48 px; toolbar one row at 1280 px and wider, all controls 32 px tall.
- Sky screen: stage column plus a 400 px side panel. The side panel is sticky and scrolls inside itself with a thin visible scrollbar; nothing in it may be clipped.
- The image stays inside its frame on all four sides; floating bars sit inside the frame.
- Below 1121 px: one column. Order: toolbar, image, playback, legend, frames, side panel content, spectrum.
- Breakpoints to verify: 375, 768, 1280 (and 1440 as the design size). No horizontal page scroll at any of them.

## Not in scope

Data, tracking, ephemeris and science logic; canvas mark rendering; the IDs and class names the JavaScript reads; copy that states scientific limits.
