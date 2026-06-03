import { annoDoc, getCurrentTab, setCurrentTab, scheduleSave, uid } from './state.js';
import { h } from './dom.js';
import { blobFromCanvas, COPY_FORMATS, DL_FORMATS, EXT, RASTER, downloadBlob, dropdown, toast } from './export.js';
import { C, annoPrimitives, annNormBBox, annsExtent, buildById, drawAnnotations, drawOrder, drawPrim, font, markerLabel, resolveArrowEnds, resolveForRender, resolveTextStyle, setNbAspect, svgPrim, textMetrics, rgbaOf } from './rendering.js';

let hooks = {};
export function configureAnnotator(nextHooks) { hooks = nextHooks; }

// ---------- annotation editor (modal) ----------
export const annoLabel = (slot) => `✏ Annotate${slot.annotations.length ? ` (${slot.annotations.length})` : ""}`;
const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#111827", "#ffffff"];
// [id, label, shortcut]
const TOOLS = [["select", "Select", "1"], ["box", "▭ Box", "2"], ["arrow", "↗ Arrow", "3"], ["number", "① Number", "4"], ["text", "T Text", "5"]];
const TOOL_KEYS = ["select", "box", "arrow", "number", "text"];

let modalEls = null, inlineEls = null, editorHost = null;   // active editor host (modal or inline)
let annoSlot = null, annoBtnRef = null;
let annoWork = [], annoTool = "select", annoColor = "#ef4444";
let annoTextBgOn = false;
let annoLineStyle = "solid", annoLineWidth = "medium";
let annoStampStyle = "numbers";
let annoStampSize = 20;
let annoSel = new Set();          // selected indices
let annoDraft = null;             // in-progress new box/arrow
let annoAction = null;            // active gesture {kind,...}
let annoTextEdit = null;          // {i, isNew} when inline-editing a label
let annoHist = [], annoHistIdx = -1;
let annoDispW = 0, annoDispH = 0, annoDPR = 1;
let annoImgRect = { x: 0, y: 0, w: 0, h: 0 };   // image's on-screen rect (the pan/zoom transform)
let annoSpace = false;                           // space held → temporary pan mode

const cloneAnns = (arr) => arr.map((a) => ({ ...a }));
const selArr = () => [...annoSel];
const setSel = (arr) => { annoSel = new Set(arr); };
const N2DX = (nx) => annoImgRect.x + nx * annoImgRect.w;
const N2DY = (ny) => annoImgRect.y + ny * annoImgRect.h;
const D2NX = (dx) => (dx - annoImgRect.x) / annoImgRect.w;
const D2NY = (dy) => (dy - annoImgRect.y) / annoImgRect.h;
function evtPos(e) {
  const r = editorHost.canvas.getBoundingClientRect();
  return { dx: Math.max(0, Math.min(annoDispW, e.clientX - r.left)), dy: Math.max(0, Math.min(annoDispH, e.clientY - r.top)) };
}
function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function annoHit(a, dx, dy) {
  const rect = annoImgRect, k = rect.w / 560, X = (n) => rect.x + n * rect.w, Y = (n) => rect.y + n * rect.h;
  if (a.type === "box") { const x = X(a.x), y = Y(a.y); return dx >= x && dx <= x + a.w * rect.w && dy >= y && dy <= y + a.h * rect.h; }
  if (a.type === "number") { const r = (a.size || 20) * k; return Math.hypot(dx - X(a.x), dy - Y(a.y)) <= r; }
  if (a.type === "text") { const tm = textMetrics(a.text, (a.size || 22) * k), x = X(a.x), y = Y(a.y); return dx >= x && dx <= x + tm.w && dy >= y && dy <= y + tm.h; }
  if (a.type === "arrow") { const e = resolveArrowEnds(a, buildById(annoWork)); return distSeg(dx, dy, X(e.x1), Y(e.y1), X(e.x2), Y(e.y2)) <= Math.max(8, 6 * k); }
  return false;
}
function primsBBox(prims) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const ext = (x, y) => { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); };
  prims.forEach((p) => {
    if (p.k === "rect" || p.k === "pill") { ext(p.x, p.y); ext(p.x + p.w, p.y + p.h); }
    else if (p.k === "line") { ext(p.x1, p.y1); ext(p.x2, p.y2); }
    else if (p.k === "circle") { ext(p.cx - p.r, p.cy - p.r); ext(p.cx + p.r, p.cy + p.r); }
    else if (p.k === "poly") { p.pts.forEach((pt) => ext(pt[0], pt[1])); }
  });
  return { x: a, y: b, w: c - a, h: d - b };
}
const rectsIntersect = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ----- history -----
function pushHistory() {
  annoHist = annoHist.slice(0, annoHistIdx + 1);
  annoHist.push(cloneAnns(annoWork));
  if (annoHist.length > 80) annoHist.shift();
  annoHistIdx = annoHist.length - 1;
  commitLive();
}
function undo() { if (annoHistIdx <= 0) return; annoHistIdx--; annoWork = cloneAnns(annoHist[annoHistIdx]); setSel([]); redraw(); commitLive(); }
function redo() { if (annoHistIdx >= annoHist.length - 1) return; annoHistIdx++; annoWork = cloneAnns(annoHist[annoHistIdx]); setSel([]); redraw(); commitLive(); }

// ----- removal (bakes pinned arrow ends so they don't jump) -----
function removeAnns(indices) {
  const set = new Set(indices), ids = indices.map((j) => annoWork[j].id);
  const byId = buildById(annoWork);
  annoWork.forEach((a, j) => {
    if (set.has(j) || a.type !== "arrow") return;
    const e = resolveArrowEnds(a, byId);
    if (ids.includes(a.fromRef)) { a.x1 = e.x1; a.y1 = e.y1; a.fromRef = null; }
    if (ids.includes(a.toRef)) { a.x2 = e.x2; a.y2 = e.y2; a.toRef = null; }
  });
  annoWork = annoWork.filter((_, j) => !set.has(j));
  setSel([]);
}
function deleteSel() { if (!annoSel.size) return; removeAnns(selArr()); pushHistory(); redraw(); }
function clearAnno() { if (!annoWork.length) return; annoWork = []; setSel([]); pushHistory(); redraw(); }
function resetToSelect() { if (annoTool !== "number") annoTool = "select"; updateToolbar(); }

// ----- toolbar state -----
function updateToolbar() {
  const m = editorHost; if (!m) return;
  Object.entries(m.toolBtns).forEach(([id, b]) => b.classList.toggle("active", id === annoTool));
  m.canvas.classList.toggle("draw", annoTool !== "select");
}
function updateColors() { editorHost && editorHost.swatchEls.forEach((s) => s.classList.toggle("active", s._c === annoColor)); }
const selectedAnns = (types) => selArr().map((i) => annoWork[i]).filter((a) => a && types.includes(a.type));
const selectedLineAnns = () => selectedAnns(["box", "arrow"]);
const selectedTextAnns = () => selectedAnns(["text"]);
function curTextBgOn() {
  const texts = selectedTextAnns();
  if (texts.length === 1) return texts[0].bgOn !== undefined ? !!texts[0].bgOn : !!(texts[0].bg && texts[0].bg !== "none");
  return annoTextBgOn;
}
function curLineStyle() {
  const lines = selectedLineAnns();
  if (lines.length === 1) return lines[0].lineStyle || "solid";
  return annoLineStyle;
}
function curLineWidth() {
  const lines = selectedLineAnns();
  if (lines.length === 1) return lines[0].lineWidth || "medium";
  return annoLineWidth;
}
function curStampStyle() {
  return annoStampStyle;
}
function applyStampStyle(style) {
  annoStampStyle = style;
  const stamps = annoWork.filter((a) => a.type === "number");
  if (stamps.length) { stamps.forEach((a) => (a.style = style)); pushHistory(); }
  updateTextProps(); redraw();
}
function applyColor(c) {
  annoColor = c;
  const idx = selArr().filter((i) => annoWork[i]);
  if (idx.length) { idx.forEach((i) => { annoWork[i].color = c; }); pushHistory(); }
  updateTextProps(); redraw();
}
function applyTextBg(on) {
  annoTextBgOn = on;
  const texts = selectedTextAnns();
  if (texts.length) { texts.forEach((a) => { a.bgOn = on; delete a.bg; delete a.fg; }); pushHistory(); }
  updateTextProps(); redraw();
}
function applyLineStyle(style) {
  annoLineStyle = style;
  const lines = selectedLineAnns();
  if (lines.length) { lines.forEach((a) => (a.lineStyle = style)); pushHistory(); }
  updateTextProps(); redraw();
}
function applyLineWidth(width) {
  annoLineWidth = width;
  const lines = selectedLineAnns();
  if (lines.length) { lines.forEach((a) => (a.lineWidth = width)); pushHistory(); }
  updateTextProps(); redraw();
}
// brush config is shown when a drawing tool is active or an annotation is selected
function updateTextProps() {
  const m = editorHost; if (!m || !m.textPop) return;
  const show = annoTool !== "select" || annoSel.size > 0;   // hide the floating palette while idly selecting
  m.textPop.style.display = show ? "flex" : "none";
  if (!show) return;
  const textCtx = annoTool === "text" || selArr().some((i) => annoWork[i] && annoWork[i].type === "text");
  const stampCtx = annoTool === "number" || selArr().some((i) => annoWork[i] && annoWork[i].type === "number");
  const lineCtx = annoTool === "box" || annoTool === "arrow" || selArr().some((i) => annoWork[i] && (annoWork[i].type === "box" || annoWork[i].type === "arrow"));
  m.globalRow.style.display = "flex";
  m.textBgRow.style.display = textCtx ? "flex" : "none";
  m.stampRow.style.display = stampCtx ? "flex" : "none";
  m.lineStyleRow.style.display = lineCtx ? "flex" : "none";
  m.lineWidthRow.style.display = lineCtx ? "flex" : "none";
  updateColors();
  if (stampCtx) m.stampChips.forEach((s) => s.classList.toggle("active", s._style === curStampStyle()));
  if (textCtx) m.textBgChips.forEach((s) => s.classList.toggle("active", s._on === curTextBgOn()));
  if (lineCtx) {
    m.lineStyleChips.forEach((s) => s.classList.toggle("active", s._style === curLineStyle()));
    m.lineWidthChips.forEach((s) => s.classList.toggle("active", s._width === curLineWidth()));
  }
  syncRadios();   // keep aria-checked + roving tabindex in sync as values/contexts change
  updateChordUI();   // and the held-letter value badges
}
function setTool(id) { annoTool = id; if (id !== "select") setSel([]); disarmProps(); updateToolbar(); redraw(); }

// ----- handles for the single selected annotation -----
function selHandles() {
  if (annoSel.size !== 1) return [];
  const a = annoWork[selArr()[0]]; if (!a) return [];
  const byId = buildById(annoWork), hs = [];
  if (a.type === "arrow") {
    const e = resolveArrowEnds(a, byId);
    hs.push({ kind: "end", end: 1, x: N2DX(e.x1), y: N2DY(e.y1) });
    hs.push({ kind: "end", end: 2, x: N2DX(e.x2), y: N2DY(e.y2) });
    if (!a.fromRef) {   // only offer "add label at start" when the start isn't already linked
      const ang = Math.atan2(e.y1 - e.y2, e.x1 - e.x2);
      hs.push({ kind: "mkText", x: N2DX(e.x1) + Math.cos(ang) * 24, y: N2DY(e.y1) + Math.sin(ang) * 24 });
    }
  } else if (a.type === "box") {
    const bb = annNormBBox(a);
    [["nw", bb.x, bb.y], ["ne", bb.x + bb.w, bb.y], ["sw", bb.x, bb.y + bb.h], ["se", bb.x + bb.w, bb.y + bb.h]]
      .forEach(([c, nx, ny]) => hs.push({ kind: "resize", corner: c, x: N2DX(nx), y: N2DY(ny) }));
    hs.push({ kind: "mkArrow", x: N2DX(bb.x + bb.w) + 16, y: N2DY(bb.y + bb.h / 2) });
  } else if (a.type === "text") {
    const pb = primsBBox(annoPrimitives(annoImgRect, a));   // display-px box of the rendered label, so handles sit on its edges
    [["nw", pb.x, pb.y], ["ne", pb.x + pb.w, pb.y], ["sw", pb.x, pb.y + pb.h], ["se", pb.x + pb.w, pb.y + pb.h]]
      .forEach(([c, hx, hy]) => hs.push({ kind: "resizeText", corner: c, x: hx, y: hy }));
    hs.push({ kind: "mkArrow", x: pb.x + pb.w + 16, y: pb.y + pb.h / 2 });
  } else if (a.type === "number") {
    const bb = annNormBBox(a);
    [["nw", bb.x, bb.y], ["ne", bb.x + bb.w, bb.y], ["sw", bb.x, bb.y + bb.h], ["se", bb.x + bb.w, bb.y + bb.h]]
      .forEach(([c, nx, ny]) => hs.push({ kind: "resizeStamp", corner: c, x: N2DX(nx), y: N2DY(ny) }));
    hs.push({ kind: "mkArrow", x: N2DX(bb.x + bb.w) + 16, y: N2DY(bb.y + bb.h / 2) });
  }
  return hs;
}

function redraw() {
  const m = editorHost; if (!m || !annoSlot) return;
  setNbAspect(annoImgRect.h ? annoImgRect.w / annoImgRect.h : 1);
  const ctx = m.ctx;
  ctx.setTransform(annoDPR, 0, 0, annoDPR, 0, 0);
  ctx.fillStyle = "#e9eef4"; ctx.fillRect(0, 0, annoDispW, annoDispH);
  ctx.drawImage(annoSlot.img, annoImgRect.x, annoImgRect.y, annoImgRect.w, annoImgRect.h);
  ctx.strokeStyle = "rgba(15,23,42,.25)"; ctx.lineWidth = 1;
  ctx.strokeRect(annoImgRect.x + 0.5, annoImgRect.y + 0.5, annoImgRect.w - 1, annoImgRect.h - 1);
  const byId = buildById(annoWork);
  drawOrder(annoWork).forEach((i) => {
    if (annoTextEdit && annoTextEdit.i === i) return;
    annoPrimitives(annoImgRect, resolveForRender(annoWork[i], byId)).forEach((p) => drawPrim(ctx, p));
  });
  if (annoDraft) annoPrimitives(annoImgRect, annoDraft).forEach((p) => drawPrim(ctx, p));
  annoSel.forEach((i) => {
    if (annoTextEdit && annoTextEdit.i === i) return;
    const a = annoWork[i]; if (!a) return;
    const bb = primsBBox(annoPrimitives(annoImgRect, resolveForRender(a, byId))), pad = 4;
    ctx.save(); ctx.strokeStyle = "#4f46e5"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.strokeRect(bb.x - pad, bb.y - pad, bb.w + pad * 2, bb.h + pad * 2); ctx.restore();
  });
  if (annoAction && annoAction.kind === "band") {
    const A = annoAction;
    const rx = N2DX(Math.min(A.x0, A.x1)), ry = N2DY(Math.min(A.y0, A.y1));
    const rw = Math.abs(A.x1 - A.x0) * annoImgRect.w, rh = Math.abs(A.y1 - A.y0) * annoImgRect.h;
    ctx.save(); ctx.fillStyle = "rgba(79,70,229,.12)"; ctx.strokeStyle = "#4f46e5"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.fillRect(rx, ry, rw, rh); ctx.strokeRect(rx, ry, rw, rh); ctx.restore();
  }
  selHandles().forEach((hd) => {
    ctx.save();
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#4f46e5"; ctx.lineWidth = 2;
    if (hd.kind === "resize" || hd.kind === "resizeText" || hd.kind === "resizeStamp") {
      ctx.beginPath(); ctx.rect(hd.x - 5, hd.y - 5, 10, 10); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(hd.x, hd.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (hd.kind === "mkText" || hd.kind === "mkArrow") {
        ctx.fillStyle = "#4f46e5"; ctx.font = font(700, 11); ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(hd.kind === "mkText" ? "T" : "→", hd.x, hd.y + 0.5);
      }
    }
    ctx.restore();
  });
  if (annoTextEdit && annoWork[annoTextEdit.i]) positionTextInput(annoWork[annoTextEdit.i]);
  updateTextProps();
}

// ----- pinning helpers -----
function pinEndpointIfOver(a, end) {
  const ex = end === 1 ? a.x1 : a.x2, ey = end === 1 ? a.y1 : a.y2;
  const dx = N2DX(ex), dy = N2DY(ey);
  for (let i = annoWork.length - 1; i >= 0; i--) {
    const t = annoWork[i];
    if (t === a || !(t.type === "box" || t.type === "text" || t.type === "number")) continue;
    if (annoHit(t, dx, dy)) { if (end === 1) a.fromRef = t.id; else a.toRef = t.id; return; }
  }
  if (end === 1) a.fromRef = null; else a.toRef = null;
}

// ----- inline text editing -----
function positionTextInput(a) {
  const inp = editorHost.input, cv = editorHost.canvas, k = annoImgRect.w / 560, st = resolveTextStyle(a);
  const left = cv.offsetLeft + N2DX(a.x), top = cv.offsetTop + N2DY(a.y);
  const displaySize = Math.max(15, st.size * k);
  const padX = displaySize * 10 / 22, padY = displaySize * 6 / 22, lineH = displaySize * 1.2;
  const lines = String(inp.value || " ").split("\n");
  meas.font = font(700, displaySize);
  const textW = Math.max(1, ...lines.map((ln) => meas.measureText(ln || " ").width));
  const wantedW = Math.ceil(textW + padX * 2 + 2);
  const wantedH = Math.ceil(lines.length * lineH + padY * 2 + 2);
  const maxW = Math.max(60, cv.offsetLeft + cv.offsetWidth - left - 6);
  inp.style.left = left + "px";
  inp.style.top = top + "px";
  inp.style.fontSize = displaySize + "px";
  inp.style.lineHeight = "1.2";
  inp.style.padding = `${padY}px ${padX}px`;
  inp.style.width = Math.max(50, Math.min(wantedW, maxW)) + "px";
  inp.style.height = wantedH + "px";
  inp.style.color = st.fg;
  if (st.hasBg) { inp.style.background = st.bg; inp.style.borderRadius = "14px"; inp.style.textShadow = "none"; }
  else { const hl = rgbaOf(st.haloColor, st.haloOpacity); inp.style.background = "transparent"; inp.style.borderRadius = "6px"; inp.style.textShadow = `0 0 3px ${hl},0 0 3px ${hl}`; }
}
function startTextEdit(i, isNew) {
  annoTextEdit = { i, isNew };
  const inp = editorHost.input;
  inp.value = annoWork[i].text || "";
  inp.style.display = "block";              // show before measuring so scrollHeight is valid (full line height from the start)
  positionTextInput(annoWork[i]);
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
function commitTextEdit() {
  if (!annoTextEdit) return;
  const { i } = annoTextEdit, a = annoWork[i], val = editorHost.input.value.trim();
  annoTextEdit = null; editorHost.input.style.display = "none";
  if (!a) return;
  if (!val) removeAnns([i]); else a.text = val;
  pushHistory(); resetToSelect(); redraw();
}
function cancelTextEdit() {
  if (!annoTextEdit) return;
  const { i, isNew } = annoTextEdit, a = annoWork[i];
  annoTextEdit = null; editorHost.input.style.display = "none";
  if (isNew && a && !(a.text || "").trim()) { removeAnns([i]); pushHistory(); }
  resetToSelect(); redraw();
}

// ----- gesture start from a handle -----
function startHandle(hd, nx, ny) {
  const a = annoWork[selArr()[0]];
  if (hd.kind === "end") {
    annoAction = { kind: "endpoint", end: hd.end, i: selArr()[0] };
  } else if (hd.kind === "mkText") {
    const e = resolveArrowEnds(a, buildById(annoWork));
    const t = { id: uid(), type: "text", x: e.x1, y: e.y1, text: "", size: 22, color: annoColor, bgOn: annoTextBgOn };
    annoWork.push(t); a.fromRef = t.id;
    setSel([annoWork.length - 1]); startTextEdit(annoWork.length - 1, true);
  } else if (hd.kind === "mkArrow") {
    const arr = { id: uid(), type: "arrow", x1: nx, y1: ny, x2: nx, y2: ny, color: annoColor, lineStyle: annoLineStyle, lineWidth: annoLineWidth };
    if (a.type === "text") { arr.fromRef = a.id; annoAction = { kind: "arrowHandle", i: annoWork.length, end: 2 }; }
    else { arr.toRef = a.id; annoAction = { kind: "arrowHandle", i: annoWork.length, end: 1 }; }
    annoWork.push(arr); setSel([annoWork.length - 1]);
  } else if (hd.kind === "resize") {
    const ox = hd.corner.includes("w") ? a.x + a.w : a.x;
    const oy = hd.corner.includes("n") ? a.y + a.h : a.y;
    annoAction = { kind: "resize", i: selArr()[0], ox, oy };
  } else if (hd.kind === "resizeText") {
    // corner-drag uniformly scales the label's font size, anchored (in display px) at the opposite corner
    const pb = primsBBox(annoPrimitives(annoImgRect, a));
    const ax = hd.corner.includes("w") ? pb.x + pb.w : pb.x;
    const ay = hd.corner.includes("n") ? pb.y + pb.h : pb.y;
    annoAction = { kind: "resizeText", i: selArr()[0], corner: hd.corner, ax, ay, size0: a.size || 22, diag0: Math.hypot(pb.w, pb.h) };
  } else if (hd.kind === "resizeStamp") {
    const cx = N2DX(a.x), cy = N2DY(a.y);
    annoAction = { kind: "resizeStamp", i: selArr()[0], cx, cy };
  }
  redraw();
}

function onAnnoDown(e) {
  e.preventDefault(); try { editorHost.canvas.setPointerCapture(e.pointerId); } catch (_) {}
  if (annoTextEdit) commitTextEdit();
  if (annoSpace || e.button === 1) {   // pan the plane
    annoAction = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: annoImgRect.x, oy: annoImgRect.y };
    editorHost.canvas.style.cursor = "grabbing"; return;
  }
  const { dx, dy } = evtPos(e), nx = D2NX(dx), ny = D2NY(dy);
  if (annoTool === "number") {
    for (const hd of selHandles().filter((h) => h.kind === "resizeStamp")) {
      if (Math.hypot(dx - hd.x, dy - hd.y) <= 12) { startHandle(hd, nx, ny); return; }
    }
  }
  if (annoTool === "select") {
    for (const hd of selHandles()) { if (Math.hypot(dx - hd.x, dy - hd.y) <= 12) { startHandle(hd, nx, ny); return; } }
    let hit = -1;
    const ord = drawOrder(annoWork);   // reverse render order → topmost (text) wins
    for (let k = ord.length - 1; k >= 0; k--) { if (annoHit(annoWork[ord[k]], dx, dy)) { hit = ord[k]; break; } }
    if (hit >= 0) {
      if (e.shiftKey) { annoSel.has(hit) ? annoSel.delete(hit) : annoSel.add(hit); }
      else if (!annoSel.has(hit)) setSel([hit]);
      annoAction = { kind: "move", startNX: nx, startNY: ny, orig: cloneAnns(annoWork) };
    } else { setSel([]); annoAction = { kind: "band", x0: nx, y0: ny, x1: nx, y1: ny }; }
    updateToolbar(); redraw(); return;
  }
  if (annoTool === "number") {
    const n = annoWork.filter((a) => a.type === "number").length + 1;
    annoWork.push({ id: uid(), type: "number", x: nx, y: ny, n, size: annoStampSize, style: annoStampStyle, color: annoColor }); setSel([annoWork.length - 1]);
    pushHistory(); redraw(); return;   // number tool stays active
  }
  if (annoTool === "text") {
    annoWork.push({ id: uid(), type: "text", x: nx, y: ny, text: "", size: 22, color: annoColor, bgOn: annoTextBgOn });
    setSel([annoWork.length - 1]); startTextEdit(annoWork.length - 1, true); return;
  }
  annoAction = { kind: "draw", startNX: nx, startNY: ny };
  annoDraft = annoTool === "box"
    ? { id: uid(), type: "box", x: nx, y: ny, w: 0, h: 0, color: annoColor, lineStyle: annoLineStyle, lineWidth: annoLineWidth }
    : { id: uid(), type: "arrow", x1: nx, y1: ny, x2: nx, y2: ny, color: annoColor, lineStyle: annoLineStyle, lineWidth: annoLineWidth };
}
function onAnnoMove(e) {
  if (!annoAction) return;
  if (annoAction.kind === "pan") { annoImgRect.x = annoAction.ox + (e.clientX - annoAction.sx); annoImgRect.y = annoAction.oy + (e.clientY - annoAction.sy); redraw(); return; }
  const { dx, dy } = evtPos(e), nx = D2NX(dx), ny = D2NY(dy), A = annoAction;
  if (A.kind === "draw") {
    const d = annoDraft;
    if (d.type === "box") { d.x = Math.min(A.startNX, nx); d.y = Math.min(A.startNY, ny); d.w = Math.abs(nx - A.startNX); d.h = Math.abs(ny - A.startNY); }
    else { d.x2 = nx; d.y2 = ny; }
  } else if (A.kind === "band") { A.x1 = nx; A.y1 = ny; computeBand(); }
  else if (A.kind === "move") {
    const ddx = nx - A.startNX, ddy = ny - A.startNY;
    annoSel.forEach((i) => { const a = annoWork[i], o = A.orig[i]; if (a.type === "arrow") { if (!a.fromRef) { a.x1 = o.x1 + ddx; a.y1 = o.y1 + ddy; } if (!a.toRef) { a.x2 = o.x2 + ddx; a.y2 = o.y2 + ddy; } } else { a.x = o.x + ddx; a.y = o.y + ddy; } });
  } else if (A.kind === "endpoint") {
    const a = annoWork[A.i];
    if (A.end === 1) { a.x1 = nx; a.y1 = ny; a.fromRef = null; } else { a.x2 = nx; a.y2 = ny; a.toRef = null; }
  } else if (A.kind === "arrowHandle") {
    const a = annoWork[A.i];
    if (A.end === 2) { a.x2 = nx; a.y2 = ny; } else { a.x1 = nx; a.y1 = ny; }
  } else if (A.kind === "resize") {
    const a = annoWork[A.i];
    a.x = Math.min(A.ox, nx); a.y = Math.min(A.oy, ny);
    a.w = Math.abs(nx - A.ox); a.h = Math.abs(ny - A.oy);
  } else if (A.kind === "resizeText") {
    const a = annoWork[A.i];
    const scale = A.diag0 ? Math.hypot(dx - A.ax, dy - A.ay) / A.diag0 : 1;   // display-px distance from the fixed anchor corner
    a.size = Math.max(6, A.size0 * scale);   // floor the size value (not a display clamp) so it can't collapse to 0
    const pb = primsBBox(annoPrimitives(annoImgRect, a));   // re-measure at the new size, keep the anchor corner put
    const left = A.corner.includes("e") ? A.ax : A.ax - pb.w;
    const top = A.corner.includes("s") ? A.ay : A.ay - pb.h;
    a.x = D2NX(left); a.y = D2NY(top);
  } else if (A.kind === "resizeStamp") {
    const a = annoWork[A.i], k = annoImgRect.w / 560;
    a.size = annoStampSize = Math.max(8, Math.hypot(dx - A.cx, dy - A.cy) / (k || 1));
  }
  redraw();
}
function computeBand() {
  const A = annoAction, r = { x: Math.min(A.x0, A.x1), y: Math.min(A.y0, A.y1), w: Math.abs(A.x1 - A.x0), h: Math.abs(A.y1 - A.y0) };
  const byId = buildById(annoWork), sel = [];
  annoWork.forEach((a, i) => {
    let bb;
    if (a.type === "arrow") { const e = resolveArrowEnds(a, byId); bb = { x: Math.min(e.x1, e.x2), y: Math.min(e.y1, e.y2), w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) }; }
    else bb = annNormBBox(a);
    if (rectsIntersect(r, bb)) sel.push(i);
  });
  setSel(sel);
}
function onAnnoUp() {
  const A = annoAction; if (!A) return; annoAction = null;
  if (A.kind === "pan") { editorHost.canvas.style.cursor = annoSpace ? "grab" : ""; return; }
  if (A.kind === "draw") {
    const d = annoDraft; annoDraft = null;
    const ok = d.type === "box" ? true : (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.015);
    if (ok) { annoWork.push(d); setSel([annoWork.length - 1]); if (d.type === "arrow") { pinEndpointIfOver(d, 1); pinEndpointIfOver(d, 2); } pushHistory(); }
    resetToSelect(); redraw(); return;
  }
  if (A.kind === "band") { updateToolbar(); redraw(); return; }
  if (A.kind === "resize" || A.kind === "resizeText" || A.kind === "resizeStamp") { pushHistory(); redraw(); return; }
  if (A.kind === "endpoint") { pinEndpointIfOver(annoWork[A.i], A.end); pushHistory(); redraw(); return; }
  if (A.kind === "arrowHandle") { pinEndpointIfOver(annoWork[A.i], A.end); pushHistory(); resetToSelect(); redraw(); return; }
  if (A.kind === "move") { pushHistory(); redraw(); return; }
}

// Build the shared editor chrome (toolbar + canvas + inline text input), wired to the shared
// handlers which read/write the active `editorHost`. Used by both the modal and the inline tab.
function makeEditorUI() {
  const canvas = h("canvas", { class: "anno-canvas" });
  const input = h("textarea", { class: "anno-input", rows: "1", wrap: "off", style: "display:none" });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();   // Enter commits; Shift+Enter adds a newline; Escape cancels
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitTextEdit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancelTextEdit(); }
  });
  input.addEventListener("input", () => { if (annoTextEdit) positionTextInput(annoWork[annoTextEdit.i]); });
  input.addEventListener("blur", () => { if (annoTextEdit) commitTextEdit(); });
  const toolBtns = {};
  const toolbar = h("div", { class: "modal-bar" });
  TOOLS.forEach(([id, label, key]) => {
    const b = h("button", { class: "tool", title: `${id} (${key})`, onclick: () => setTool(id) }, label, h("span", { class: "kbd" }, key));
    toolBtns[id] = b; toolbar.append(b);
  });
  toolbar.append(h("span", { class: "sep" }));
  // Floating brush popover (mounted over the canvas). Shared color plus contextual options.
  const swatchEls = [], textBgChips = [], stampChips = [], lineStyleChips = [], lineWidthChips = [];
  // Property label with its access-key letter underlined. Tap the letter to focus this group (then ←/→/Space), or hold it + a digit to pick the Nth value.
  const lbl = (t) => h("span", { class: "lbl", title: `Tap "${t[0].toLowerCase()}" then ←/→, or hold "${t[0].toLowerCase()}" + 1–9` }, h("span", { class: "kbd-acc" }, t[0]), t.slice(1));
  const globalSwatches = h("div", { class: "tp-swatches" });
  const COLOR_NAMES = { "#ef4444": "Red", "#f59e0b": "Amber", "#22c55e": "Green", "#3b82f6": "Blue", "#a855f7": "Purple", "#111827": "Black", "#ffffff": "White" };
  COLORS.forEach((c, i) => {
    const s = h("button", { class: "swatch", style: `background:${c}`, title: c, "aria-label": COLOR_NAMES[c] || c, onclick: () => applyColor(c) }, h("span", { class: "vidx" }, String(i + 1)));
    s._c = c; swatchEls.push(s); globalSwatches.append(s);
  });
  const globalRow = h("div", { class: "tp-row" }, lbl("Color"), globalSwatches);
  const textBgRow = h("div", { class: "tp-row" },
    lbl("Background"),
    h("div", { class: "tp-swatches" },
      (() => { const b = h("button", { class: "chip", onclick: () => applyTextBg(false) }, "Transparent", h("span", { class: "vidx" }, "1")); b._on = false; textBgChips.push(b); return b; })(),
      (() => { const b = h("button", { class: "chip", onclick: () => applyTextBg(true) }, "Opaque", h("span", { class: "vidx" }, "2")); b._on = true; textBgChips.push(b); return b; })(),
    ),
  );
  const stampRow = h("div", { class: "tp-row" },
    lbl("Stamp"),
    h("div", { class: "tp-swatches" },
      (() => { const b = h("button", { class: "chip", onclick: () => applyStampStyle("numbers") }, "123", h("span", { class: "vidx" }, "1")); b._style = "numbers"; stampChips.push(b); return b; })(),
      (() => { const b = h("button", { class: "chip", onclick: () => applyStampStyle("letters") }, "ABC", h("span", { class: "vidx" }, "2")); b._style = "letters"; stampChips.push(b); return b; })(),
    ),
  );
  const lineStyleRow = h("div", { class: "tp-row" },
    lbl("Style"),
    h("div", { class: "tp-swatches" },
      (() => { const b = h("button", { class: "chip", onclick: () => applyLineStyle("solid") }, "Line", h("span", { class: "vidx" }, "1")); b._style = "solid"; lineStyleChips.push(b); return b; })(),
      (() => { const b = h("button", { class: "chip", onclick: () => applyLineStyle("dashed") }, "Dash", h("span", { class: "vidx" }, "2")); b._style = "dashed"; lineStyleChips.push(b); return b; })(),
      (() => { const b = h("button", { class: "chip", onclick: () => applyLineStyle("dotted") }, "Dot", h("span", { class: "vidx" }, "3")); b._style = "dotted"; lineStyleChips.push(b); return b; })(),
    ),
  );
  const lineWidthRow = h("div", { class: "tp-row" },
    lbl("Width"),
    h("div", { class: "tp-swatches" },
      (() => { const b = h("button", { class: "chip", onclick: () => applyLineWidth("small") }, "S", h("span", { class: "vidx" }, "1")); b._width = "small"; lineWidthChips.push(b); return b; })(),
      (() => { const b = h("button", { class: "chip", onclick: () => applyLineWidth("medium") }, "M", h("span", { class: "vidx" }, "2")); b._width = "medium"; lineWidthChips.push(b); return b; })(),
      (() => { const b = h("button", { class: "chip", onclick: () => applyLineWidth("large") }, "L", h("span", { class: "vidx" }, "3")); b._width = "large"; lineWidthChips.push(b); return b; })(),
    ),
  );
  const textPop = h("div", { class: "text-pop" }, globalRow, textBgRow, stampRow, lineStyleRow, lineWidthRow);
  makeRadioGroup(globalSwatches, swatchEls, "Color");
  makeRadioGroup(textBgRow.querySelector(".tp-swatches"), textBgChips, "Text background");
  makeRadioGroup(stampRow.querySelector(".tp-swatches"), stampChips, "Stamp style");
  makeRadioGroup(lineStyleRow.querySelector(".tp-swatches"), lineStyleChips, "Line style");
  makeRadioGroup(lineWidthRow.querySelector(".tp-swatches"), lineWidthChips, "Line width");
  // Undo/redo/delete are keyboard-only (⌘Z / ⌘⇧Z / Del) — no toolbar buttons.
  const clrBtn = h("button", { class: "tool", onclick: clearAnno }, "Clear all");
  const zoomOutBtn = h("button", { class: "tool", title: "Zoom out", onclick: () => zoomBy(1 / 1.25) }, "−");
  const fitBtn = h("button", { class: "tool", title: "Fit image to view", onclick: () => { fitView(); redraw(); } }, "⤢ Fit");
  const zoomInBtn = h("button", { class: "tool", title: "Zoom in", onclick: () => zoomBy(1.25) }, "+");
  toolbar.append(clrBtn, h("span", { class: "sep" }), zoomOutBtn, fitBtn, zoomInBtn);
  canvas.addEventListener("pointerdown", onAnnoDown);
  canvas.addEventListener("pointermove", onAnnoMove);
  canvas.addEventListener("pointerup", onAnnoUp);
  canvas.addEventListener("wheel", onAnnoWheel, { passive: false });
  canvas.addEventListener("dblclick", (e) => {
    if (annoTool !== "select") return;
    const { dx, dy } = evtPos(e);
    for (let i = annoWork.length - 1; i >= 0; i--) { if (annoWork[i].type === "text" && annoHit(annoWork[i], dx, dy)) { setSel([i]); startTextEdit(i, false); redraw(); return; } }
  });
  return { canvas, input, toolbar, toolBtns, swatchEls, textPop, globalRow, textBgRow, textBgChips, stampRow, stampChips, lineStyleRow, lineStyleChips, lineWidthRow, lineWidthChips, ctx: canvas.getContext("2d") };
}
function ensureModal() {
  if (modalEls) return modalEls;
  const ui = makeEditorUI();
  const foot = h("div", { class: "modal-foot" },
    h("span", { class: "modal-hint" }, "scroll to pan · ⌃scroll / pinch to zoom · space-drag to pan · drag to draw or box-select · double-click a label to edit"),
    h("div", { style: "display:flex;gap:8px" },
      h("button", { onclick: () => closeAnnotator(false) }, "Cancel"),
      h("button", { class: "primary", onclick: () => closeAnnotator(true) }, "Done"),
    ),
  );
  const modal = h("div", { class: "modal" }, ui.toolbar, h("div", { class: "modal-canvas-wrap" }, ui.canvas, ui.input, ui.textPop), foot);
  const backdrop = h("div", { class: "modal-backdrop", onclick: (e) => { if (e.target === backdrop) closeAnnotator(false); } }, modal);
  document.body.append(backdrop);
  modalEls = Object.assign({ mode: "modal", backdrop }, ui);
  return modalEls;
}
function ensureInline() {
  if (inlineEls) return inlineEls;
  const ui = makeEditorUI();
  document.getElementById("annoEditor").append(ui.toolbar, h("div", { class: "modal-canvas-wrap", style: "border-radius:14px" }, ui.canvas, ui.input, ui.textPop));
  inlineEls = Object.assign({ mode: "inline", live: true }, ui);
  return inlineEls;
}

// The editor is a fixed-size viewport onto an infinite plane. annoImgRect is the image's
// on-screen rect, so panning translates it and zooming scales it about a point. Annotations
// (normalized to the image) map through annoImgRect, so they pan/zoom with it for free.
function setViewport() {
  const m = editorHost;
  annoDispW = Math.round(Math.min(window.innerWidth * 0.92, 1500));
  annoDispH = Math.round(window.innerHeight * 0.76);
  annoDPR = window.devicePixelRatio || 1;
  m.canvas.width = annoDispW * annoDPR; m.canvas.height = annoDispH * annoDPR;
  m.canvas.style.width = annoDispW + "px"; m.canvas.style.height = annoDispH + "px";
}
function fitView() {
  const s = Math.min(annoDispW / annoSlot.w, annoDispH / annoSlot.h) * 0.7;   // 70% leaves room to draw outside
  const w = annoSlot.w * s, h = annoSlot.h * s;
  annoImgRect = { x: (annoDispW - w) / 2, y: (annoDispH - h) / 2, w, h };
}
function zoomAt(cx, cy, f) {
  const nw = Math.max(60, Math.min(40000, annoImgRect.w * f)), rf = nw / annoImgRect.w;
  const nx = (cx - annoImgRect.x) / annoImgRect.w, ny = (cy - annoImgRect.y) / annoImgRect.h;
  annoImgRect.w *= rf; annoImgRect.h *= rf;
  annoImgRect.x = cx - nx * annoImgRect.w; annoImgRect.y = cy - ny * annoImgRect.h;
}
function zoomBy(f) { zoomAt(annoDispW / 2, annoDispH / 2, f); redraw(); }
function onAnnoWheel(e) {
  e.preventDefault();
  const r = editorHost.canvas.getBoundingClientRect();
  if (e.ctrlKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));  // pinch / ⌃scroll
  else { annoImgRect.x -= e.deltaX; annoImgRect.y -= e.deltaY; }                              // two-finger / wheel pan
  redraw();
}

// shared setup for either host
function startEditing(slot) {
  annoSlot = slot;
  annoWork = cloneAnns(slot.annotations); annoWork.forEach((a) => { if (!a.id) a.id = uid(); });
  const stamps = annoWork.filter((a) => a.type === "number");
  const lastStamp = stamps[stamps.length - 1];
  const lines = annoWork.filter((a) => a.type === "box" || a.type === "arrow");
  const lastLine = lines[lines.length - 1];
  const texts = annoWork.filter((a) => a.type === "text");
  const lastText = texts[texts.length - 1];
  annoTool = "select"; annoColor = "#ef4444";
  annoTextBgOn = lastText ? (lastText.bgOn !== undefined ? !!lastText.bgOn : !!(lastText.bg && lastText.bg !== "none")) : false;
  annoLineStyle = (lastLine && lastLine.lineStyle) || "solid";
  annoLineWidth = (lastLine && lastLine.lineWidth) || "medium";
  annoStampStyle = (lastStamp && lastStamp.style) || "numbers";
  annoStampSize = (lastStamp && lastStamp.size) || 20;
  setSel([]); annoDraft = null; annoAction = null; annoTextEdit = null; annoSpace = false; disarmProps();
  annoHist = []; annoHistIdx = -1; pushHistory();
  setViewport(); fitView();
  editorHost.input.style.display = "none";
  updateToolbar(); updateColors(); redraw();
}
export function openAnnotator(slot, btn) {   // modal (Before/After "Annotate")
  if (!slot.img) return;
  editorHost = ensureModal(); annoBtnRef = btn;
  startEditing(slot);
  editorHost.backdrop.classList.add("open");
}
export function closeAnnotator(commit) {
  if (!modalEls) return;
  if (annoTextEdit) commitTextEdit();
  modalEls.backdrop.classList.remove("open");
  if (commit && annoSlot) {
    annoSlot.annotations = annoWork;
    hooks.refreshSlot(annoSlot);
    if (annoBtnRef) annoBtnRef.textContent = annoLabel(annoSlot);
    hooks.renderActivePreview();
  }
  annoSlot = null; annoBtnRef = null; editorHost = null;
}
export function openInline() {               // Annotator tab (live editing)
  if (!annoDoc.img) return;
  editorHost = ensureInline(); annoBtnRef = null;
  startEditing(annoDoc);
}
// in the inline tab, edits apply to the document immediately (no Done step)
export function commitLive() { if (editorHost && editorHost.live && annoSlot) { annoSlot.annotations = cloneAnns(annoWork); scheduleSave(); } }

// Each value group is an ARIA radiogroup: role=radio + aria-checked + roving tabindex, so once a
// value has focus, ←/→/↑/↓/Home/End/Space navigate it the standard, accessible way, and the whole
// group is a single tab stop. (stopPropagation keeps Space selecting instead of toggling pan.)
function makeRadioGroup(container, buttons, label) {
  container.setAttribute("role", "radiogroup");
  container.setAttribute("aria-label", label);
  buttons.forEach((b) => { b.setAttribute("role", "radio"); b.setAttribute("aria-checked", "false"); b.tabIndex = -1; });
  container.addEventListener("keydown", (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    let j;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % buttons.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = buttons.length - 1;
    else return;   // Space (pan), digits (chord/tool) and letters (group switch) bubble to the editor handler
    e.preventDefault(); e.stopPropagation();
    buttons[j].click(); buttons[j].focus();   // selection follows focus; click() applies → syncRadios updates checked
  });
}
function syncRadios() {   // mirror each group's .active value onto aria-checked + roving tabindex (the focusable one)
  const m = editorHost; if (!m) return;
  [m.swatchEls, m.textBgChips, m.stampChips, m.lineStyleChips, m.lineWidthChips].forEach((grp) => {
    let sel = grp.findIndex((b) => b.classList.contains("active"));
    if (sel < 0) sel = 0;
    grp.forEach((b, k) => { b.setAttribute("aria-checked", k === sel ? "true" : "false"); b.tabIndex = k === sel ? 0 : -1; });
  });
}

// Keyboard accelerators layered on the radiogroups. Digits map to a property's values ONLY while
// its letter is held (a chord, e.g. c+3 = 3rd colour) — never via focus — so clicking or tabbing
// to a value never changes what a digit does (it still switches tools). Tapping a letter just
// moves focus into that group's selected value, where the standard radio arrows take over.
let heldProp = null;
function visibleGroup(k) {   // resolve a letter to its currently-visible [row, buttons]; s = style|stamp by context
  const m = editorHost;
  const cands = ({
    c: [[m.globalRow, m.swatchEls]],
    b: [[m.textBgRow, m.textBgChips]],
    s: [[m.lineStyleRow, m.lineStyleChips], [m.stampRow, m.stampChips]],
    w: [[m.lineWidthRow, m.lineWidthChips]],
  })[k] || [];
  for (const [row, grp] of cands) if (row.style.display !== "none" && grp.length) return [row, grp];
  return null;
}
function updateChordUI() {   // reveal the 1…N value badges on the row whose letter is currently held
  const m = editorHost; if (!m || !m.textPop) return;
  const heldRow = heldProp && visibleGroup(heldProp) && visibleGroup(heldProp)[0];
  [m.globalRow, m.textBgRow, m.stampRow, m.lineStyleRow, m.lineWidthRow].forEach((r) => r.classList.toggle("chordable", r === heldRow));
}
// Called on editor open and window blur so a held letter whose keyup is lost (alt-tab, macOS accent
// overlay) can't leave digits stuck routing to values instead of switching tools.
export function disarmProps() { if (heldProp) { heldProp = null; updateChordUI(); } }
function focusGroup(grp) { (grp.find((b) => b.getAttribute("aria-checked") === "true") || grp[0]).focus(); }   // enter at the selected value
document.addEventListener("keydown", (e) => {
  if (!editorHost || annoTextEdit) return;
  if (/^(input|textarea|select)$/i.test(e.target.tagName)) return;   // never hijack typing in a field
  const popOpen = editorHost.textPop && editorHost.textPop.style.display !== "none";
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
  if (e.key === "Escape") { editorHost.mode === "modal" ? closeAnnotator(false) : (setSel([]), redraw()); }
  else if (e.key === "Enter") { if (editorHost.mode === "modal") closeAnnotator(true); }
  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSel(); }
  else if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); }
  else if (heldProp && plain && e.key >= "1" && e.key <= "9") {   // chord: hold a letter, press a digit → Nth value
    const g = visibleGroup(heldProp); e.preventDefault();
    const n = +e.key - 1;
    if (g && n < g[1].length) { g[1][n].click(); g[1][n].focus(); }
  }
  else if (plain && e.key >= "1" && e.key <= "5") { e.preventDefault(); setTool(TOOL_KEYS[+e.key - 1]); }   // digit, no letter held → tool
  else if (plain && /^[cbsw]$/.test(e.key) && popOpen) {   // tap/hold a property letter → focus its group (and arm the chord)
    const g = visibleGroup(e.key);
    if (g) { e.preventDefault(); if (!e.repeat) { heldProp = e.key; focusGroup(g[1]); updateChordUI(); } }
  }
  else if (e.key === " ") { e.preventDefault(); annoSpace = true; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); editorHost.canvas.style.cursor = "grab"; }
});
document.addEventListener("keyup", (e) => {
  if (e.key === " " && annoSpace) { annoSpace = false; if (editorHost && (!annoAction || annoAction.kind !== "pan")) editorHost.canvas.style.cursor = ""; }
  else if (heldProp && e.key === heldProp) { heldProp = null; updateChordUI(); }   // letter released → digits go back to tools
});
window.addEventListener("blur", disarmProps);   // a lost keyup must never leave a letter stuck "held"

// ---------- Annotator tab ----------
export function setAnnoImage(dataUrl) {
  const img = new Image();
  img.onload = () => { annoDoc.img = img; annoDoc.dataUrl = dataUrl; annoDoc.w = img.naturalWidth; annoDoc.h = img.naturalHeight; if (getCurrentTab() === "anno") enterAnnotator(); scheduleSave(); };
  img.src = dataUrl;
}
export function isAnnotatorTextEditing() { return !!annoTextEdit; }
export function loadAnnoFile(file) { if (!file || !file.type.startsWith("image/")) return; const r = new FileReader(); r.onload = () => setAnnoImage(r.result); r.readAsDataURL(file); }
export function enterAnnotator() {
  const hasImg = !!annoDoc.img;
  document.getElementById("annoDrop").hidden = hasImg;
  document.getElementById("annoEditor").hidden = !hasImg;
  document.getElementById("annoFoot").hidden = !hasImg;
  if (hasImg) openInline(); else editorHost = null;
}
export function leaveAnnotator() { if (annoTextEdit) commitTextEdit(); if (editorHost && editorHost.mode === "inline") editorHost = null; }
export const TAB_INFO = {
  ba: { title: "Before / After Builder", sub: "Compose before/after screenshots into a single shareable PNG — entirely in your browser, nothing uploaded." },
  anno: { title: "Annotator", sub: "Annotate a screenshot with boxes, arrows, numbers and labels, then export it — entirely in your browser, nothing uploaded." },
  tut: { title: "Tutorial Builder", sub: "Upload, annotate and reorder screenshots into a numbered tutorial — entirely in your browser, nothing uploaded." },
};
// ---------- path routing: each tool gets its own clean URL (/before-after/, /annotator/, /tutorial/) ----------
export const TAB_SLUG = { ba: "before-after", anno: "annotator", tut: "tutorial" };
const slugToTab = (s) => (s === "annotator" ? "anno" : s === "before-after" ? "ba" : s === "tutorial" ? "tut" : null);
export const tabFromHash = () => slugToTab(location.hash.replace(/^#\/?/, ""));
export function tabFromPath(pathname = location.pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const last = parts.at(-1);
  if (last === "index.html") return slugToTab(parts.at(-2));
  return slugToTab(last);
}
export const tabFromLocation = () => tabFromPath() || tabFromHash();
function routeBasePath() {
  let path = location.pathname;
  if (!path.endsWith("/")) path = path.replace(/[^/]*$/, "");
  const parts = path.split("/").filter(Boolean);
  if (slugToTab(parts.at(-1))) parts.pop();
  return `/${parts.join("/")}${parts.length ? "/" : ""}`;
}
function routePath(tab) {
  return `${routeBasePath()}${TAB_SLUG[tab]}/`;
}
// Navigate to a tab by updating the path; the popstate listener handles browser back/forward.
export function navTo(t) {
  const tab = TAB_INFO[t] ? t : "ba";
  const want = routePath(tab);
  if (location.pathname === want) showTab(tab);
  else {
    history.pushState(null, "", want);
    showTab(tab);
  }
}
export function showTab(t) {
  setCurrentTab(TAB_INFO[t] ? t : "ba");
  const currentTab = getCurrentTab();
  document.getElementById("tab-ba").hidden = currentTab !== "ba";
  document.getElementById("tab-anno").hidden = currentTab !== "anno";
  document.getElementById("tab-tut").hidden = currentTab !== "tut";
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === currentTab));
  document.getElementById("modeTitle").textContent = TAB_INFO[currentTab].title;
  document.getElementById("modeSub").textContent = TAB_INFO[currentTab].sub;
  getCurrentTab() === "anno" ? enterAnnotator() : leaveAnnotator();
  if (currentTab === "tut") hooks.drawTutorialPreview();
  scheduleSave();
}

// ---- Annotator export: the single image with annotations baked in ----
export function annotatedCanvas(fmt) {
  const slot = annoDoc, S = 2;
  setNbAspect(slot.h ? slot.w / slot.h : 1);
  const ext = annsExtent(slot.annotations);
  const W = (ext.x1 - ext.x0) * slot.w, H = (ext.y1 - ext.y0) * slot.h;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(W * S)); cv.height = Math.max(1, Math.round(H * S));
  const ctx = cv.getContext("2d"); ctx.setTransform(S, 0, 0, S, 0, 0);
  if (fmt !== "png") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H); }   // jpeg/webp need an opaque bg
  const ix = (0 - ext.x0) * slot.w, iy = (0 - ext.y0) * slot.h;
  ctx.drawImage(slot.img, ix, iy, slot.w, slot.h);
  drawAnnotations(ctx, { x: ix, y: iy, w: slot.w, h: slot.h }, slot.annotations);
  return cv;
}
export function annotatedSVG() {
  const slot = annoDoc;
  setNbAspect(slot.h ? slot.w / slot.h : 1);
  const ext = annsExtent(slot.annotations);
  const W = (ext.x1 - ext.x0) * slot.w, H = (ext.y1 - ext.y0) * slot.h;
  const ix = (0 - ext.x0) * slot.w, iy = (0 - ext.y0) * slot.h;
  const rect = { x: ix, y: iy, w: slot.w, h: slot.h }, byId = buildById(slot.annotations);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
  out.push(`<image x="${ix}" y="${iy}" width="${slot.w}" height="${slot.h}" preserveAspectRatio="none" xlink:href="${slot.img.src}"/>`);
  drawOrder(slot.annotations).forEach((i) => annoPrimitives(rect, resolveForRender(slot.annotations[i], byId)).forEach((p) => out.push(svgPrim(p))));
  out.push("</svg>");
  return out.join("");
}
export function annoExportDownload(fmt) {
  if (!annoDoc.img) return;
  if (fmt === "svg") { downloadBlob(new Blob([annotatedSVG()], { type: "image/svg+xml" }), "annotated.svg"); return; }
  annotatedCanvas(fmt).toBlob((b) => b && downloadBlob(b, `annotated.${EXT[fmt]}`), RASTER[fmt], fmt === "png" ? undefined : 0.92);
}
export async function annoExportCopy(fmt) {
  if (!annoDoc.img) return;
  try {
    if (fmt === "svg") { await navigator.clipboard.writeText(annotatedSVG()); toast("Copied SVG markup"); return; }
    const blob = await blobFromCanvas(annotatedCanvas(fmt), RASTER[fmt], fmt === "png" ? undefined : 0.92);
    await navigator.clipboard.write([new ClipboardItem({ [RASTER[fmt]]: blob })]);
    toast(`Copied ${fmt.toUpperCase()} to clipboard`);
  } catch (e) { toast(fmt === "png" ? "Copy failed" : "Copy failed — browser may only allow PNG"); }
}
export function buildAnnoActions() {
  const bar = document.getElementById("annoActions"); bar.innerHTML = "";
  bar.append(
    dropdown("⧉ Copy", "", [{ items: COPY_FORMATS.map(([f, l]) => ({ label: l, onClick: () => annoExportCopy(f) })) }]),
    dropdown("⬇ Download", "primary", [{ items: DL_FORMATS.map(([f, l]) => ({ label: l, onClick: () => annoExportDownload(f) })) }]),
  );
}
export function hydrateAnno() {
  if (annoDoc.dataUrl && !annoDoc.img) {
    const img = new Image();
    img.onload = () => { annoDoc.img = img; annoDoc.w = img.naturalWidth; annoDoc.h = img.naturalHeight; if (getCurrentTab() === "anno") enterAnnotator(); };
    img.src = annoDoc.dataUrl;
  }
}
