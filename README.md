<img src="./icon.png" alt="Sheets icon" width="80" height="80" />

# Sheets

**Fast, private, AI-powered sheets — right in your browser.**

Sheets is a modern sheets app built with vanilla JavaScript (no frameworks) and Vite.
It calculates 500+ formulas live, spills dynamic arrays, draws charts, formats
tables, and saves every workbook as a real `.xlsx` file — so your work opens in
Excel, Numbers, or LibreOffice and stays in your own cloud.

🌐 **Live demo:** https://salim-studio.github.io/sheets/

## Highlights

- **500+ formulas** with live recalculation: math, statistics, distributions,
  logic, text, lookup (`XLOOKUP`, `INDEX`/`MATCH`), dates, finance, engineering,
  plus `LET`/`LAMBDA` with `MAP`, `REDUCE`, `SCAN`, `BYROW`, `BYCOL`, `MAKEARRAY`.
- **Dynamic arrays** that spill: `UNIQUE`, `FILTER`, `SORT`, `SORTBY`,
  `SEQUENCE`, `RANDARRAY`, `TRANSPOSE`, `VSTACK`, `HSTACK`, `TAKE`, `DROP`,
  `CHOOSECOLS`, and plain range arithmetic (`=A1:A5*2`).
- **Charts and sparklines**: column, bar, line, area, pie, donut, scatter,
  combo, histogram, waterfall, radar, bubble, treemap, sunburst, box & whisker,
  funnel, stock and surface charts — saved back into the `.xlsx` file.
- **Tables, filters, sorting, subtotals, pivot tables, goal seek, solver and
  data-analysis tools**, data validation, dropdowns, checkboxes, conditional
  formatting, and cell styles.
- **AI assistant** beside the sheet that reads cells, writes values and
  formulas, formats, sorts, and builds charts — every change is one undo step.
- **Automation scripts** in JavaScript with a built-in editor, plus one-click
  samples and recordable actions.
- **Editing that feels right**: fill handle with series detection, paste
  special, 200 levels of undo, find & replace with regex, frozen panes, groups,
  merged cells, notes, hyperlinks, print layouts and page breaks.
- **Private by design**: no sign-in needed to start; your files live in your
  own cloud and unsaved edits are kept on your device.

## Quickstart

```bash
npm install
npm run dev      # local development at http://localhost:5173
npm test         # unit tests (vitest)
npm run build    # production build into dist/
npm run preview  # preview the production build
```

Every push to `main` is deployed automatically to GitHub Pages via
`.github/workflows/pages.yml`.

## Project layout

| Path | What lives there |
| ---- | ---------------- |
| `src/main.js` | App entry, routing, window title |
| `src/core/` | Workbook engine: formulas, `.xlsx` I/O, charts, pivots |
| `src/ui/` | Toolbar, menus, dialogs, formatting panes |
| `src/views/` | Home, editor, sign-in and error screens |
| `src/collab/` | Live co-editing room worker client/server |
| `src/workers/` | Background workers (e.g. email) |
| `tests/` | Vitest suites for formulas and behaviors |
| `public/` | Icons, `manifest.json`, fonts, install assets |
| `dev/` | Icon/thumbnail generators, mocks, link-preview sources |

## Brand identity

- **Name:** Sheets · **Short name:** Sheets
- **Voice:** English, plain language, no jargon.
- **Accent (light):** emerald `#0E7A4D` · **strong:** `#0A5C3B`
- **Accent (dark):** `#4CC38A` · **strong:** `#7FE3B0`
- **Install metadata:** `public/manifest.json` (`sheets-app`)
- `icon.png` is the source for the UI logo and browser/install icons.
  After replacing it, run `npm run icons` (requires ImageMagick) to regenerate
  favicons, the Apple touch icon, and the standard/maskable install icons.

## Origin

Sheets is a rebranded, standalone fork of the `src/spreadsheet` app from
[HeyPuter/everything](https://github.com/HeyPuter/everything) (MIT licensed).
All user-facing names, links, storage keys and the visual theme were renamed
from Spreadsheet to Sheets; third-party code under `src/vendor/` is unchanged.

## License

MIT — © 2026 salim-slimani. See [LICENSE](./LICENSE).
Upstream portions © 2026 Puter Technologies Inc.
