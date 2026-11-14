# UI design spec: SPHEREx Observation Lab

Written 2026-11-13. This is the contract for every restyling task. Where a task brief and this file disagree, this file wins. The problems it answers are in `outputs/ui-audit.md`.

## Direction: an instrument with a voice

Revised 2026-11-13 after the user found the first pass "almost looks the same". The chrome stays neutral graphite, but it now has one accent colour with meaning (action blue: what you act on and what is selected), says in large type what you are looking at (the target name and the observation date), and separates sections with space more than lines. One filled button per region. Patterns are borrowed from well-known product UIs (calm spacing and type, command-style menus, the select-only combobox pattern); no brand, logo, font or layout is copied.

Rules:

- Remove before adding. No gradients, glows, glass blur, drop shadows on flat content, uppercase eyebrows or decorative icons.
- The canvas mark colours are reserved for data: ivory `#f3efe6`, blue `#6cb8ff`, gold `#eab354`, green `#68d391`, cyan `#71d9f6`, violet `#b9a3f5`. Chrome never uses them, except amber for warnings about data quality, which is the same meaning.
- Dark theme only. A light theme is not cheap here: the sky canvas, the 3D map and the SVG charts set their colours in JavaScript.

## Colour tokens

Defined once in `css/tokens.css`. Nothing else may hard-code a colour.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#000000` | page |
| `--panel` | `#161617` | panels, menus, dialogs |
| `--surface` | `#1d1d1f` | controls, cards inside panels |
| `--surface-hover` | `#262628` | hover and pressed fill |
| `--canvas-bg` | `#000000` | image and chart wells |
| `--line` | `rgba(255,255,255,0.08)` | hairlines, default borders |
| `--line-strong` | `rgba(255,255,255,0.16)` | control borders, hover borders |
| `--text` | `#f5f5f7` | primary text |
| `--muted` | `#a1a1a6` | secondary text, labels |
| `--subtle` | `#86868b` | tertiary text, placeholders |
| `--accent` | `#0071e3` | primary button, selected tab underline, active mode icon, menu check mark, slider thumb, checkbox; never text |
| `--accent-hover` | `#0062c4` | primary hover |
| `--accent-ink` | `#ffffff` | text on `--accent` |
| `--accent-tint` | `rgba(0,113,227,0.22)` | active mode switch fill |
| `--accent-soft` | `rgba(255,255,255,0.08)` | neutral: hover fill, selected row, pressed toggle |
| `--focus` | `var(--accent)` | keyboard focus ring |
| `--warning` | `#e5b25d` | data-quality warnings, flags |
| `--warning-soft` | `rgba(229,178,93,0.12)` | warning fill |
| `--danger` | `#f0806e` | errors, out-of-tolerance |
| `--positive` | `#68d391` | confirmed, within tolerance |
| `--sky`, `--predict` | unchanged | only where the DOM repeats a canvas mark (legend swatches, path card) |

Palette revised 2026-11-13 to follow Apple's dark product pages (black page, graphite surfaces, `#f5f5f7` text, `#0071e3` action blue). Contrast, computed with the WCAG formula (AA needs 4.5:1 for text, 3:1 for non-text): `--text` on `--bg` 19.3:1; `--muted` on `--surface` 6.5:1 and on `--surface-hover` 5.9:1; `--subtle` on `--surface` 4.6:1; `--accent-ink` on `--accent` 4.7:1 and on `--accent-hover` 5.9:1; `--accent` on `--panel` 3.9:1 (non-text only); `--warning` on `--surface` 8.7:1; `--danger` on `--panel` 6.9:1; `--positive` on `--panel` 9.7:1; `--focus` on `--surface` 3.6:1. `--subtle` must not be used on `--surface-hover`. Disabled text is exempt and uses 45% opacity.

## Type

- UI font: the system stack already in use, `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif`. No web font.
- Data font `--mono`: `ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace` (no ligatures). Use it only for identifiers, hashes and coordinates. Numbers elsewhere use the UI font with `font-variant-numeric: tabular-nums`.
- Scale (px / line-height): 11 / 16 micro, only for badges on the image; 12 / 16 secondary and labels; 13 / 20 body and controls; 16 / 24 section and panel titles; 20 / 28 page-section title (Spectrum); 24 / 28 observation date; 32 / 36 display, the target name above the image. Nothing else.
- Weights: 400 body, 500 controls and labels that act, 600 titles and key values, 700 only for the display name, the observation date and page-section titles.
- Sentence case everywhere. No uppercase labels. Letter-spacing is negative only at 16 px and above (-0.01 to -0.03em).
- Target first: the target name, its category ("Asteroid", "Nearby star") and its position sit above the image.
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
- **Tabs and segmented controls**: text only; active is `--text` with a 2 px `--accent` underline (tabs) or an `--accent-soft` fill (segmented). The app-bar mode switch uses `--accent-tint` and an `--accent` icon.
- **Status pill**: 20 px tall, 11 px text, tinted by meaning (neutral, positive, warning, danger).
- **Disclosure rows** (`details`): one component, in `css/controls.css`. A full-width row `--control-h` tall, label 13 px weight 500 `--text`, optional `.summary-meta` value in `--muted` at the right, a 14 px chevron (SVG mask) at the right edge that turns 180° when open, neutral hover fill. Open content is 13 px `--muted`, indented to the label. Related rows form one list with hairlines between them. Area files add only layout.
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
- One authored moment (in `css/overrides.css`): a freshly fetched view comes into focus (blur 6 px to sharp, 450 ms, `cubic-bezier(0.16, 1, 0.3, 1)`), and when the target changes its name wipes in left to right (clip-path, 500 ms) with the category line fading in after it. Playback and revisited views stay instant so blinking between frames is honest.
- Supporting motion: disclosure rows open by height (220 ms open, 150 ms close; the toolbar date filter is excluded); each pixel result fades in (160 ms).
- Under `prefers-reduced-motion: reduce`, all transitions and animations are off.

## Layout

- App bar 48 px; toolbar one row at 1280 px and wider, all controls 32 px tall.
- Sky screen: stage column plus a 400 px side panel. The side panel is sticky and scrolls inside itself with a thin visible scrollbar; nothing in it may be clipped.
- The image stays inside its frame on all four sides; floating bars sit inside the frame.
- Below 1121 px: one column. Order: toolbar, image, playback, legend, frames, side panel content, spectrum.
- Breakpoints to verify: 375, 768, 1280 (and 1440 as the design size). No horizontal page scroll at any of them.

## Not in scope

Data, tracking, ephemeris and science logic; canvas mark rendering; the IDs and class names the JavaScript reads; copy that states scientific limits.
