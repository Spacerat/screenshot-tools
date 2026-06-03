import { scheduleSave, state, snapshot } from './state.js';
import { h } from './dom.js';
import { C, FAMILY, annoPrimitives, annsExtent, buildById, computeLayout, computeTutorialLayout, drawAnnotations, drawOrder, renderModel, renderTutorialModel, resolveForRender, setNbAspect, svgPrim } from './rendering.js';

let hooks = {};
export function configureExport(nextHooks) { hooks = nextHooks; }

// ---------- preview + export ----------
const previewCanvas = document.getElementById("preview");
const dimsEl = document.getElementById("dims");
const tutorialCanvas = document.getElementById("tutPreview");
const tutorialDimsEl = document.getElementById("tutDims");
export function applyPreviewFit(kind, layout) {
  const wrap = document.getElementById(kind === "tut" ? "tutPreviewWrap" : "previewWrap");
  wrap.classList.toggle("fit-horizontal", layout === "horizontal");
  wrap.classList.toggle("fit-vertical", layout !== "horizontal");
}

export function drawPreview() {
  const { W, H, S } = renderModel(previewCanvas, state.title, state.changes);
  dimsEl.textContent = `${Math.round(W * S)} × ${Math.round(H * S)} px`;
  applyPreviewFit("ba", state.layout);
  scheduleSave();
}
export function drawTutorialPreview() {
  const { W, H, S } = renderTutorialModel(tutorialCanvas);
  tutorialDimsEl.textContent = `${Math.round(W * S)} × ${Math.round(H * S)} px`;
  applyPreviewFit("tut", state.tutorial.layout);
  scheduleSave();
}

export function slug(s) {
  return (String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")) || "before-after";
}
export const RASTER = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
export const EXT = { png: "png", jpeg: "jpg", webp: "webp", svg: "svg" };

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let toastTimer = null;
export function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = h("div", { id: "toast", class: "toast" }); document.body.append(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1700);
}
export function toCanvas(title, changes) {
  const tmp = document.createElement("canvas");
  renderModel(tmp, title, changes);
  return tmp;
}
export function toTutorialCanvas() {
  const tmp = document.createElement("canvas");
  renderTutorialModel(tmp);
  return tmp;
}
export const blobFromCanvas = (canvas, mime, q) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), mime, q));

export function exportDownload(title, changes, fmt, name) {
  if (fmt === "svg") {
    downloadBlob(new Blob([buildSVG(title, changes)], { type: "image/svg+xml" }), `${name}.svg`);
    return;
  }
  blobFromCanvas(toCanvas(title, changes), RASTER[fmt], fmt === "png" ? undefined : 0.92)
    .then((b) => downloadBlob(b, `${name}.${EXT[fmt]}`));
}
export async function exportCopy(title, changes, fmt) {
  try {
    if (fmt === "svg") { await navigator.clipboard.writeText(buildSVG(title, changes)); toast("Copied SVG markup"); return; }
    const blob = await blobFromCanvas(toCanvas(title, changes), RASTER[fmt], fmt === "png" ? undefined : 0.92);
    await navigator.clipboard.write([new ClipboardItem({ [RASTER[fmt]]: blob })]);
    toast(`Copied ${fmt.toUpperCase()} to clipboard`);
  } catch (e) {
    toast(fmt === "png" ? "Copy failed" : "Copy failed — browser may only allow PNG");
  }
}
export function tutorialExportDownload(fmt) {
  const name = slug(state.tutorial.title || "tutorial");
  if (fmt === "svg") {
    downloadBlob(new Blob([buildTutorialSVG()], { type: "image/svg+xml" }), `${name}.svg`);
    return;
  }
  blobFromCanvas(toTutorialCanvas(), RASTER[fmt], fmt === "png" ? undefined : 0.92)
    .then((b) => downloadBlob(b, `${name}.${EXT[fmt]}`));
}
export async function tutorialExportCopy(fmt) {
  try {
    if (fmt === "svg") { await navigator.clipboard.writeText(buildTutorialSVG()); toast("Copied SVG markup"); return; }
    const blob = await blobFromCanvas(toTutorialCanvas(), RASTER[fmt], fmt === "png" ? undefined : 0.92);
    await navigator.clipboard.write([new ClipboardItem({ [RASTER[fmt]]: blob })]);
    toast(`Copied ${fmt.toUpperCase()} to clipboard`);
  } catch (e) {
    toast(fmt === "png" ? "Copy failed" : "Copy failed — browser may only allow PNG");
  }
}
export function downloadAllSections(fmt) {
  if (!state.changes.length) return;
  // Stagger so the browser doesn't drop all-but-one of the saves.
  state.changes.forEach((ch, i) => {
    setTimeout(() => exportDownload("", [ch], fmt, `${i + 1}-${slug(ch.title || "change")}`), i * 350);
  });
}

// ---- SVG export (reuses the same layout; vector text, embedded raster images) ----
export const svgEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function buildSVGFromLayout(layout, bg) {
  const { W, H, items } = layout;
  const fam = FAMILY.replace(/"/g, "'");
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
  ];
  let clip = 0;
  for (const it of items) {
    if (it.kind === "text") {
      const anchor = it.align === "center" ? "middle" : it.align === "right" ? "end" : "start";
      const db = it.baseline === "middle" ? "central" : "text-before-edge";
      const lh = it.size * C.lh;
      it.lines.forEach((ln, i) => out.push(
        `<text x="${it.x}" y="${it.y + i * lh}" font-family="${fam}" font-size="${it.size}" font-weight="${it.weight}" fill="${it.color}" text-anchor="${anchor}" dominant-baseline="${db}">${svgEsc(ln)}</text>`));
    } else if (it.kind === "line") {
      out.push(`<line x1="${it.x1}" y1="${it.y}" x2="${it.x2}" y2="${it.y}" stroke="${it.color}" stroke-width="${it.width}"/>`);
    } else if (it.kind === "badge") {
      out.push(`<rect x="${it.cx - it.w / 2}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${it.h / 2}" fill="${it.bg}"/>`);
      out.push(`<text x="${it.cx}" y="${it.y + it.h / 2}" font-family="${fam}" font-size="${it.size}" font-weight="700" fill="${it.fg}" text-anchor="middle" dominant-baseline="central">${svgEsc(it.text)}</text>`);
    } else if (it.kind === "image" && it.img && it.img.src) {
      const id = `c${clip++}`;
      out.push(`<clipPath id="${id}"><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${C.radius}"/></clipPath>`);
      out.push(`<image x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" preserveAspectRatio="none" clip-path="url(#${id})" xlink:href="${it.img.src}"/>`);
      out.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${C.radius}" fill="none" stroke="rgba(15,23,42,0.12)" stroke-width="1.5"/>`);
      { const _r = { x: it.x, y: it.y, w: it.w, h: it.h }, _b = buildById(it.annotations), _a = it.annotations || []; setNbAspect(it.h ? it.w / it.h : 1); drawOrder(_a).forEach((i) => annoPrimitives(_r, resolveForRender(_a[i], _b)).forEach((p) => out.push(svgPrim(p)))); }
    } else if (it.kind === "image") {
      out.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${C.radius}" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="8 6"/>`);
      out.push(`<text x="${it.x + it.w / 2}" y="${it.y + it.h / 2}" font-family="${fam}" font-size="18" font-weight="500" fill="#94a3b8" text-anchor="middle" dominant-baseline="central">No image</text>`);
    }
  }
  out.push("</svg>");
  return out.join("");
}
export function buildSVG(title, changes) {
  return buildSVGFromLayout(computeLayout(title, changes), state.bg);
}
export function buildTutorialSVG() {
  return buildSVGFromLayout(computeTutorialLayout(), state.tutorial.bg);
}

// ---- project save / open (.json, images included) ----
export function saveProject(name) {
  const blob = new Blob([JSON.stringify(snapshot())], { type: "application/json" });
  downloadBlob(blob, slug(name || state.title) + ".beforeafter.json");
}
export function openProjectFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => { try { hooks.loadProject(JSON.parse(r.result)); } catch (e) { alert("Couldn't read that project file."); } };
  r.readAsText(file);
}

// ---------- dropdown menus ----------
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.classList.remove("open"); openMenu = null; } }
document.addEventListener("click", (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });

// groups: [{ label?, items: [{ label, onClick }] }]
export function dropdown(label, btnClass, groups) {
  const menu = h("div", { class: "menu" });
  groups.forEach((g) => {
    if (g.label) menu.append(h("div", { class: "menu-head" }, g.label));
    g.items.forEach((it) => menu.append(h("button", {
      class: "menu-item",
      onclick: (e) => { e.stopPropagation(); closeMenu(); it.onClick(); },
    }, it.label)));
  });
  const wrap = h("div", { class: "dropdown" });
  const btn = h("button", {
    class: btnClass || undefined,
    onclick: (e) => {
      e.stopPropagation();
      const wasOpen = wrap.classList.contains("open");
      closeMenu();
      if (!wasOpen) { wrap.classList.add("open"); openMenu = wrap; }
    },
  }, label, h("span", { class: "caret" }, "▾"));
  wrap.append(btn, menu);
  return wrap;
}

export const DL_FORMATS = [["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"], ["svg", "SVG"]];
export const COPY_FORMATS = [["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"], ["svg", "SVG markup"]];
export const downloadItems = (getName, getTitle, getChanges) =>
  DL_FORMATS.map(([f, l]) => ({ label: l, onClick: () => exportDownload(getTitle(), getChanges(), f, getName()) }));
export const copyItems = (getTitle, getChanges) =>
  COPY_FORMATS.map(([f, l]) => ({ label: l, onClick: () => exportCopy(getTitle(), getChanges(), f) }));

export function buildBarActions() {
  const bar = document.getElementById("barActions");
  bar.innerHTML = "";
  bar.append(
    dropdown("⧉ Copy", "", [{ items: copyItems(() => state.title, () => state.changes) }]),
    dropdown("⬇ Each section", "", [{ items: DL_FORMATS.map(([f, l]) => ({ label: l, onClick: () => downloadAllSections(f) })) }]),
    dropdown("⬇ Download", "primary", [{ items: downloadItems(() => slug(state.title), () => state.title, () => state.changes) }]),
  );
}
export function buildTutorialActions() {
  const bar = document.getElementById("tutActions");
  bar.innerHTML = "";
  bar.append(
    dropdown("⧉ Copy", "", [{ items: COPY_FORMATS.map(([f, l]) => ({ label: l, onClick: () => tutorialExportCopy(f) })) }]),
    dropdown("⬇ Download", "primary", [{ items: DL_FORMATS.map(([f, l]) => ({ label: l, onClick: () => tutorialExportDownload(f) })) }]),
  );
}
