# Screenshot Tools

Browser-based tools for **before/after screenshot comparisons** and **image annotation**, exported as PNG / JPEG / WebP / SVG.

Fully vibecoded! Only this README section was written by hand.

---

# Vibecoded README

A single, dependency-free HTML file (`index.html`) with two tools, switchable via tabs. Everything runs in your browser — no server, no build step, no uploads.

**Live:** https://veryjoe.com/screenshot-tools/

## Before / After

- A title plus multiple **sections** ("changes"), each with multiple **before/after pairs** and **per-image captions**.
- **Vertical or horizontal** orientation — stack everything top-to-bottom, or lay pairs and sections out left-to-right.
- Flexible image input: click to browse, drag-and-drop, or paste. Drop two images on one slot to fill both _before_ and _after_; drop onto **+ Add pair** / **+ Add change** to create and fill in one go.
- Reorder sections/pairs (↑ / ↓), **⇄ swap** before/after, customizable labels, background color, export quality, and an optional date/footer stamp.
- Export the whole document, **each section** separately, or a **single section** — as PNG/JPEG/WebP/SVG, or copy to the clipboard.
- **Save / Open** editable project files (`.json`, images included).

## Annotator

- Drop / paste / browse a single image and annotate it on a **pan/zoom infinite canvas** (scroll to pan, ⌃scroll / pinch to zoom).
- Tools: **box, arrow, numbered marker, multi-line text label**, with a color palette.
- Arrows **pin** to boxes, labels and numbers and follow them when moved; drag handles to spin off linked arrows/labels.
- Marquee multi-select, move/resize, undo/redo, and keyboard shortcuts (1–5 for tools, ⌘Z to undo, …). Annotate outside the image and the export grows to fit.
- Export the annotated image as PNG/JPEG/WebP/SVG, or copy it.

The annotation editor is shared between both tools — the Before/After **Annotate** button opens the same editor in a modal.

## Usage

Open `index.html` in any modern browser, or use the hosted version linked above.

## License

MIT
