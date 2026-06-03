// ---------- state ----------
export const uid = () => Math.random().toString(36).slice(2, 9);
export const newSlot = () => ({ caption: "", img: null, dataUrl: null, w: 0, h: 0, annotations: [], _el: null });
export const newPair = () => ({ id: uid(), before: newSlot(), after: newSlot() });
export const newChange = () => ({ id: uid(), title: "", pairs: [newPair()] });
export const newTutorialStep = () => ({ id: uid(), title: "", slot: newSlot() });
export const todayStr = () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export const state = {
  title: "",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  bg: "#ffffff",
  scale: 2,
  layout: "vertical",
  dateEnabled: false,
  dateText: todayStr(),
  changes: [newChange()],
  tutorial: {
    title: "",
    bg: "#ffffff",
    scale: 2,
    layout: "vertical",
    numbering: "numbers",
    steps: [],
  },
};



// ---------- session persistence ----------
const STORE_KEY = "beforeafter:v1";
let saveTimer = null;

export function snapshot() {
  return {
    v: 1,
    title: state.title, beforeLabel: state.beforeLabel, afterLabel: state.afterLabel,
    bg: state.bg, scale: state.scale, layout: state.layout,
    dateEnabled: state.dateEnabled, dateText: state.dateText,
    changes: state.changes.map((ch) => ({
      title: ch.title,
      pairs: ch.pairs.map((p) => ({
        before: { caption: p.before.caption, dataUrl: p.before.dataUrl, annotations: p.before.annotations },
        after: { caption: p.after.caption, dataUrl: p.after.dataUrl, annotations: p.after.annotations },
      })),
    })),
    tab: currentTab,
    anno: { dataUrl: annoDoc.dataUrl, annotations: annoDoc.annotations },
    tutorial: {
      title: state.tutorial.title,
      bg: state.tutorial.bg,
      scale: state.tutorial.scale,
      layout: state.tutorial.layout,
      numbering: state.tutorial.numbering,
      steps: state.tutorial.steps.map((step) => ({
        title: step.title || "",
        slot: { caption: step.slot.caption, dataUrl: step.slot.dataUrl, annotations: step.slot.annotations },
      })),
    },
  };
}
const serialize = () => JSON.stringify(snapshot());
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { sessionStorage.setItem(STORE_KEY, serialize()); }
    catch (e) { /* quota exceeded — skip persisting this update */ }
  }, 300);
}
export function restoreSlot(d = {}) {
  const s = newSlot();
  s.caption = d.caption || "";
  s.dataUrl = d.dataUrl || null;
  s.annotations = Array.isArray(d.annotations) ? d.annotations.map((a) => ({ ...a })) : [];
  return s;
}
export function applyState(d) {
  if (!d || !Array.isArray(d.changes)) return false;
  state.title = d.title || "";
  state.beforeLabel = d.beforeLabel != null ? d.beforeLabel : "BEFORE";
  state.afterLabel = d.afterLabel != null ? d.afterLabel : "AFTER";
  state.bg = d.bg || "#ffffff";
  state.scale = Number(d.scale) || 2;
  state.layout = (d.layout === "horizontal" || d.layout === "stacked") ? "horizontal" : "vertical";
  state.dateEnabled = !!d.dateEnabled;
  state.dateText = d.dateText != null ? d.dateText : todayStr();
  state.changes = d.changes.map((ch) => ({
    id: uid(), title: ch.title || "",
    pairs: (ch.pairs || []).map((p) => ({
      id: uid(), before: restoreSlot(p.before), after: restoreSlot(p.after),
    })),
  }));
  if (!state.changes.length) state.changes = [newChange()];
  const tut = d.tutorial || {};
  state.tutorial.title = tut.title || "";
  state.tutorial.bg = tut.bg || "#ffffff";
  state.tutorial.scale = Number(tut.scale) || 2;
  state.tutorial.layout = tut.layout === "horizontal" ? "horizontal" : "vertical";
  state.tutorial.numbering = tut.numbering === "letters" ? "letters" : "numbers";
  state.tutorial.steps = Array.isArray(tut.steps)
    ? tut.steps.map((step) => ({ id: uid(), title: step.title || "", slot: restoreSlot(step.slot || step) }))
    : [];
  currentTab = d.tab === "anno" ? "anno" : d.tab === "tut" ? "tut" : "ba";
  annoDoc.img = null; annoDoc.w = 0; annoDoc.h = 0;
  annoDoc.dataUrl = (d.anno && d.anno.dataUrl) || null;
  annoDoc.annotations = (d.anno && Array.isArray(d.anno.annotations)) ? d.anno.annotations.map((a) => ({ ...a })) : [];
  return true;
}
export function loadSaved() {
  let raw;
  try { raw = sessionStorage.getItem(STORE_KEY); } catch (e) { return false; }
  if (!raw) return false;
  try { return applyState(JSON.parse(raw)); } catch (e) { return false; }
}
// Replace the whole document from a parsed project object, then refresh the UI.
export function hydrateImages({ refreshSlot, drawPreview, drawTutorialPreview }) {
  state.changes.forEach((ch) => ch.pairs.forEach((p) => {
    [p.before, p.after].forEach((s) => {
      if (s.dataUrl && !s.img) {
        const img = new Image();
        img.onload = () => { s.img = img; s.w = img.naturalWidth; s.h = img.naturalHeight; refreshSlot(s); drawPreview(); };
        img.src = s.dataUrl;
      }
    });
  }));
  state.tutorial.steps.forEach((step) => {
    const s = step.slot;
    if (s.dataUrl && !s.img) {
      const img = new Image();
      img.onload = () => { s.img = img; s.w = img.naturalWidth; s.h = img.naturalHeight; refreshSlot(s); drawTutorialPreview(); };
      img.src = s.dataUrl;
    }
  });
}
export function syncControls() {
  document.getElementById("title").value = state.title;
  document.getElementById("beforeLabel").value = state.beforeLabel;
  document.getElementById("afterLabel").value = state.afterLabel;
  document.getElementById("bg").value = state.bg;
  document.getElementById("scale").value = String(state.scale);
  document.getElementById("layout").value = state.layout;
  document.getElementById("dateEnabled").checked = state.dateEnabled;
  document.getElementById("dateText").value = state.dateText;
}
export function syncTutorialControls() {
  document.getElementById("tutTitle").value = state.tutorial.title;
  document.getElementById("tutBg").value = state.tutorial.bg;
  document.getElementById("tutScale").value = String(state.tutorial.scale);
  document.getElementById("tutLayout").value = state.tutorial.layout;
  document.getElementById("tutNumbering").value = state.tutorial.numbering;
}
export function resetAll({ buildEditor, drawPreview }) {
  if (!confirm("Clear everything and start over? This can't be undone.")) return;
  try { sessionStorage.removeItem(STORE_KEY); } catch (e) {}
  state.title = ""; state.beforeLabel = "BEFORE"; state.afterLabel = "AFTER";
  state.bg = "#ffffff"; state.scale = 2; state.layout = "vertical";
  state.dateEnabled = false; state.dateText = todayStr(); state.changes = [newChange()];
  syncControls(); buildEditor(); drawPreview();
}
export function resetTutorial({ buildTutorialEditor, drawTutorialPreview }) {
  if (!confirm("Clear the tutorial and start over? This can't be undone.")) return;
  state.tutorial.title = "";
  state.tutorial.bg = "#ffffff";
  state.tutorial.scale = 2;
  state.tutorial.layout = "vertical";
  state.tutorial.numbering = "numbers";
  state.tutorial.steps = [];
  syncTutorialControls(); buildTutorialEditor(); drawTutorialPreview();
}

export function loadProject(d, actions) {
  if (!applyState(d)) { alert("That doesn't look like a valid project file."); return; }
  actions.syncControls();
  actions.syncTutorialControls();
  actions.buildEditor();
  actions.buildTutorialEditor();
  actions.hydrateImages();
  actions.drawPreview();
  actions.drawTutorialPreview();
}

export function setCurrentTab(tab) { currentTab = tab; }
export function getCurrentTab() { return currentTab; }
export function setAnnoDoc(data) { Object.assign(annoDoc, data); }

export let currentTab = "ba";
export const annoDoc = newSlot();
