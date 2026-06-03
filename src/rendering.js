import { state } from './state.js';

// ---------- layout + canvas rendering ----------
const meas = document.createElement("canvas").getContext("2d");
export const FAMILY = `system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;
export const SVG_FAM = FAMILY.replace(/"/g, "'");
export const font = (weight, size) => `${weight} ${size}px ${FAMILY}`;

export function wrap(text, f, maxW) {
  meas.font = f;
  const out = [];
  String(text).split("\n").forEach((para) => {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); return; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const t = line + " " + words[i];
      if (meas.measureText(t).width > maxW) { out.push(line); line = words[i]; }
      else line = t;
    }
    out.push(line);
  });
  return out;
}

export function rr(ctx, x, y, w, h_, r) {
  r = Math.min(r, w / 2, h_ / 2);
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h_, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h_, r);
  ctx.arcTo(x + w, y + h_, x, y + h_, r);
  ctx.arcTo(x, y + h_, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const C = {
  PAD: 48, TITLE: 52, CHANGE: 34, LABEL: 22, CAP: 19,
  cellW: 560, pairGap: 36, rowGap: 40, changeGap: 60, titleGap: 40,
  ctitleGap: 24, labelGap: 14, capGap: 14, maxImgH: 680, lh: 1.3, radius: 10,
  stackGap: 28,
};

// Lay out one before/after image into a column `cw` wide, anchored at (x, y). Returns its height.
export function blockLayout(slot, labelText, bg, fg, x, y, cw, items) {
  const natW = (slot.img && slot.w) ? slot.w : cw;
  const natH = (slot.img && slot.h) ? slot.h : Math.round(cw * 0.6);
  // expand the drawn region to fit any annotations that extend outside the image
  nbAspect = natH ? natW / natH : 1;
  const ext = slot.img ? annsExtent(slot.annotations || []) : { x0: 0, y0: 0, x1: 1, y1: 1 };
  const regWu = ext.x1 - ext.x0, regHu = ext.y1 - ext.y0;
  let s = cw / (regWu * natW);
  if (regHu * natH * s > C.maxImgH) s = C.maxImgH / (regHu * natH);
  const regionW = regWu * natW * s, regionH = regHu * natH * s;
  const unitX = natW * s, unitY = natH * s;
  const regionX = x + (cw - regionW) / 2;

  meas.font = font(700, C.LABEL);
  const tw = meas.measureText(labelText).width;
  const badgeH = C.LABEL + 16, badgeW = tw + 28;

  let cy = y;
  items.push({ kind: "badge", cx: x + cw / 2, y: cy, w: badgeW, h: badgeH, text: labelText, size: C.LABEL, bg, fg });
  cy += badgeH + C.labelGap;
  // image occupies normalized [0,1] within the (possibly larger) region
  items.push({ kind: "image", img: slot.img, x: regionX + (0 - ext.x0) * unitX, y: cy + (0 - ext.y0) * unitY, w: unitX, h: unitY, annotations: slot.annotations });
  cy += regionH;
  if ((slot.caption || "").trim()) {
    cy += C.capGap;
    const lines = wrap(slot.caption, font(400, C.CAP), cw);
    items.push({ kind: "text", lines, x: x + cw / 2, y: cy, size: C.CAP, weight: 400, color: "#475569", align: "center" });
    cy += lines.length * C.CAP * C.lh;
  }
  return cy - y;
}

export function computeLayout(title, changes) {
  const horiz = state.layout === "horizontal";
  const bLabel = state.beforeLabel || "BEFORE", aLabel = state.afterLabel || "AFTER";
  const colW = C.cellW;
  const items = [];
  // width of one change rendered as side-by-side columns (one column per pair)
  const changeColsW = (ch) => Math.max(colW, ch.pairs.length * colW + (ch.pairs.length - 1) * C.pairGap);
  const contentW = horiz
    ? Math.max(colW, changes.reduce((s, ch, i) => s + changeColsW(ch) + (i ? C.changeGap : 0), 0))
    : colW * 2 + C.pairGap;
  const W = contentW + C.PAD * 2;
  let y = C.PAD;

  if ((title || "").trim()) {
    const lines = wrap(title, font(800, C.TITLE), contentW);
    items.push({ kind: "text", lines, x: C.PAD + contentW / 2, y, size: C.TITLE, weight: 800, color: "#0f172a", align: "center" });
    y += lines.length * C.TITLE * C.lh + C.titleGap;
  }

  // change title + divider at (x, y0) spanning width w; returns height consumed
  const titleBlock = (ch, x, y0, w) => {
    if (!(ch.title || "").trim()) return 0;
    const lines = wrap(ch.title, font(700, C.CHANGE), w);
    items.push({ kind: "text", lines, x, y: y0, size: C.CHANGE, weight: 700, color: "#0f172a", align: "left" });
    const h = lines.length * C.CHANGE * C.lh + 10;
    items.push({ kind: "line", x1: x, x2: x + w, y: y0 + h, color: "#e2e8f0", width: 2 });
    return h + C.ctitleGap;
  };
  // a change's pairs as vertical before/after columns, side by side; returns height
  const columns = (ch, x, y0) => {
    const colX = (pi) => x + pi * (colW + C.pairGap);
    const bH = ch.pairs.map((p, pi) => blockLayout(p.before, bLabel, "#fee2e2", "#b91c1c", colX(pi), y0, colW, items));
    const aY = y0 + Math.max(0, ...bH) + C.stackGap;
    const aH = ch.pairs.map((p, pi) => blockLayout(p.after, aLabel, "#dcfce7", "#15803d", colX(pi), aY, colW, items));
    return aY + Math.max(0, ...aH) - y0;
  };

  if (horiz) {
    // everything flows left-to-right: changes side by side, each a grid of vertical pairs
    const topY = y; let maxH = 0, x = C.PAD;
    changes.forEach((ch, i) => {
      if (i) x += C.changeGap;
      const bw = changeColsW(ch);
      const th = titleBlock(ch, x, topY, bw);
      maxH = Math.max(maxH, th + columns(ch, x, topY + th));
      x += bw;
    });
    y = topY + maxH;
  } else {
    // everything flows top-to-bottom: changes stacked, each pair a before|after row
    changes.forEach((ch, idx) => {
      if (idx > 0) y += C.changeGap;
      y += titleBlock(ch, C.PAD, y, contentW);
      ch.pairs.forEach((p, pi) => {
        if (pi > 0) y += C.rowGap;
        const bh = blockLayout(p.before, bLabel, "#fee2e2", "#b91c1c", C.PAD, y, colW, items);
        const ah = blockLayout(p.after, aLabel, "#dcfce7", "#15803d", C.PAD + colW + C.pairGap, y, colW, items);
        y += Math.max(bh, ah);
      });
    });
  }

  if (state.dateEnabled && (state.dateText || "").trim()) {
    y += C.changeGap / 2;
    const lines = wrap(state.dateText, font(500, 20), contentW);
    items.push({ kind: "text", lines, x: C.PAD + contentW, y, size: 20, weight: 500, color: "#94a3b8", align: "right" });
    y += lines.length * 20 * C.lh;
  }

  if (!items.length) {
    items.push({ kind: "text", lines: ["Add a title and screenshots to build your preview"], x: W / 2, y: C.PAD, size: 22, weight: 500, color: "#94a3b8", align: "center" });
    y += 30;
  }

  y += C.PAD;
  return { W, H: y, items };
}

export const T = {
  PAD: 48, TITLE: 48, NUM: 22, STEP_TITLE: 26, CAP: 20,
  cellW: 760, horizontalCellW: 560, stepGap: 44, titleGap: 34, numGap: 16,
  capGap: 14, maxImgH: 720,
};

export function alphaLabel(n) {
  let x = Math.max(1, Math.floor(Number(n) || 1)), out = "";
  while (x > 0) {
    x--;
    out = String.fromCharCode(65 + (x % 26)) + out;
    x = Math.floor(x / 26);
  }
  return out;
}
export const markerLabel = (n, style) => style === "letters" ? alphaLabel(n) : String(n);

export function tutorialImageLayout(slot, x, y, cw, items) {
  const natW = (slot.img && slot.w) ? slot.w : cw;
  const natH = (slot.img && slot.h) ? slot.h : Math.round(cw * 0.6);
  nbAspect = natH ? natW / natH : 1;
  const ext = slot.img ? annsExtent(slot.annotations || []) : { x0: 0, y0: 0, x1: 1, y1: 1 };
  const regWu = ext.x1 - ext.x0, regHu = ext.y1 - ext.y0;
  let s = cw / (regWu * natW);
  if (regHu * natH * s > T.maxImgH) s = T.maxImgH / (regHu * natH);
  const regionW = regWu * natW * s, regionH = regHu * natH * s;
  const unitX = natW * s, unitY = natH * s;
  const regionX = x + (cw - regionW) / 2;
  items.push({ kind: "image", img: slot.img, x: regionX + (0 - ext.x0) * unitX, y: y + (0 - ext.y0) * unitY, w: unitX, h: unitY, annotations: slot.annotations });
  return regionH;
}

export function computeTutorialLayout() {
  const tut = state.tutorial;
  const horiz = tut.layout === "horizontal";
  const steps = tut.steps;
  const cellW = horiz ? T.horizontalCellW : T.cellW;
  const contentW = horiz
    ? Math.max(cellW, steps.length * cellW + Math.max(0, steps.length - 1) * T.stepGap)
    : cellW;
  const W = contentW + T.PAD * 2;
  const items = [];
  let y = T.PAD;

  if ((tut.title || "").trim()) {
    const lines = wrap(tut.title, font(800, T.TITLE), contentW);
    items.push({ kind: "text", lines, x: T.PAD + contentW / 2, y, size: T.TITLE, weight: 800, color: "#0f172a", align: "center" });
    y += lines.length * T.TITLE * C.lh + T.titleGap;
  }

  const stepBlock = (step, idx, x, y0) => {
    const label = markerLabel(idx + 1, tut.numbering);
    meas.font = font(800, T.NUM);
    const badgeW = Math.max(42, meas.measureText(label).width + 28), badgeH = 42;
    items.push({ kind: "badge", cx: x + badgeW / 2, y: y0, w: badgeW, h: badgeH, text: label, size: T.NUM, bg: "#eef2ff", fg: "#4f46e5" });
    let headH = badgeH;
    if ((step.title || "").trim()) {
      const textX = x + badgeW + 14;
      const textW = Math.max(80, cellW - badgeW - 14);
      const lines = wrap(step.title, font(700, T.STEP_TITLE), textW);
      const lineH = T.STEP_TITLE * C.lh, textH = lines.length * lineH;
      items.push({ kind: "text", lines, x: textX, y: y0 + badgeH / 2 - textH / 2 + lineH / 2, size: T.STEP_TITLE, weight: 700, color: "#0f172a", align: "left", baseline: "middle" });
      headH = Math.max(headH, textH);
    }
    let cy = y0 + headH + T.numGap;
    cy += tutorialImageLayout(step.slot, x, cy, cellW, items);
    if ((step.slot.caption || "").trim()) {
      cy += T.capGap;
      const lines = wrap(step.slot.caption, font(500, T.CAP), cellW);
      items.push({ kind: "text", lines, x: x + cellW / 2, y: cy, size: T.CAP, weight: 500, color: "#475569", align: "center" });
      cy += lines.length * T.CAP * C.lh;
    }
    return cy - y0;
  };

  if (steps.length) {
    if (horiz) {
      let x = T.PAD, maxH = 0;
      steps.forEach((step, idx) => {
        if (idx) x += T.stepGap;
        maxH = Math.max(maxH, stepBlock(step, idx, x, y));
        x += cellW;
      });
      y += maxH;
    } else {
      steps.forEach((step, idx) => {
        if (idx) y += T.stepGap;
        y += stepBlock(step, idx, T.PAD, y);
      });
    }
  }

  if (!items.length) {
    items.push({ kind: "text", lines: ["Upload images to build a tutorial"], x: W / 2, y: T.PAD, size: 22, weight: 500, color: "#94a3b8", align: "center" });
    y += 30;
  }

  y += T.PAD;
  return { W, H: y, items };
}

export function draw(ctx, items, S, bg, W, H) {
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "top";
  for (const it of items) {
    if (it.kind === "text") {
      ctx.font = font(it.weight, it.size);
      ctx.fillStyle = it.color;
      ctx.textAlign = it.align;
      ctx.textBaseline = it.baseline || "top";
      const lh = it.size * C.lh;
      it.lines.forEach((ln, i) => ctx.fillText(ln, it.x, it.y + i * lh));
      ctx.textBaseline = "top";
    } else if (it.kind === "line") {
      ctx.strokeStyle = it.color; ctx.lineWidth = it.width;
      ctx.beginPath(); ctx.moveTo(it.x1, it.y); ctx.lineTo(it.x2, it.y); ctx.stroke();
    } else if (it.kind === "badge") {
      rr(ctx, it.cx - it.w / 2, it.y, it.w, it.h, it.h / 2);
      ctx.fillStyle = it.bg; ctx.fill();
      ctx.font = font(700, it.size); ctx.fillStyle = it.fg;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(it.text, it.cx, it.y + it.h / 2 + 1);
      ctx.textBaseline = "top";
    } else if (it.kind === "image") {
      if (it.img) {
        ctx.save(); rr(ctx, it.x, it.y, it.w, it.h, C.radius); ctx.clip();
        ctx.drawImage(it.img, it.x, it.y, it.w, it.h); ctx.restore();
        ctx.save(); rr(ctx, it.x, it.y, it.w, it.h, C.radius);
        ctx.strokeStyle = "rgba(15,23,42,.12)"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
        drawAnnotations(ctx, { x: it.x, y: it.y, w: it.w, h: it.h }, it.annotations);
      } else {
        ctx.save(); rr(ctx, it.x, it.y, it.w, it.h, C.radius);
        ctx.fillStyle = "#f1f5f9"; ctx.fill();
        ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#94a3b8"; ctx.font = font(500, 18);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("No image", it.x + it.w / 2, it.y + it.h / 2);
        ctx.textBaseline = "top";
      }
    }
  }
}

export function renderModel(canvas, title, changes) {
  const S = state.scale;
  const { W, H, items } = computeLayout(title, changes);
  canvas.width = Math.max(1, Math.round(W * S));
  canvas.height = Math.max(1, Math.round(H * S));
  draw(canvas.getContext("2d"), items, S, state.bg, W, H);
  return { W, H, S };
}
export function renderTutorialModel(canvas) {
  const S = state.tutorial.scale;
  const { W, H, items } = computeTutorialLayout();
  canvas.width = Math.max(1, Math.round(W * S));
  canvas.height = Math.max(1, Math.round(H * S));
  draw(canvas.getContext("2d"), items, S, state.tutorial.bg, W, H);
  return { W, H, S };
}

// perceived luminance (0..1) of a #rgb / #rrggbb color
export function hexLum(hex) {
  let c = String(hex || "").replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const r = parseInt(c.slice(0, 2), 16) || 0, g = parseInt(c.slice(2, 4), 16) || 0, b = parseInt(c.slice(4, 6), 16) || 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
export function rgbaOf(hex, a) {
  let c = String(hex || "").replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  return `rgba(${parseInt(c.slice(0, 2), 16) || 0},${parseInt(c.slice(2, 4), 16) || 0},${parseInt(c.slice(4, 6), 16) || 0},${a})`;
}
export const lineWidthValue = (w) => w === "small" ? 2 : w === "large" ? 7 : 4;
export const lineDash = (style, sw) => style === "dashed" ? [sw * 3, sw * 2] : style === "dotted" ? [sw * 0.1, sw * 2] : [];

// resolve a text label's display style from a single color plus background toggle.
// No background uses the halo treatment; background on uses the color as fill and white text
// unless the fill is white, where dark text is more legible. Old fg/bg fields are normalized here.
export function resolveTextStyle(a) {
  const size = a.size || 22;
  const hasBg = a.bgOn !== undefined ? !!a.bgOn : !!(a.bg && a.bg !== "none");
  const color = a.color || (hasBg ? a.bg : (a.fg && a.fg !== "auto" ? a.fg : "#ef4444"));
  const bg = hasBg ? color : "none";
  const fg = hasBg ? (hexLum(color) > 0.97 ? "#111827" : "#ffffff") : color;
  const light = hexLum(fg) > 0.72;   // only near-white text needs a dark halo; colored text reads better with a white glow
  return { size, bg, fg, hasBg, halo: !hasBg, haloColor: light ? "#000000" : "#ffffff", haloOpacity: light ? 0.5 : 0.85 };
}

// ---- annotations: one set of geometry primitives, drawn to canvas OR serialized to SVG ----
export function annoPrimitives(rect, a) {
  const k = rect.w / 560;   // sizes scale purely with the image (no min clamps) so the editor matches output at any zoom
  const col = a.color || "#ef4444";
  const baseLineW = lineWidthValue(a.lineWidth);
  const sw = baseLineW * k;
  const dash = lineDash(a.lineStyle, sw);
  const X = (n) => rect.x + n * rect.w, Y = (n) => rect.y + n * rect.h;
  if (a.type === "box") {
    return [{ k: "rect", x: X(a.x), y: Y(a.y), w: a.w * rect.w, h: a.h * rect.h, stroke: col, sw, dash }];
  }
  if (a.type === "arrow") {
    const x1 = X(a.x1), y1 = Y(a.y1), x2 = X(a.x2), y2 = Y(a.y2);
    const ang = Math.atan2(y2 - y1, x2 - x1), hl = (10 + baseLineW * 2) * k;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, cut = Math.min(hl * 0.9, len * 0.6);
    const bx = x2 - Math.cos(ang) * cut, by = y2 - Math.sin(ang) * cut;  // stop the line at the arrowhead base
    return [
      { k: "line", x1, y1, x2: bx, y2: by, stroke: col, sw, dash },
      { k: "poly", pts: [[x2, y2], [x2 - hl * Math.cos(ang - 0.45), y2 - hl * Math.sin(ang - 0.45)], [x2 - hl * Math.cos(ang + 0.45), y2 - hl * Math.sin(ang + 0.45)]], fill: col },
    ];
  }
  if (a.type === "number") {
    const cx = X(a.x), cy = Y(a.y), r = (a.size || 20) * k;
    return [
      { k: "circle", cx, cy, r, fill: col },
      { k: "text", x: cx, y: cy, text: markerLabel(a.n, a.style), size: r * 1.25, fill: "#fff", anchor: "center", baseline: "middle", weight: 700 },
    ];
  }
  if (a.type === "text") {
    const st = resolveTextStyle(a), size = st.size * k, tm = textMetrics(a.text, size), x = X(a.x), y = Y(a.y);
    const haloW = st.halo ? size * 0.22 : 0;
    const prims = [{ k: "pill", x, y, w: tm.w, h: tm.h, fill: st.bg, noFill: !st.hasBg }];
    tm.lines.forEach((ln, i) => prims.push({ k: "text", x: x + tm.padX, y: y + tm.padY + tm.lineH * (i + 0.5), text: ln, size, fill: st.fg, anchor: "start", baseline: "middle", weight: 700, halo: st.halo, haloColor: st.haloColor, haloOpacity: st.haloOpacity, haloW }));
    return prims;
  }
  return [];
}
export function drawPrim(ctx, p) {
  if (p.k === "rect") { ctx.save(); ctx.lineWidth = p.sw; ctx.strokeStyle = p.stroke; ctx.lineCap = "round"; ctx.setLineDash(p.dash || []); ctx.strokeRect(p.x, p.y, p.w, p.h); ctx.restore(); }
  else if (p.k === "line") { ctx.save(); ctx.lineWidth = p.sw; ctx.strokeStyle = p.stroke; ctx.lineCap = "round"; ctx.setLineDash(p.dash || []); ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke(); ctx.restore(); }
  else if (p.k === "poly") { ctx.fillStyle = p.fill; ctx.beginPath(); p.pts.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]))); ctx.closePath(); ctx.fill(); }
  else if (p.k === "circle") { ctx.fillStyle = p.fill; ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); ctx.fill(); }
  else if (p.k === "pill") { if (!p.noFill) { rr(ctx, p.x, p.y, p.w, p.h, p.h / 2); ctx.fillStyle = p.fill; ctx.fill(); } }
  else if (p.k === "text") {
    ctx.font = font(p.weight || 400, p.size);
    ctx.textAlign = p.anchor === "center" ? "center" : "start";
    ctx.textBaseline = p.baseline || "alphabetic";
    if (p.halo && p.haloW) { ctx.lineWidth = p.haloW; ctx.lineJoin = "round"; ctx.miterLimit = 2; ctx.strokeStyle = rgbaOf(p.haloColor, p.haloOpacity); ctx.strokeText(p.text, p.x, p.y); }
    ctx.fillStyle = p.fill;
    ctx.fillText(p.text, p.x, p.y);
    ctx.textAlign = "start"; ctx.textBaseline = "top";
  }
}
export function svgPrim(p) {
  const dash = (p.dash && p.dash.length) ? ` stroke-dasharray="${p.dash.join(" ")}"` : "";
  if (p.k === "rect") return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="none" stroke="${p.stroke}" stroke-width="${p.sw}"${dash}/>`;
  if (p.k === "line") return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.stroke}" stroke-width="${p.sw}" stroke-linecap="round"${dash}/>`;
  if (p.k === "poly") return `<polygon points="${p.pts.map((pt) => pt.join(",")).join(" ")}" fill="${p.fill}"/>`;
  if (p.k === "circle") return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${p.fill}"/>`;
  if (p.k === "pill") return p.noFill ? "" : `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.h / 2}" fill="${p.fill}"/>`;
  if (p.k === "text") {
    const anchor = p.anchor === "center" ? "middle" : "start";
    const db = p.baseline === "middle" ? "central" : "alphabetic";
    const halo = (p.halo && p.haloW) ? ` stroke="${p.haloColor}" stroke-width="${p.haloW}" stroke-opacity="${p.haloOpacity}" stroke-linejoin="round" paint-order="stroke"` : "";
    return `<text x="${p.x}" y="${p.y}" font-family="${SVG_FAM}" font-size="${p.size}" font-weight="${p.weight || 400}" fill="${p.fill}"${halo} text-anchor="${anchor}" dominant-baseline="${db}">${svgEsc(p.text)}</text>`;
  }
  return "";
}
// pill metrics for a (possibly multi-line) text label at a given font size
export function textMetrics(text, size) {
  const padX = size * 10 / 22, padY = size * 6 / 22, lineH = size * 1.2;
  const lines = String(text || "").split("\n");
  meas.font = font(700, size);
  let maxW = 0; for (const l of lines) maxW = Math.max(maxW, meas.measureText(l).width);
  return { lines, padX, padY, lineH, w: maxW + padX * 2, h: lines.length * lineH + padY * 2 };
}
// aspect (rect.w/rect.h) of the rect annotations are drawn into; set before each render/geometry pass.
// Sizes live in 560-WIDTH space, so a height expressed as (px/560) is a width-fraction — multiply by
// this to get the correct height-fraction for the normalized (x-by-width, y-by-height) coordinate space.
export let nbAspect = 1;
export function setNbAspect(value) { nbAspect = value; }
// text labels always render (and hit-test) above other annotations
export const drawOrder = (anns) => anns.map((_, i) => i).sort((i, j) => ((anns[i].type === "text") - (anns[j].type === "text")) || (i - j));
// normalized bounding box of an annotation (in image-relative 0..1 units)
export function annNormBBox(a) {
  if (a.type === "box") return { x: a.x, y: a.y, w: a.w, h: a.h };
  if (a.type === "number") { const r = (a.size || 20) / 560, ry = r * nbAspect; return { x: a.x - r, y: a.y - ry, w: 2 * r, h: 2 * ry }; }
  if (a.type === "text") { const tm = textMetrics(a.text, a.size || 22); return { x: a.x, y: a.y, w: tm.w / 560, h: tm.h / 560 * nbAspect }; }
  if (a.type === "arrow") { return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) }; }
  return { x: a.x || 0, y: a.y || 0, w: 0, h: 0 };
}
export function rectBorderPoint(bb, px, py) {
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2, dx = px - cx, dy = py - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx ? (bb.w / 2) / Math.abs(dx) : Infinity, dy ? (bb.h / 2) / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}
export const buildById = (anns) => { const m = {}; (anns || []).forEach((a) => { if (a.id) m[a.id] = a; }); return m; };
// attachment point on a pinned target's edge, facing (px,py) — circle edge for numbers, rect border otherwise
export function attachPoint(t, px, py) {
  const bb = annNormBBox(t), cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  if (t.type === "number") {
    const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy) || 1, r = bb.w / 2;
    return { x: cx + (dx / d) * r, y: cy + (dy / d) * r };
  }
  return rectBorderPoint(bb, px, py);
}
// resolve an arrow's endpoints, snapping pinned ends to the edge of their target
export function resolveArrowEnds(a, byId) {
  const t1 = a.fromRef && byId[a.fromRef], t2 = a.toRef && byId[a.toRef];
  const bb1 = t1 && annNormBBox(t1), bb2 = t2 && annNormBBox(t2);
  const c2 = bb2 ? { x: bb2.x + bb2.w / 2, y: bb2.y + bb2.h / 2 } : { x: a.x2, y: a.y2 };
  const c1 = bb1 ? { x: bb1.x + bb1.w / 2, y: bb1.y + bb1.h / 2 } : { x: a.x1, y: a.y1 };
  const p1 = t1 ? attachPoint(t1, c2.x, c2.y) : { x: a.x1, y: a.y1 };
  const p2 = t2 ? attachPoint(t2, c1.x, c1.y) : { x: a.x2, y: a.y2 };
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}
export const resolveForRender = (a, byId) => (a.type === "arrow" && (a.fromRef || a.toRef)) ? { ...a, ...resolveArrowEnds(a, byId) } : a;
// union extent of image [0,1] and all annotations (normalized image units)
export function annsExtent(anns) {
  let x0 = 0, y0 = 0, x1 = 1, y1 = 1;
  const byId = buildById(anns);
  (anns || []).forEach((a) => {
    let bb;
    if (a.type === "arrow") { const e = resolveArrowEnds(a, byId); bb = { x: Math.min(e.x1, e.x2), y: Math.min(e.y1, e.y2), w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) }; }
    else bb = annNormBBox(a);
    x0 = Math.min(x0, bb.x); y0 = Math.min(y0, bb.y); x1 = Math.max(x1, bb.x + bb.w); y1 = Math.max(y1, bb.y + bb.h);
  });
  return { x0, y0, x1, y1 };
}
export function drawAnnotations(ctx, rect, anns) {
  if (!anns || !anns.length) return;
  setNbAspect(rect.h ? rect.w / rect.h : 1);
  const byId = buildById(anns);
  drawOrder(anns).forEach((i) => annoPrimitives(rect, resolveForRender(anns[i], byId)).forEach((p) => drawPrim(ctx, p)));
}
