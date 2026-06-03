import { state, uid } from './state.js';
import { drawAnnotations } from './rendering.js';

let activePaste = null; // { el, obj }
let hooks = {};
export function configureImageHooks(nextHooks) { hooks = nextHooks; }
export function clearPasteTarget() { activePaste = null; }

// ---------- image loading ----------
export function loadFile(file, slot) {
  if (!file || !file.type.startsWith("image/")) return;
  const r = new FileReader();
  r.onload = () => setSlotImage(slot, r.result);
  r.readAsDataURL(file);
}
export const imageFiles = (fileList) => [...fileList].filter((f) => f.type.startsWith("image/"));
const pairsNeeded = (n) => Math.max(1, Math.ceil(n / 2));

// Drop/select N images onto one slot: first fills this slot, second fills its pair sibling.
export function assignFiles(fileList, slot, sibling) {
  const files = imageFiles(fileList);
  if (files[0]) loadFile(files[0], slot);
  if (files[1] && sibling) loadFile(files[1], sibling);
}
// Distribute images across pair objects: before, after, before, after...
export function fillPairs(pairs, files) {
  files.forEach((f, i) => {
    const p = pairs[Math.floor(i / 2)];
    if (p) loadFile(f, i % 2 === 0 ? p.before : p.after);
  });
}
// Drop onto "Add pair": create enough pairs to hold the images, then fill them.
export function dropAddPair(change, files) {
  const created = [];
  for (let i = 0; i < pairsNeeded(files.length); i++) { const p = newPair(); change.pairs.push(p); created.push(p); }
  hooks.buildEditor(); hooks.drawPreview();
  fillPairs(created, files);
}
// Drop onto "Add change": create a new change holding the images.
export function dropAddChange(files) {
  const ch = { id: uid(), title: "", pairs: [] };
  for (let i = 0; i < pairsNeeded(files.length); i++) ch.pairs.push(newPair());
  state.changes.push(ch);
  hooks.buildEditor(); hooks.drawPreview();
  fillPairs(ch.pairs, files);
}
function renderActivePreview() {
  hooks.getCurrentTab() === "tut" ? hooks.drawTutorialPreview() : hooks.drawPreview();
}
export function setSlotImage(slot, dataUrl) {
  const img = new Image();
  img.onload = () => {
    slot.img = img; slot.dataUrl = dataUrl;
    slot.w = img.naturalWidth; slot.h = img.naturalHeight;
    refreshSlot(slot);
    renderActivePreview();
  };
  img.src = dataUrl;
}
export function clearSlot(slot) {
  slot.img = null; slot.dataUrl = null; slot.w = 0; slot.h = 0;
  refreshSlot(slot);
  renderActivePreview();
}
export function drawSlotAnnotations(slot) {
  const el = slot._el, cv = slot._overlay;
  if (!el || !cv || !slot.img) return;
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) { requestAnimationFrame(() => drawSlotAnnotations(slot)); return; }
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + "px"; cv.style.height = h + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const s = Math.min(w / slot.w, h / slot.h);
  const iw = slot.w * s, ih = slot.h * s;
  drawAnnotations(ctx, { x: (w - iw) / 2, y: (h - ih) / 2, w: iw, h: ih }, slot.annotations);
}
export function refreshSlot(slot) {
  const el = slot._el;
  if (!el) return;
  if (slot.dataUrl) {
    el.classList.add("filled");
    el.style.backgroundImage = `url(${slot.dataUrl})`;
    el.innerHTML = "";
    slot._overlay = h("canvas", { class: "slot-anno-overlay" });
    el.append(slot._overlay);
    requestAnimationFrame(() => drawSlotAnnotations(slot));
  } else {
    el.classList.remove("filled");
    el.style.backgroundImage = "";
    slot._overlay = null;
    el.innerHTML = `<span class="hint"><b>Click to select</b><br>then paste, or drop / browse an image</span>`;
  }
  if (slot._annoBtn) { slot._annoBtn.disabled = !slot.img; slot._annoBtn.textContent = annoLabel(slot); }
}
export function refreshAllSlotAnnotations() {
  state.changes.forEach((ch) => ch.pairs.forEach((p) => {
    drawSlotAnnotations(p.before);
    drawSlotAnnotations(p.after);
  }));
  state.tutorial.steps.forEach((step) => drawSlotAnnotations(step.slot));
}
export function setPasteTarget(el, obj) {
  if (activePaste && activePaste.el) activePaste.el.classList.remove("paste-target");
  activePaste = { el, obj };
  el.classList.add("paste-target");
}
document.addEventListener("paste", (e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  if (hooks.getCurrentTab && hooks.getCurrentTab() === "anno" && !(hooks.isAnnotatorTextEditing && hooks.isAnnotatorTextEditing())) {   // paste an image into the Annotator
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f && hooks.loadAnnoFile) { hooks.loadAnnoFile(f); e.preventDefault(); } break; }
    }
    return;
  }
  if (!activePaste) return;
  for (const it of items) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) { loadFile(f, activePaste.obj); e.preventDefault(); }
      break;
    }
  }
});
