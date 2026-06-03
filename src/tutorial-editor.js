import { state, newTutorialStep } from './state.js';
import { h } from './dom.js';
import { imageFiles, loadFile, clearPasteTarget, refreshSlot, setPasteTarget } from './images.js';
import { openAnnotator, annoLabel } from './annotator.js';

let hooks = {};
export function configureTutorialEditor(nextHooks) { hooks = nextHooks; }

// ---------- tutorial editor UI ----------
const tutorialRoot = document.getElementById("tutorialSteps");

export function addTutorialFiles(fileList) {
  const files = imageFiles(fileList);
  if (!files.length) return;
  const created = files.map(() => newTutorialStep());
  state.tutorial.steps.push(...created);
  buildTutorialEditor(); hooks.drawTutorialPreview();
  created.forEach((step, i) => loadFile(files[i], step.slot));
}

export function tutorialImageBlock(step, idx) {
  const slot = step.slot;
  const file = h("input", {
    type: "file", accept: "image/*", style: "display:none",
    onchange: (e) => { loadFile(e.target.files[0], slot); e.target.value = ""; },
  });
  const drop = h("div", {
    class: "slot",
    onclick: () => setPasteTarget(drop, slot),
    ondragover: (e) => { e.preventDefault(); drop.classList.add("drag"); },
    ondragleave: () => drop.classList.remove("drag"),
    ondrop: (e) => {
      e.preventDefault(); drop.classList.remove("drag");
      const files = imageFiles(e.dataTransfer.files);
      if (files[0]) loadFile(files[0], slot);
      if (files.length > 1) addTutorialFiles(files.slice(1));
    },
  });
  slot._el = drop;
  refreshSlot(slot);

  const cap = h("input", {
    type: "text", class: "cap", value: slot.caption || "", placeholder: "Step caption (optional)",
    oninput: (e) => { slot.caption = e.target.value; hooks.drawTutorialPreview(); },
  });
  const titleInput = h("input", {
    type: "text", value: step.title || "", placeholder: "Text after step number (optional)",
    oninput: (e) => { step.title = e.target.value; hooks.drawTutorialPreview(); },
  });
  const annoBtn = h("button", {
    class: "anno-btn tiny", disabled: slot.img ? null : "",
    title: "Draw boxes, arrows, numbers and labels on this image",
    onclick: () => openAnnotator(slot, annoBtn),
  }, annoLabel(slot));
  slot._annoBtn = annoBtn;

  const move = (dir) => {
    const j = idx + dir;
    if (j < 0 || j >= state.tutorial.steps.length) return;
    [state.tutorial.steps[idx], state.tutorial.steps[j]] = [state.tutorial.steps[j], state.tutorial.steps[idx]];
    buildTutorialEditor(); hooks.drawTutorialPreview();
  };
  const multi = state.tutorial.steps.length > 1;
  const head = h("div", { class: "change-head" },
    h("span", { class: "idx" }, `#${idx + 1}`),
    h("div", { class: "grow" }, titleInput),
    h("div", { class: "tools" },
      multi ? h("button", { class: "ghost tiny", title: "Move step up", onclick: () => move(-1) }, "↑") : null,
      multi ? h("button", { class: "ghost tiny", title: "Move step down", onclick: () => move(1) }, "↓") : null,
      h("button", { class: "ghost tiny", onclick: () => file.click() }, "Browse"),
      h("button", { class: "ghost tiny", onclick: () => clearSlot(slot) }, "Clear"),
      multi ? h("button", { class: "ghost tiny", title: "Delete step", onclick: () => { state.tutorial.steps.splice(idx, 1); buildTutorialEditor(); hooks.drawTutorialPreview(); } }, "✕") : null,
    ),
  );
  return h("div", { class: "tutorial-step" }, head, drop, file, h("div", { class: "slot-actions" }, annoBtn), cap);
}

export function buildTutorialEditor() {
  clearPasteTarget();
  tutorialRoot.innerHTML = "";
  const addDrop = h("div", {
    class: "step-drop",
    ondragover: (e) => { e.preventDefault(); addDrop.classList.add("drag"); },
    ondragleave: () => addDrop.classList.remove("drag"),
    ondrop: (e) => { e.preventDefault(); addDrop.classList.remove("drag"); addTutorialFiles(e.dataTransfer.files); },
  }, "Drop multiple images here to add them as numbered steps.");
  tutorialRoot.append(addDrop);
  state.tutorial.steps.forEach((step, idx) => tutorialRoot.append(tutorialImageBlock(step, idx)));
}
