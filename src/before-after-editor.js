import { state, newPair } from './state.js';
import { h } from './dom.js';
import { assignFiles, clearSlot, dropAddPair, imageFiles, clearPasteTarget, refreshSlot, setPasteTarget } from './images.js';
import { openAnnotator, annoLabel } from './annotator.js';
import { copyItems, downloadItems, dropdown, slug } from './export.js';

let hooks = {};
export function configureBeforeAfterEditor(nextHooks) { hooks = nextHooks; }

// ---------- editor UI ----------
const changesRoot = document.getElementById("changes");

export function imageColumn(slot, sibling, kind, labelText) {
  const file = h("input", {
    type: "file", accept: "image/*", multiple: "", style: "display:none",
    onchange: (e) => { assignFiles(e.target.files, slot, sibling); e.target.value = ""; },
  });
  const drop = h("div", {
    class: "slot",
    onclick: () => setPasteTarget(drop, slot),
    ondragover: (e) => { e.preventDefault(); drop.classList.add("drag"); },
    ondragleave: () => drop.classList.remove("drag"),
    ondrop: (e) => {
      e.preventDefault(); drop.classList.remove("drag");
      assignFiles(e.dataTransfer.files, slot, sibling);
    },
  });
  slot._el = drop;
  refreshSlot(slot);

  const cap = h("input", {
    type: "text", class: "cap", value: slot.caption || "", placeholder: "Caption (optional)",
    oninput: (e) => { slot.caption = e.target.value; hooks.drawPreview(); },
  });

  const annoBtn = h("button", {
    class: "anno-btn tiny", disabled: slot.img ? null : "",
    title: "Draw boxes, arrows, numbers and labels on this image",
    onclick: () => openAnnotator(slot, annoBtn),
  }, annoLabel(slot));
  slot._annoBtn = annoBtn;

  return h("div", { class: `img-col ${kind}` },
    h("span", { class: "col-tag" }, labelText),
    drop, file,
    h("div", { class: "slot-actions" },
      h("button", { class: "tiny", onclick: () => file.click() }, "Browse"),
      h("button", { class: "tiny", onclick: () => clearSlot(slot) }, "Clear"),
    ),
    annoBtn,
    cap,
  );
}

export function pairBlock(change, pair, pi) {
  const swap = () => {
    const p = change.pairs[pi];
    [p.before, p.after] = [p.after, p.before];
    buildEditor(); hooks.drawPreview();
  };
  const movePair = (dir) => {
    const j = pi + dir;
    if (j < 0 || j >= change.pairs.length) return;
    [change.pairs[pi], change.pairs[j]] = [change.pairs[j], change.pairs[pi]];
    buildEditor(); hooks.drawPreview();
  };
  const multi = change.pairs.length > 1;
  const head = h("div", { class: "pair-head" },
    h("span", { class: "tag" }, `Pair ${pi + 1}`),
    h("div", { class: "tools" },
      multi ? h("button", { class: "ghost tiny", title: "Move pair up", onclick: () => movePair(-1) }, "↑") : null,
      multi ? h("button", { class: "ghost tiny", title: "Move pair down", onclick: () => movePair(1) }, "↓") : null,
      h("button", { class: "ghost tiny", title: "Swap before and after", onclick: swap }, "⇄ Swap"),
      multi
        ? h("button", { class: "ghost tiny", onclick: () => { change.pairs.splice(pi, 1); buildEditor(); hooks.drawPreview(); } }, "Remove pair")
        : null,
    ),
  );
  return h("div", { class: "pair" },
    head,
    h("div", { class: "cols" },
      imageColumn(pair.before, pair.after, "before", state.beforeLabel || "Before"),
      imageColumn(pair.after, pair.before, "after", state.afterLabel || "After"),
    ),
  );
}

export function changeBlock(change, ci) {
  const titleInput = h("input", {
    type: "text", value: change.title || "", placeholder: `Change ${ci + 1} title (e.g. Navigation bar)`,
    oninput: (e) => { change.title = e.target.value; hooks.drawPreview(); },
  });

  const move = (dir) => {
    const j = ci + dir;
    if (j < 0 || j >= state.changes.length) return;
    [state.changes[ci], state.changes[j]] = [state.changes[j], state.changes[ci]];
    buildEditor(); hooks.drawPreview();
  };

  const head = h("div", { class: "change-head" },
    h("span", { class: "idx" }, `#${ci + 1}`),
    h("div", { class: "grow" }, titleInput),
    h("div", { class: "tools" },
      h("button", { class: "ghost tiny", title: "Move up", onclick: () => move(-1) }, "↑"),
      h("button", { class: "ghost tiny", title: "Move down", onclick: () => move(1) }, "↓"),
      dropdown("⧉ Copy", "ghost tiny", [{ items: copyItems(() => "", () => [change]) }]),
      dropdown("⬇ Download", "ghost tiny", [{ items: downloadItems(() => slug(change.title || "change"), () => "", () => [change]) }]),
      state.changes.length > 1
        ? h("button", { class: "ghost tiny", title: "Delete change", onclick: () => { state.changes.splice(ci, 1); buildEditor(); hooks.drawPreview(); } }, "✕")
        : null,
    ),
  );

  const pairs = h("div", {}, change.pairs.map((p, pi) => pairBlock(change, p, pi)));
  const addPair = h("button", {
    class: "add-pair",
    onclick: () => { change.pairs.push(newPair()); buildEditor(); hooks.drawPreview(); },
    ondragover: (e) => { e.preventDefault(); addPair.classList.add("drag"); },
    ondragleave: () => addPair.classList.remove("drag"),
    ondrop: (e) => {
      e.preventDefault(); addPair.classList.remove("drag");
      const files = imageFiles(e.dataTransfer.files);
      if (files.length) dropAddPair(change, files);
    },
  }, "+ Add before/after pair");

  return h("div", { class: "change" }, head, pairs, addPair);
}

export function buildEditor() {
  clearPasteTarget();
  changesRoot.innerHTML = "";
  state.changes.forEach((ch, ci) => changesRoot.append(changeBlock(ch, ci)));
}

