# Screenshot Tools

Browser-based tools for **before/after screenshot comparisons** and **image annotation**, exported as PNG / JPEG / WebP / SVG.

Fully vibecoded! Only this README section was written by hand.

---

# Vibecoded README

A single, dependency-free HTML file (`index.html`) with three tools, switchable via tabs. Everything runs in your browser — no server, no build step, no uploads.

Each tool has its own URL via hash routing, so you can deep-link or share a link straight to a tool: `#/before-after`, `#/annotator`, and `#/tutorial`. (No server config needed — it stays a single static file.)

**Live:** https://veryjoe.com/screenshot-tools/ ([Annotator](https://veryjoe.com/screenshot-tools/#/annotator))

## Before / After

- A title plus multiple **sections** ("changes"), each with multiple **before/after pairs** and **per-image captions**.
- **Vertical or horizontal** orientation — stack everything top-to-bottom, or lay pairs and sections out left-to-right.
- Flexible image input: click to browse, paste, or drag and drop. Drop images anywhere on the page to add a new change holding them, onto a change to add pairs to it, or onto an image to replace it (two images dropped on one side fill both _before_ and _after_).
- **Drag** a pair by its header to reorder it, move it to another change, or drop it on the page to make it a new change; drag an image onto another to swap them. Buttons do the same: reorder (↑ / ↓), move a pair out into its own change (**↳ New change**), **⇄ swap** before/after, customizable labels, background color, export quality, and an optional date/footer stamp.
- Export the whole document, **each section** separately, or a **single section** — as PNG/JPEG/WebP/SVG, or copy to the clipboard.
- **Save / Open** editable project files (`.json`, images included). A project file holds one tool's document; opening it switches to that tool and leaves the others alone.

## Annotator

- Drop (anywhere on the page) / paste / browse a single image and annotate it on a **pan/zoom infinite canvas** (scroll to pan, ⌃scroll / pinch to zoom).
- Tools: **box, arrow, numbered marker, multi-line text label**, with a color palette.
- Arrows **pin** to boxes, labels and numbers and follow them when moved; drag handles to spin off linked arrows/labels.
- Marquee multi-select, move/resize, undo/redo, and keyboard shortcuts (1–5 for tools, ⌘Z to undo, …). Annotate outside the image and the export grows to fit.
- Export the annotated image as PNG/JPEG/WebP/SVG, or copy it.

The annotation editor is shared across all three tools — in Before/After and Tutorial, click an image (or its **Annotate** button) to open the same editor in a modal.

## Tutorial

- Upload several screenshots at once, or drop them anywhere on the page, to build a **numbered, step-by-step tutorial** (one step per image).
- A step can hold **several screenshots**, shown side by side: use **+ Add screenshot** or drop images onto the step. Dropping onto a screenshot replaces it (any extra images go right after it). Each screenshot has its own caption and annotations.
- A title and an optional intro paragraph (centered or left-aligned); each step gets optional text after its number.
- **Drag** screenshots to reorder them, move them between steps, or drop one on the page to make it a new step (a step left empty disappears, so this also merges steps). Buttons do the same: reorder steps (↑ / ↓) or reverse them all, reorder screenshots (← / →) or move one out into its own step (**↳**), choose **vertical or horizontal** layout and **number or letter** labels.
- Export the whole tutorial or **each step** separately as PNG/JPEG/WebP/SVG, or copy it to the clipboard.
- **Save / Open** editable project files (`.json`, images included).

## Usage

Open `index.html` in any modern browser, or use the hosted version linked above.

## Tests

```sh
node tests/run.mjs            # all tests
node tests/run.mjs tutorial   # tests whose name contains "tutorial"
node tests/run.mjs --update   # re-record goldens after an intended change
```

The tests drive `index.html` in headless Chrome over the DevTools protocol (Node 22+, no npm packages; set `CHROME` if Chrome isn't in the default macOS location). They open the project files in `tests/fixtures/` (regenerate with `node tests/fixtures/make.mjs`), draw with real mouse and keyboard input, and compare exports, preview pixels and saved state against `tests/golden/`. A mismatched SVG is written next to its golden as `*.actual`. Goldens depend on the machine's fonts and Chrome version, so re-record them when either changes.

## License

MIT
