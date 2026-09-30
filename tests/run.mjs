// Behaviour tests: drive index.html in headless Chrome over the DevTools protocol (no dependencies).
//   node tests/run.mjs                 run all tests
//   node tests/run.mjs tutorial        run tests whose name contains "tutorial"
//   node tests/run.mjs --update        rewrite goldens from the tests that ran
//   node tests/run.mjs --page other.html --shots /tmp/shots
// Goldens depend on this machine's fonts and Chrome build; regenerate with --update after reviewing a change.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const PAGE = resolve(flag("--page") || fileURLToPath(new URL("../index.html", import.meta.url)));
const SHOTS = flag("--shots");
const UPDATE = args.includes("--update");
const FILTER = args.filter((a) => !a.startsWith("--"));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FIX = (name) => here(`./fixtures/${name}`);
const GOLDEN = here("./golden/");
const HASHES = join(GOLDEN, "values.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fixture images appear in exports as data URLs; goldens name them instead of embedding them.
const knownImages = Object.fromEntries(readdirSync(here("./fixtures/")).filter((f) => f.endsWith(".png"))
  .map((f) => ["data:image/png;base64," + readFileSync(FIX(f)).toString("base64"), f]));
const normalizeSVG = (svg) => svg.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g,
  (u) => knownImages[u] ? `fixture:${knownImages[u]}` : `sha:${createHash("sha256").update(u).digest("hex").slice(0, 12)}`);

// ---------- page-side stubs + helpers (installed before any page script runs) ----------
const STUBS = `(() => {
  window.__downloads = []; window.__alerts = []; window.__clipboard = [];
  const blobs = new Map(), createURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = createURL(b); blobs.set(u, b); return u; };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { __downloads.push({ name: this.download, blob: blobs.get(this.href) }); return; }
    return click.call(this);
  };
  window.confirm = () => true;
  window.alert = (m) => { __alerts.push(String(m)); };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (t) => { __clipboard.push({ type: "text", data: t }); },
    write: async (items) => { for (const it of items) for (const t of it.types) __clipboard.push({ type: t, size: (await it.getType(t)).size }); },
  } });
  const sha = async (data) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const find = (sel, pred, what) => { const el = [...document.querySelectorAll(sel)].find(pred); if (!el) throw new Error("not found: " + what); return el; };
  window.__t = {
    button: (scope, text) => find(scope + " button", (b) => b.textContent.includes(text), scope + " button " + text).click(),
    menu(scope, label, item) {
      const dd = find(scope + " .dropdown", (d) => d.firstElementChild.textContent.trim().startsWith(label), scope + " dropdown " + label);
      dd.firstElementChild.click();
      find(scope + " .dropdown.open .menu-item", (b) => b.textContent.trim() === item, label + " > " + item).click();
    },
    set(id, v) {
      const el = document.getElementById(id);
      if (el.type === "checkbox") el.checked = v; else el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    visible: (sel) => { const el = document.querySelector(sel); return !!el && el.offsetParent !== null; },
    count: (sel) => document.querySelectorAll(sel).length,
    text: (sel) => document.querySelector(sel).textContent,
    canvasHash: (sel) => sha(document.querySelector(sel).toDataURL()),
    canvasPNG: (sel) => document.querySelector(sel).toDataURL(),
    async downloads() {
      return Promise.all(__downloads.map(async ({ name, blob }) => {
        const textual = /svg|json/.test(blob.type);
        return { name, type: blob.type, text: textual ? await blob.text() : null, sha: await sha(await blob.arrayBuffer()) };
      }));
    },
  };
})();`;

// ---------- minimal CDP client ----------
class Browser {
  static async launch() {
    const dir = mkdtempSync(join(tmpdir(), "st-chrome-"));
    const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run",
      "--no-default-browser-check", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1400,1000", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
    const wsUrl = await new Promise((res, rej) => {
      let buf = "";
      proc.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\S+)/); if (m) res(m[1]); });
      proc.on("exit", () => rej(new Error("Chrome exited:\n" + buf)));
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    return new Browser(ws, proc, dir);
  }
  constructor(ws, proc, dir) {
    Object.assign(this, { ws, proc, dir, seq: 0, pending: new Map(), listeners: new Set() });
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
      } else this.listeners.forEach((l) => l(msg));
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  waitEvent(method, sessionId, timeout = 10000) {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.listeners.delete(l); rej(new Error("timeout waiting for " + method)); }, timeout);
      const l = (msg) => { if (msg.method === method && msg.sessionId === sessionId) { clearTimeout(timer); this.listeners.delete(l); res(msg.params); } };
      this.listeners.add(l);
    });
  }
  async newPage() {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, targetId, sessionId);
    await page.send("Page.enable"); await page.send("Runtime.enable"); await page.send("DOM.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: STUBS });
    await page.send("Page.setInterceptFileChooserDialog", { enabled: true });
    return page;
  }
  async close() {
    const exited = new Promise((r) => this.proc.once("exit", r));
    this.send("Browser.close").catch(() => {});
    await Promise.race([exited, sleep(3000)]);
    this.proc.kill();
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

class Page {
  constructor(browser, targetId, sessionId) { Object.assign(this, { browser, targetId, sessionId }); }
  send(method, params) { return this.browser.send(method, params, this.sessionId); }
  async goto(hash = "") {
    const loaded = this.browser.waitEvent("Page.loadEventFired", this.sessionId);
    await this.send("Page.navigate", { url: pathToFileURL(PAGE).href + hash });
    await loaded;
  }
  async reload() {
    const loaded = this.browser.waitEvent("Page.loadEventFired", this.sessionId);
    await this.send("Page.reload");
    await loaded;
  }
  // Run fn(...args) in the page (with a user gesture, so file pickers may open) and return its value.
  async eval(fn, ...fnArgs) {
    const r = await this.send("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(fnArgs)})`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(fn, ...fnArgs) {
    for (let i = 0; i < 100; i++) { if (await this.eval(fn, ...fnArgs)) return; await sleep(50); }
    throw new Error("timed out waiting for " + fn.toString().slice(0, 120));
  }
  // Wait until a canvas stops changing (images decode asynchronously) and return its hash.
  async settle(sel) {
    let prev = null;
    for (let i = 0; i < 60; i++) {
      await sleep(120);
      const h = await this.eval((s) => __t.canvasHash(s), sel);
      if (h === prev) return h;
      prev = h;
    }
    throw new Error("canvas never settled: " + sel);
  }
  // Click a button that opens a file picker, then answer the picker with `files`.
  async choose(scope, buttonText, files) {
    const opened = this.browser.waitEvent("Page.fileChooserOpened", this.sessionId);
    await this.eval((s, t) => __t.button(s, t), scope, buttonText);
    const { backendNodeId } = await opened;
    await this.send("DOM.setFileInputFiles", { files: [].concat(files), backendNodeId });
  }
  // Put files straight into a (usually hidden) <input type=file> found by a JS expression.
  async setFiles(expr, files) {
    const r = await this.send("Runtime.evaluate", { expression: expr });
    if (!r.result.objectId) throw new Error("no element for " + expr);
    await this.send("DOM.setFileInputFiles", { files: [].concat(files), objectId: r.result.objectId });
  }
  menu(scope, label, item) { return this.eval((s, l, i) => __t.menu(s, l, i), scope, label, item); }
  button(scope, text) { return this.eval((s, t) => __t.button(s, t), scope, text); }
  set(id, v) { return this.eval((i, x) => __t.set(i, x), id, v); }
  count(sel) { return this.eval((s) => __t.count(s), sel); }
  text(sel) { return this.eval((s) => __t.text(s), sel); }
  visible(sel) { return this.eval((s) => __t.visible(s), sel); }
  async downloads(n) {
    await this.waitFor((k) => __downloads.length >= k, n);
    await sleep(50);
    return this.eval(() => __t.downloads());
  }
  // ----- real input (mouse drags become pointer events; keys go to the focused element) -----
  mouse(type, x, y, buttons = 1) {
    return this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : buttons, clickCount: 1 });
  }
  async drag([x1, y1], [x2, y2]) {
    await this.mouse("mousePressed", x1, y1);
    for (let i = 1; i <= 5; i++) await this.mouse("mouseMoved", x1 + (x2 - x1) * i / 5, y1 + (y2 - y1) * i / 5);
    await this.mouse("mouseReleased", x2, y2);
  }
  click(pt) { return this.drag(pt, pt); }
  keyEvent(type, key, modifiers = 0) {
    const named = { Enter: [13, "\r"], Delete: [46, ""], Escape: [27, ""] }[key];
    const code = named ? key : /\d/.test(key) ? "Digit" + key : "Key" + key.toUpperCase();
    const text = named ? named[1] : (modifiers ? "" : key);
    return this.send("Input.dispatchKeyEvent", { type: type === "up" ? "keyUp" : text ? "keyDown" : "rawKeyDown", key, code, text, modifiers,
      windowsVirtualKeyCode: named ? named[0] : key.toUpperCase().charCodeAt(0) });
  }
  async key(key, modifiers = 0) { await this.keyEvent("down", key, modifiers); await this.keyEvent("up", key, modifiers); }
  dragOver(files, [x, y]) {
    const data = { items: [], files: [].concat(files), dragOperationsMask: 1 };
    return this.send("Input.dispatchDragEvent", { type: "dragEnter", x, y, data }).then(() => this.send("Input.dispatchDragEvent", { type: "dragOver", x, y, data }));
  }
  drop(files, [x, y]) { return this.send("Input.dispatchDragEvent", { type: "drop", x, y, data: { items: [], files: [].concat(files), dragOperationsMask: 1 } }); }
  async dropAt(files, pt) { await this.dragOver(files, pt); await this.drop(files, pt); }
  // Drag an element of the page from `from` to `to` with the mouse (Chrome hands the native drag to us to
  // replay). With hover, stop over the target and return a function that finishes the drop.
  async dragElement(from, to, { hover = false } = {}) {
    await this.send("Input.setInterceptDrags", { enabled: true });
    const intercepted = this.browser.waitEvent("Input.dragIntercepted", this.sessionId);
    await this.mouse("mousePressed", ...from);
    await this.mouse("mouseMoved", from[0] + 8, from[1] + 8);
    await this.mouse("mouseMoved", from[0] + 16, from[1] + 16);
    const { data } = await intercepted;
    await this.send("Input.dispatchDragEvent", { type: "dragEnter", x: to[0], y: to[1], data });
    await this.send("Input.dispatchDragEvent", { type: "dragOver", x: to[0], y: to[1], data });
    const finish = async () => {
      await this.send("Input.dispatchDragEvent", { type: "drop", x: to[0], y: to[1], data });
      await this.mouse("mouseReleased", ...to);
      await this.send("Input.setInterceptDrags", { enabled: false });
    };
    if (hover) return finish;
    await finish();
  }
  // Viewport point inside the i-th element matching sel, at fractions (fx, fy) of its box (no scrolling).
  point(sel, i = 0, fx = 0.5, fy = 0.5) {
    return this.eval((s, k, x, y) => { const r = document.querySelectorAll(s)[k].getBoundingClientRect(); return [r.left + r.width * x, r.top + r.height * y]; }, sel, i, fx, fy);
  }
  viewport(height) { return this.send("Emulation.setDeviceMetricsOverride", { width: 1400, height, deviceScaleFactor: 1, mobile: false }); }
  // Viewport centre of the i-th element matching sel (scrolled into view first).
  center(sel, i = 0) {
    return this.eval((s, k) => {
      const el = document.querySelectorAll(s)[k];
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    }, sel, i);
  }
  // The editor fits the image to 70% of its canvas; map image-normalized (nx, ny) to viewport coordinates.
  async imagePoint(canvasSel, imgW, imgH) {
    const r = await this.eval((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, canvasSel);
    const s = Math.min(r.w / imgW, r.h / imgH) * 0.7, w = imgW * s, h = imgH * s;
    return (nx, ny) => [r.x + (r.w - w) / 2 + nx * w, r.y + (r.h - h) / 2 + ny * h];
  }
  async screenshot(name) {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
  }
  async shot(name, sel) {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const url = await this.eval((s) => __t.canvasPNG(s), sel);
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
  }
}

// ---------- goldens ----------
const values = existsSync(HASHES) ? JSON.parse(readFileSync(HASHES, "utf8")) : {};
const updated = new Map();   // key → value written this run, so two tests can't record different goldens for one key
class Ctx {
  constructor(browser) { this.browser = browser; this.failures = []; this.pages = []; }
  async page(hash = "") { const p = await this.browser.newPage(); this.pages.push(p); await p.goto(hash); return p; }
  check(ok, msg) { if (!ok) this.failures.push(msg); }
  golden(key, value) {
    if (UPDATE) {
      const v = key.endsWith(".svg") ? normalizeSVG(value) : JSON.stringify(value);
      if (updated.has(key) && updated.get(key) !== v) return this.failures.push(`${key}: conflicting values within this run`);
      updated.set(key, v);
    }
    if (key.endsWith(".svg")) {
      const file = join(GOLDEN, key), actual = normalizeSVG(value);
      if (UPDATE) { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, actual); rmSync(file + ".actual", { force: true }); return; }
      if (!existsSync(file)) return this.failures.push(`missing golden ${key} (run with --update)`);
      if (readFileSync(file, "utf8") !== actual) { writeFileSync(file + ".actual", actual); this.failures.push(`${key} differs (see ${key}.actual)`); }
      else rmSync(file + ".actual", { force: true });
      return;
    }
    if (UPDATE) { values[key] = value; return; }
    if (!(key in values)) return this.failures.push(`missing golden ${key} (run with --update)`);
    if (JSON.stringify(values[key]) !== JSON.stringify(value)) this.failures.push(`${key}: expected ${JSON.stringify(values[key])}, got ${JSON.stringify(value)}`);
  }
  // Golden-check every download by file name (staggered saves make their order timing-dependent).
  goldenDownloads(prefix, downloads) {
    this.golden(`${prefix}.names`, downloads.map((d) => d.name).sort());
    for (const d of downloads) {
      if (d.type === "image/svg+xml") this.golden(`${prefix}/${d.name}`, d.text);
      else if (d.type !== "application/json") this.golden(`${prefix}/${d.name}`, d.sha);
    }
  }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tmp = mkdtempSync(join(tmpdir(), "st-test-"));
const saveTmp = (name, text) => { const f = join(tmp, name); writeFileSync(f, text); return f; };

// ---------- tests ----------
const BA_BAR = "#tab-ba .preview-bar", TUT_BAR = "#tab-tut .preview-bar";

test("before-after: open a project and export", async (t) => {
  const p = await t.page("#/before-after");
  await p.choose("#tab-ba .panel", "Open project", FIX("before-after.json"));
  t.golden("ba.preview", await p.settle("#preview"));
  t.golden("ba.dims", await p.text("#dims"));
  await p.shot("ba", "#preview");
  await p.menu(BA_BAR, "⬇ Download", "SVG");
  await p.menu(BA_BAR, "⬇ Download", "PNG");
  await p.menu(BA_BAR, "⬇ Download", "JPEG");
  await p.menu(BA_BAR, "⬇ Each section", "SVG");
  await p.menu("#changes .change:nth-child(1)", "⬇ Download", "SVG");
  t.goldenDownloads("ba.export", await p.downloads(6));
  await p.menu(BA_BAR, "⧉ Copy", "PNG");
  await p.waitFor(() => __clipboard.length > 0);
  t.check((await p.eval(() => __clipboard[0].type)) === "image/png", "copy PNG should put an image/png on the clipboard");
  t.check((await p.text("#toast")) === "Copied PNG to clipboard", "copy toast");
  await p.set("layout", "horizontal");
  t.golden("ba-horizontal.preview", await p.settle("#preview"));
  await p.shot("ba-horizontal", "#preview");
  await p.menu(BA_BAR, "⬇ Download", "SVG");
  t.golden("ba-horizontal.svg", (await p.downloads(7))[6].text);
});

test("before-after: session restore after reload", async (t) => {
  const p = await t.page("#/before-after");
  await p.choose("#tab-ba .panel", "Open project", FIX("before-after.json"));
  await p.settle("#preview");
  await sleep(400);   // session save is debounced
  await p.reload();
  t.golden("ba.preview", await p.settle("#preview"));
  await p.menu(BA_BAR, "⬇ Download", "SVG");
  t.golden("ba.export/checkout-redesign.svg", (await p.downloads(1))[0].text);
});

test("before-after: dropping two images fills a pair", async (t) => {
  const p = await t.page("#/before-after");
  await p.setFiles(`document.querySelector("#changes input[type=file]")`, [FIX("a.png"), FIX("b.png")]);
  await p.waitFor(() => __t.count("#changes .slot.filled") === 2);
});

test("tutorial: open a project and export", async (t) => {
  const p = await t.page("#/tutorial");
  await p.choose("#tab-tut .panel", "Open project", FIX("tutorial.json"));
  t.golden("tut.preview", await p.settle("#tutPreview"));
  t.golden("tut.dims", await p.text("#tutDims"));
  await p.shot("tut", "#tutPreview");
  await p.menu(TUT_BAR, "⬇ Download", "SVG");
  await p.menu(TUT_BAR, "⬇ Download", "PNG");
  await p.menu(TUT_BAR, "⬇ Each step", "SVG");
  t.goldenDownloads("tut.export", await p.downloads(5));
  await p.set("tutLayout", "horizontal");
  t.golden("tut-horizontal.preview", await p.settle("#tutPreview"));
  await p.menu(TUT_BAR, "⬇ Download", "SVG");
  t.golden("tut-horizontal.svg", (await p.downloads(6))[5].text);
});

test("tutorial: uploading several images makes one step each", async (t) => {
  const p = await t.page("#/tutorial");
  await p.setFiles(`document.getElementById("tutFiles")`, [FIX("a.png"), FIX("b.png"), FIX("c.png")]);
  await p.waitFor(() => __t.count("#tutorialSteps .tutorial-step") === 3 && __t.count("#tutorialSteps .slot.filled") === 3);
});

test("annotator: restore from session and export", async (t) => {
  const p = await t.page("#/annotator");
  await p.eval((d) => sessionStorage.setItem("beforeafter:v1", d), readFileSync(FIX("session-annotator.json"), "utf8"));
  await p.reload();
  await p.waitFor(() => __t.visible("#annoEditor"));
  await p.menu("#annoFoot", "⬇ Download", "SVG");
  await p.menu("#annoFoot", "⬇ Download", "PNG");
  t.goldenDownloads("anno.export", await p.downloads(2));
});

test("routing: hash selects the tool", async (t) => {
  const p = await t.page("#/annotator");
  t.check(await p.visible("#tab-anno .anno-page"), "annotator visible for #/annotator");
  t.check((await p.text("#modeTitle")) === "Annotator", "title follows tab");
  await p.eval(() => document.querySelector('.tab[data-tab="tut"]').click());
  await p.waitFor(() => location.hash === "#/tutorial");
  t.check(await p.visible("#tab-tut .editor"), "tutorial visible after tab click");
  const q = await t.page("#/nonsense");
  t.check((await q.eval(() => location.hash)) === "#/before-after", "unknown hash canonicalizes to before-after");
});

test("bug: opening a project keeps the visible tool live", async (t) => {
  // Opening a project used to adopt the tab it was saved from, so image changes redrew the wrong preview.
  const p = await t.page("#/before-after");
  await p.choose("#tab-ba .panel", "Open project", FIX("before-after.json"));
  const before = await p.settle("#preview");
  t.check(await p.visible("#tab-ba .editor"), "Before/After still visible");
  await p.setFiles(`document.querySelectorAll("#changes input[type=file]")[3]`, FIX("b.png"));
  t.check((await p.settle("#preview")) !== before, "adding an image redraws the Before/After preview");
});

test("bug: opening a project only replaces that tool", async (t) => {
  const p = await t.page("#/before-after");
  await p.set("title", "Mine");
  await p.setFiles(`document.getElementById("annoFile")`, FIX("c.png"));
  await p.eval(() => document.querySelector('.tab[data-tab="tut"]').click());
  await p.choose("#tab-tut .panel", "Open project", FIX("tutorial.json"));
  await p.settle("#tutPreview");
  t.check((await p.eval(() => document.getElementById("title").value)) === "Mine", "Before/After title untouched");
  await p.eval(() => document.querySelector('.tab[data-tab="anno"]').click());
  await sleep(200);
  t.check(await p.visible("#annoEditor"), "annotator image still shown");
});

test("projects: save and reopen round-trips per tool", async (t) => {
  const p = await t.page("#/before-after");
  await p.choose("#tab-ba .panel", "Open project", FIX("before-after.json"));
  await p.settle("#preview");
  await p.button("#tab-ba .panel", "Save project");
  const [ba] = await p.downloads(1);
  t.check(ba.name === "checkout-redesign.beforeafter.json", "before/after project file name: " + ba.name);
  t.check(JSON.parse(ba.text).kind === "before-after", "before/after project kind");
  const q = await t.page("#/before-after");
  await q.choose("#tab-ba .panel", "Open project", saveTmp("ba.json", ba.text));
  t.golden("ba.preview", await q.settle("#preview"));

  const r = await t.page("#/tutorial");
  await r.choose("#tab-tut .panel", "Open project", FIX("tutorial.json"));
  await r.settle("#tutPreview");
  await r.button("#tab-tut .panel", "Save project");
  const [tut] = await r.downloads(1);
  t.check(tut.name === "how-to-create-a-report.tutorial.json", "tutorial project file name: " + tut.name);
  t.check(JSON.parse(tut.text).kind === "tutorial", "tutorial project kind");
  // Opening a tutorial file from the Before/After tab loads it into the Tutorial tool and switches there.
  const s = await t.page("#/before-after");
  await s.choose("#tab-ba .panel", "Open project", saveTmp("tut.json", tut.text));
  await s.waitFor(() => location.hash === "#/tutorial");
  t.golden("tut.preview", await s.settle("#tutPreview"));
});

test("tutorial: steps with several screenshots", async (t) => {
  const p = await t.page("#/tutorial");
  await p.choose("#tab-tut .panel", "Open project", FIX("tutorial-multi.json"));
  t.golden("tut-multi.preview", await p.settle("#tutPreview"));
  await p.shot("tut-multi", "#tutPreview");
  await p.menu(TUT_BAR, "⬇ Download", "SVG");
  await p.menu(TUT_BAR, "⬇ Each step", "SVG");
  const d = await p.downloads(4);
  t.goldenDownloads("tut-multi.export", d);
  t.check(d.find((x) => x.name.startsWith("1-")).text.split("<image ").length - 1 === 2, "first step export contains both screenshots");
  await p.set("tutLayout", "horizontal");
  t.golden("tut-multi-horizontal.preview", await p.settle("#tutPreview"));
  await p.shot("tut-multi-horizontal", "#tutPreview");

  if (SHOTS) { await p.eval(() => document.querySelector("#tutorialSteps .tutorial-step").scrollIntoView({ block: "center" })); await p.screenshot("tut-multi-editor"); }
  const slotsIn = (n) => p.eval((i) => document.querySelectorAll("#tutorialSteps .tutorial-step")[i].querySelectorAll(".slot").length, n - 1);
  t.check((await slotsIn(1)) === 2 && (await slotsIn(3)) === 3, "editor shows each step's screenshots");
  // Dropping two images on a step's screenshot fills it and adds the extra to the same step.
  await p.setFiles(`document.querySelectorAll("#tutorialSteps .tutorial-step")[1].querySelector("input[type=file]")`, [FIX("a.png"), FIX("b.png")]);
  await p.waitFor(() => document.querySelectorAll("#tutorialSteps .tutorial-step")[1].querySelectorAll(".slot").length === 2);
  await p.eval(() => [...document.querySelectorAll("#tutorialSteps .tutorial-step")[2].querySelectorAll("button")].find((b) => b.textContent.includes("Add screenshot")).click());
  t.check((await slotsIn(3)) === 4, "Add screenshot adds a slot");
  await p.eval(() => document.querySelectorAll("#tutorialSteps .tutorial-step")[2].querySelector('button[title="Remove screenshot"]').click());
  t.check((await slotsIn(3)) === 3, "Remove screenshot removes a slot");
  t.check((await p.count("#tutorialSteps .tutorial-step")) === 3, "step count unchanged");
  // Pull the first step's second screenshot out into its own step, right after it.
  await p.eval(() => document.querySelectorAll("#tutorialSteps .tutorial-step")[0].querySelectorAll('button[title="Move to a new step"]')[1].click());
  t.check((await p.count("#tutorialSteps .tutorial-step")) === 4, "moving a screenshot out adds a step");
  t.check((await slotsIn(1)) === 1 && (await slotsIn(2)) === 1, "the screenshot left its step for the next one");
  t.check((await p.eval(() => document.querySelectorAll("#tutorialSteps .tutorial-step")[1].querySelector("input.cap").value)) === "Then this", "it keeps its caption");
  t.check((await p.eval(() => document.querySelectorAll("#tutorialSteps .tutorial-step")[0].querySelector('button[title="Move to a new step"]'))) === null, "no split button on a single-screenshot step");
});

test("editor controls: swap, reorder, labels, reverse, reset", async (t) => {
  const p = await t.page("#/before-after");
  const empty = await p.settle("#preview");
  await p.choose("#tab-ba .panel", "Open project", FIX("before-after.json"));
  const loaded = await p.settle("#preview");
  await p.eval(() => document.querySelector('#changes .pair button[title="Swap before and after"]').click());
  const swapped = await p.settle("#preview");
  t.check(swapped !== loaded, "swap changes the preview");
  await p.eval(() => document.querySelector('#changes .pair button[title="Swap before and after"]').click());
  t.check((await p.settle("#preview")) === loaded, "swapping back restores it");
  await p.eval(() => document.querySelector('#changes button[title="Move change down"]').click());
  t.check((await p.eval(() => document.querySelector("#changes .change input").value)) === "", "moving a change reorders the editor");
  // Pull the first change's second pair out into its own change, right after it.
  await p.eval(() => document.querySelectorAll('#changes .change')[1].querySelectorAll('button[title="Move this pair to a new change"]')[1].click());
  t.check(JSON.stringify(await p.eval(() => [...document.querySelectorAll("#changes .change")].map((c) => c.querySelectorAll(".pair").length))) === "[1,1,1]", "moving a pair out adds a change after it");
  t.check((await p.eval(() => document.querySelectorAll("#changes .change")[2].querySelector("input.cap").value)) === "Only a before image here", "the pair keeps its content");
  await p.set("beforeLabel", "WAS");
  t.check((await p.text("#changes .img-col.before .col-tag")) === "WAS", "label field updates column tags");
  await p.button("#tab-ba .panel", "Reset all");
  t.check((await p.settle("#preview")) === empty, "reset returns to an empty document");
  t.check((await p.eval(() => document.getElementById("title").value)) === "", "reset clears the form");

  const q = await t.page("#/tutorial");
  t.check(await q.eval(() => document.getElementById("reverseTutorialSteps").disabled), "reverse is disabled with no steps");
  await q.choose("#tab-tut .panel", "Open project", FIX("tutorial.json"));
  await q.settle("#tutPreview");
  await q.button("#tab-tut .editor", "Reverse step order");
  t.check((await q.eval(() => document.querySelector("#tutorialSteps .tutorial-step input").value)).startsWith("A long step title"), "reverse puts the last step first");
});

test("drag and drop: page, card and image targets", async (t) => {
  const counts = (p, card) => p.eval((c) => [...document.querySelectorAll(c)].map((el) => el.querySelectorAll(".slot").length), card);
  const hover = (p) => p.eval(() => ({ page: document.body.classList.contains("drop-page") ? document.body.dataset.dropLabel : null, cards: document.querySelectorAll(".drag").length }));

  // Tutorial: page → one step per image; step card → more screenshots; screenshot → replace it.
  const p = await t.page("#/tutorial");
  await p.dragOver([FIX("a.png")], await p.center("#tutPreviewWrap"));
  t.check((await hover(p)).page === "Drop images to add them as steps", "page outline while dragging over the page");
  await p.screenshot("drop-page");
  await p.drop([FIX("a.png"), FIX("b.png")], await p.center("#tutPreviewWrap"));
  await p.waitFor(() => __t.count("#tutorialSteps .slot.filled") === 2);
  t.check(JSON.stringify(await counts(p, ".tutorial-step")) === "[1,1]", "page drop adds one step per image");
  t.check((await hover(p)).page === null, "outline cleared after the drop");
  const stepHead = await p.center(".tutorial-step .idx", 0);
  await p.dragOver([FIX("c.png")], stepHead);
  const h1 = await hover(p);
  await p.screenshot("drop-step");
  t.check(h1.page === null && h1.cards === 1 && await p.eval(() => document.querySelector(".tutorial-step").classList.contains("drag")), "a step highlights instead of the page");
  await p.drop([FIX("c.png"), FIX("d.png")], stepHead);
  await p.waitFor(() => __t.count("#tutorialSteps .slot.filled") === 4);
  t.check(JSON.stringify(await counts(p, ".tutorial-step")) === "[3,1]", "step drop adds screenshots to that step");
  const before = await p.settle("#tutPreview");
  await p.dropAt([FIX("d.png")], await p.center(".tutorial-step .slot", 3));
  t.check((await p.settle("#tutPreview")) !== before, "image drop replaces the screenshot");
  t.check(JSON.stringify(await counts(p, ".tutorial-step")) === "[3,1]", "image drop adds nothing");

  // Before/After: page → a new change; change card → more pairs; image → replace.
  const q = await t.page("#/before-after");
  await q.dropAt([FIX("a.png"), FIX("b.png"), FIX("c.png")], await q.center("#previewWrap"));
  await q.waitFor(() => __t.count("#changes .slot.filled") === 3);
  t.check(JSON.stringify(await counts(q, ".change")) === "[2,4]", "page drop adds a change holding the images");
  await q.dropAt([FIX("a.png"), FIX("b.png")], await q.center(".change .idx", 0));
  await q.waitFor(() => __t.count("#changes .slot.filled") === 5);
  t.check(JSON.stringify(await counts(q, ".change")) === "[4,4]", "change drop adds a pair to that change");
  await q.dropAt([FIX("d.png")], await q.center(".change .slot", 1));
  await q.waitFor(() => __t.count("#changes .slot.filled") === 6);
  t.check(JSON.stringify(await counts(q, ".change")) === "[4,4]", "image drop fills just that slot");

  // Annotator: anywhere on the page loads (or replaces) the image.
  const r = await t.page("#/annotator");
  await r.dropAt([FIX("c.png")], await r.center(".tabs"));
  await r.waitFor(() => __t.visible("#annoEditor canvas"));
  const first = await r.settle("#annoEditor canvas");
  await r.dropAt([FIX("a.png")], await r.center("#annoFoot"));
  t.check((await r.settle("#annoEditor canvas")) !== first, "dropping again replaces the image");
});

test("drag to rearrange: screenshots between steps, pairs between changes", async (t) => {
  // Each step's screenshots by caption ("-" for none), so moves are checked by identity, not just by count.
  const shots = (p) => p.eval(() => [...document.querySelectorAll("#tutorialSteps .tutorial-step")].map((s) => [...s.querySelectorAll("input.cap")].map((c) => c.value || "-").join(",")));
  const marks = (p) => p.eval(() => [...document.querySelectorAll(".drop-before,.drop-after,.drag,.drop-page")].map((el) => `${el.className.match(/tutorial-step|change|pair|img-col|slot|^$/)?.[0] || el.tagName}:${[...el.classList].find((c) => c.startsWith("drop-") || c === "drag")}`));

  const p = await t.page("#/tutorial");
  await p.viewport(2600);   // everything on screen at once, so drags don't need scrolling
  await p.choose("#tab-tut .panel", "Open project", FIX("tutorial-multi.json"));
  await p.settle("#tutPreview");
  t.check(JSON.stringify(await shots(p)) === '["First,Then this","-","-,Middle,-"]', "starting steps: " + await shots(p));
  // Onto another step card: added at its end.
  await p.dragElement(await p.point(".tutorial-step .slot", 1), await p.point(".tutorial-step .idx", 1));
  t.check(JSON.stringify(await shots(p)) === '["First","-,Then this","-,Middle,-"]', "screenshot moved to the end of another step: " + await shots(p));
  // Onto the right half of a screenshot: placed after it (with a marker while hovering).
  const drop = await p.dragElement(await p.point(".tutorial-step .slot", 4), await p.point(".tutorial-step .img-col", 0, 0.8, 0.3), { hover: true });
  t.check(JSON.stringify(await marks(p)) === '["img-col:drop-after"]', "marker after the hovered screenshot: " + await marks(p));
  await p.screenshot("move-shot");
  await drop();
  t.check(JSON.stringify(await shots(p)) === '["First,Middle","-,Then this","-,-"]', "screenshot placed after the target: " + await shots(p));
  t.check(JSON.stringify(await marks(p)) === "[]", "markers cleared after the drop");
  // Out onto the page between steps 1 and 2: becomes a new step there.
  const gap = await p.eval(() => { const [a, b] = document.querySelectorAll("#tutorialSteps .tutorial-step"); const r = a.getBoundingClientRect(); return [r.left + 40, (r.bottom + b.getBoundingClientRect().top) / 2]; });
  const drop2 = await p.dragElement(await p.point(".tutorial-step .slot", 1), gap, { hover: true });
  t.check(JSON.stringify(await marks(p)) === '["BODY:drop-page","tutorial-step:drop-before"]', "page outline plus marker before step 2: " + await marks(p));
  await p.screenshot("move-new-step");
  await drop2();
  t.check(JSON.stringify(await shots(p)) === '["First","Middle","-,Then this","-,-"]', "screenshot became a new step: " + await shots(p));
  // A step's only screenshot into another step: the emptied step disappears (the steps merge).
  await p.dragElement(await p.point(".tutorial-step .slot", 1), await p.point(".tutorial-step .img-col", 0, 0.2, 0.3));
  t.check(JSON.stringify(await shots(p)) === '["Middle,First","-,Then this","-,-"]', "steps merged: " + await shots(p));

  // Before/After: pairs drag by their header; images swap.
  const pairs = (q) => q.eval(() => [...document.querySelectorAll("#changes .change")].map((c) => [...c.querySelectorAll(".pair")].map((p) => [...p.querySelectorAll("input.cap")].map((i) => i.value || "-").join("|")).join(" / ")));
  const q = await t.page("#/before-after");
  await q.viewport(2600);
  await q.choose("#tab-ba .panel", "Open project", FIX("before-after.json"));
  await q.settle("#preview");
  t.check(JSON.stringify(await pairs(q)) === '["Old nav|- / Only a before image here|-","-|Checker"]', "starting pairs: " + await pairs(q));
  await q.dragElement(await q.point(".pair-head .tag", 1), await q.point(".change .idx", 1));
  t.check(JSON.stringify(await pairs(q)) === '["Old nav|-","-|Checker / Only a before image here|-"]', "pair moved to the end of another change: " + await pairs(q));
  await q.dragElement(await q.point(".pair-head .tag", 2), await q.point(".pair", 1, 0.5, 0.2));
  t.check(JSON.stringify(await pairs(q)) === '["Old nav|-","Only a before image here|- / -|Checker"]', "pair placed before the target: " + await pairs(q));
  await q.dragElement(await q.point(".pair-head .tag", 0), await q.point("#previewWrap"));   // the only pair of a change, onto the preview
  t.check(JSON.stringify(await pairs(q)) === '["Only a before image here|- / -|Checker","Old nav|-"]', "pair became a new change at the end: " + await pairs(q));
  const before = await q.settle("#preview");
  await q.dragElement(await q.point("#changes .slot", 0), await q.point("#changes .slot", 1));   // before image onto the empty after slot
  t.check(JSON.stringify(await pairs(q)) === '["-|Only a before image here / -|Checker","Old nav|-"]', "images swapped: " + await pairs(q));
  const filled = await q.eval(() => [...document.querySelector("#changes .pair").querySelectorAll(".slot")].map((el) => el.classList.contains("filled")));
  t.check(JSON.stringify(filled) === "[false,true]" && (await q.settle("#preview")) !== before, "the image moved along with its caption: " + JSON.stringify(filled));
});

// The Annotator's annotations as saved to the session (ids replaced by indices, numbers rounded).
async function savedAnnotations(p) {
  await sleep(450);   // session save is debounced
  const anns = await p.eval(() => JSON.parse(sessionStorage.getItem("beforeafter:v1")).anno.annotations);
  const index = Object.fromEntries(anns.map((a, i) => [a.id, i]));
  return anns.map(({ id, ...a }) => Object.fromEntries(Object.entries(a).sort().map(([k, v]) =>
    [k, typeof v === "number" ? Math.round(v * 1e4) / 1e4 : (k === "fromRef" || k === "toRef") && v ? index[v] : v])));
}
const paletteRows = (p) => p.eval(() => [...document.querySelectorAll("#annoEditor .tp-row")].filter((r) => r.style.display !== "none").map((r) => r.querySelector(".lbl").textContent));
const activeTool = (p) => p.eval(() => document.querySelector("#annoEditor .tool.active").textContent);
const clickChip = (p, text) => p.eval((t) => [...document.querySelectorAll("#annoEditor .chip")].find((b) => b.textContent.startsWith(t)).click(), text);

test("annotator: drawing and styling with mouse and keyboard", async (t) => {
  const p = await t.page("#/annotator");
  await p.setFiles(`document.getElementById("annoFile")`, FIX("c.png"));
  await p.waitFor(() => __t.visible("#annoEditor canvas"));
  const at = await p.imagePoint("#annoEditor canvas", 400, 225);

  await p.key("2");
  t.check((await activeTool(p)).includes("Box"), "2 selects the box tool");
  t.golden("editor.rows.box", await paletteRows(p));
  await p.drag(at(0.1, 0.1), at(0.4, 0.5));
  t.check((await activeTool(p)).includes("Select"), "back to select after drawing a box");
  await clickChip(p, "Dash");
  await p.keyEvent("down", "c"); await p.key("3"); await p.keyEvent("up", "c");   // chord: 3rd color
  t.golden("editor.box", await savedAnnotations(p));

  await p.key("4");
  t.golden("editor.rows.number", await paletteRows(p));
  await p.click(at(0.8, 0.2));
  await clickChip(p, "ABC");
  await p.key("3");
  await p.drag(at(0.25, 0.3), at(0.8, 0.2));   // from inside the box to the stamp: pins both ends
  await p.key("5");
  await p.click(at(0.5, 0.8));
  await p.waitFor(() => __t.visible("#annoEditor textarea"));
  await p.send("Input.insertText", { text: "Hi" });
  await p.key("Enter");
  t.golden("editor.all", await savedAnnotations(p));

  await p.key("1");
  await p.drag(at(1.1, 1.1), at(-0.15, -0.15));   // box-select everything (starting clear of the palette in the top-left)
  t.golden("editor.rows.selection", await paletteRows(p));
  await p.key("Delete");
  t.check((await savedAnnotations(p)).length === 0, "Delete removes the selection");
  await p.key("z", 4);   // ⌘Z
  t.golden("editor.all", await savedAnnotations(p));
  await p.menu("#annoFoot", "⬇ Download", "SVG");
  t.golden("editor.export/annotated.svg", (await p.downloads(1))[0].text);
});

test("annotator: modal editing commits on Done and discards on Escape", async (t) => {
  const p = await t.page("#/before-after");
  await p.click(await p.center("#changes .slot"));
  t.check(!(await p.visible(".modal-backdrop.open")), "clicking an empty slot doesn't open the annotator");
  await p.setFiles(`document.querySelector("#changes input[type=file]")`, FIX("c.png"));
  const before = await p.settle("#preview");
  await p.eval(() => document.querySelector("#changes .anno-btn").click());
  await p.waitFor(() => __t.visible(".modal-backdrop.open canvas"));
  const at = await p.imagePoint(".modal canvas", 400, 225);
  await p.key("2");
  await p.drag(at(0.2, 0.2), at(0.6, 0.7));
  await p.button(".modal", "Done");
  t.check((await p.text("#changes .anno-btn")) === "✏ Annotate (1)", "Done commits the annotation");
  t.check((await p.settle("#preview")) !== before, "preview shows the annotation");
  await p.click(await p.center("#changes .slot"));   // clicking the image itself opens the annotator too
  await p.waitFor(() => __t.visible(".modal-backdrop.open canvas"));
  await p.key("2");
  await p.drag(at(0.5, 0.5), at(0.9, 0.9));
  await p.key("Escape");
  t.check(!(await p.visible(".modal-backdrop.open")), "Escape closes the modal");
  t.check((await p.text("#changes .anno-btn")) === "✏ Annotate (1)", "Escape discards the new annotation");
});

// ---------- runner ----------
const browser = await Browser.launch();
let failed = 0;
for (const { name, fn } of tests) {
  if (FILTER.length && !FILTER.some((f) => name.includes(f))) continue;
  const t = new Ctx(browser);
  try { await fn(t); } catch (e) { t.failures.push(e.message); }
  for (const p of t.pages) await browser.send("Target.closeTarget", { targetId: p.targetId }).catch(() => {});
  if (t.failures.length) { failed++; console.log(`✗ ${name}\n    ${t.failures.join("\n    ")}`); }
  else console.log(`✓ ${name}`);
}
if (UPDATE) { mkdirSync(GOLDEN, { recursive: true }); writeFileSync(HASHES, JSON.stringify(Object.fromEntries(Object.entries(values).sort()), null, 1) + "\n"); }
await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : "\nall passing");
process.exit(failed ? 1 : 0);
