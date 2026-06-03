# Annotation editor — brush/property keyboard shortcuts (redesign)

## Problem

The first implementation armed a "pick the Nth value" mode by giving a value button
DOM focus. Mouse-clicking a value also focuses it, so after clicking (e.g.) a color the
number keys silently stopped switching tools and started picking colors instead — a
stateful, invisible overload of the digit keys with no obvious exit.

## Goal

Keyboard shortcuts to set brush/editor properties in the annotation editor, where the
meaning of a digit key is never ambiguous or hidden, and never depends on focus.

## Model

Each property's values are a single-select set, so each value group is a real **ARIA
radiogroup**. That provides the accessible foundation (semantics, navigation, tab-stop
collapse); the letter/chord shortcuts are accelerators layered on top.

The invariant that fixes the original bug: **a digit's meaning never depends on focus.**
Digits map to property values only while a property *letter is physically held* (a chord);
otherwise digits switch tools. Focus changes what the *arrow keys* do (standard radio
navigation) — never what a digit does. So clicking or tabbing to a value is safe.

Properties and their access letters (first letter of the label):

| Letter | Property | Values | Context |
|--------|----------|--------|---------|
| `c` | Color | 7 swatches | always |
| `b` | Background | Transparent / Opaque | text |
| `s` | Style **or** Stamp | solid/dash/dot · 123/ABC | line / number |
| `w` | Width | S / M / L | line |

`s` resolves to whichever of Style / Stamp is currently visible (mutually exclusive in
single-tool use; Style wins if both are somehow visible).

### Radiogroup (standard, focus-based — the accessible layer)

Each `.tp-swatches` container gets `role="radiogroup"` + `aria-label`; each value `<button>`
gets `role="radio"`, `aria-checked`, and a roving tabindex (the selected value is the only
one with `tabindex="0"`, so each group is a single tab stop). When a value has focus:

- **←/→/↑/↓** move and select (selection follows focus), with wraparound.
- **Home/End** jump to first/last; **Space** selects the focused value.
- These are handled on the radiogroup container and `stopPropagation()` so Space selects
  rather than toggling the editor's pan mode. Digits/letters are left to bubble to the
  editor handler.

`syncRadios()` mirrors each group's existing `.active` selection onto `aria-checked` and the
roving tabindex; it runs from `updateTextProps()` (i.e. on every redraw/context change).

### Accelerators (custom, never focus-dependent)

- **Tap a letter** (`c`/`b`/`s`/`w`) → move focus into that group's selected value, where the
  radio arrows take over. Changes no value.
- **Hold letter + digit `1`–`9`** → jump straight to the Nth value (chord). Hold and tap
  several digits to preview. Gated on the *held letter*, so it is the only way digits pick
  values.
- **Digit with no letter held** → switch tool (`1`–`5`), unchanged.
- **Escape / Enter / Delete / undo-redo** → unchanged editor behavior.

### State

- `heldProp` (key | null): the property letter currently held — drives the chord and the
  value badges. Set on letter keydown (`!repeat`), cleared on keyup. Also cleared on window
  `blur` and editor open (`startEditing`) so a lost keyup (alt-tab, macOS accent overlay)
  can't leave digits stuck routing to values. There is no `armedProp`: arrow navigation
  reads real focus via the radiogroup, so no separate "armed" variable is needed.

### Visual feedback

- Focused group: accent ring via `.tp-row:focus-within`; focused value: ring via
  `[role=radio]:focus-visible`. (Replaces the old `.armed` class.)
- While a letter is held, its row gets `.tp-row.chordable`, revealing a `1…N` badge
  (`.vidx`) on each value — the digit mapping shown exactly when digits are live. Swatches
  show the number centered with a halo; chips show it inline.
- Property labels underline the access letter (`.kbd-acc`) with a shortcut tooltip.

### Guards

- Handler returns early during text editing (`annoTextEdit`) and for events whose target is
  an `input`/`textarea`/`select` — typing is never hijacked.
- Letter handling only fires when the brush popover is visible.
- Letter/digit accelerators ignore `meta`/`ctrl`/`alt` combos.

## Scope

Single file, `index.html`: `makeRadioGroup()` + `syncRadios()`, the radiogroup wiring in
`makeEditorUI`, the editor keydown/keyup handlers, value-button badges, property labels, and
CSS for `.tp-row:focus-within` / `[role=radio]:focus-visible` / `.tp-row.chordable` /
`.vidx`. Replaces the earlier focus-armed `armedProp` model (custom arrow stepping, the
`.armed` highlight) with the standard radio pattern.
