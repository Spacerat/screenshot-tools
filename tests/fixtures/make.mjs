// Regenerates the test fixtures: a few small PNGs, plus project files built from them.
// Usage: node tests/fixtures/make.mjs
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const out = (name) => new URL(name, import.meta.url);

function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Distinct sizes/aspects so layout and annotation-aspect maths get exercised.
const images = {
  a: png(320, 200, (x, y) => [(x >> 5) * 25, 80, (y >> 5) * 36, 255]),
  b: png(200, 300, (x, y) => (x > 40 && x < 160 && y > 60 && y < 120) ? [255, 255, 255, 255] : [30, 140, Math.round(255 * y / 300), 255]),
  c: png(400, 225, (x, y) => [200, Math.round(255 * (x + y) / 625), 60, 255]),
  d: png(240, 240, (x, y) => ((x >> 5) + (y >> 5)) % 2 ? [240, 240, 240, 255] : [90, 90, 200, 255]),
};
const url = {};
for (const [k, buf] of Object.entries(images)) {
  writeFileSync(out(`${k}.png`), buf);
  url[k] = "data:image/png;base64," + buf.toString("base64");
}

// Annotations covering every type, pinned arrows (incl. to a number, whose bbox depends on aspect),
// both text-background styles, and labels outside the image (which grow the export).
const richAnns = () => [
  { id: "b1", type: "box", x: 0.1, y: 0.1, w: 0.4, h: 0.3, color: "#ef4444", lineStyle: "dashed", lineWidth: "large" },
  { id: "t1", type: "text", x: 0.55, y: 0.6, text: "Two-line\nlabel", size: 22, color: "#3b82f6", bgOn: true },
  { id: "a1", type: "arrow", x1: 0.8, y1: 0.9, x2: 0.3, y2: 0.3, fromRef: "t1", toRef: "b1", color: "#f59e0b", lineStyle: "dotted", lineWidth: "small" },
  { id: "n1", type: "number", x: 0.9, y: 0.15, n: 1, size: 24, style: "letters", color: "#a855f7" },
  { id: "a2", type: "arrow", x1: 0.6, y1: 0.1, x2: 0.9, y2: 0.4, toRef: "n1", color: "#22c55e" },
  { id: "t2", type: "text", x: 1.05, y: 0.2, text: "Halo", size: 18, color: "#22c55e", bgOn: false },
  { id: "t3", type: "text", x: -0.3, y: 0.8, text: "White pill", size: 20, bgOn: true, color: "#ffffff" },
];

const shot = (dataUrl, caption = "", annotations = []) => ({ caption, dataUrl, annotations });
const write = (name, data) => writeFileSync(out(name), JSON.stringify(data));

write("before-after.json", {
  v: 2, kind: "before-after",
  title: "Checkout redesign", description: "Some context for the change.\nA second paragraph that is long enough to need wrapping across the full content width of the document.",
  descriptionAlign: "left", beforeLabel: "OLD", afterLabel: "NEW", bg: "#fafafa", scale: 1, layout: "vertical",
  dateEnabled: true, dateText: "May 26, 2026",
  changes: [
    { title: "Navigation bar", pairs: [
      { before: shot(url.a, "Old nav", richAnns()), after: shot(url.b, "", [{ id: "n2", type: "number", x: 0.5, y: 0.5, n: 2, size: 20, color: "#3b82f6" }]) },
      { before: shot(url.c, "Only a before image here"), after: shot(null) },
    ] },
    { title: "", pairs: [{ before: shot(url.d, "", [{ id: "b9", type: "box", x: -0.2, y: 0.4, w: 0.5, h: 0.3, color: "#111827" }]), after: shot(url.a, "Checker") }] },
  ],
});

write("tutorial.json", {
  v: 2, kind: "tutorial",
  title: "How to create a report", description: "Follow these steps.", descriptionAlign: "center", bg: "#ffffff", scale: 1,
  layout: "vertical", numbering: "letters",
  steps: [
    { title: "Open the menu", slots: [shot(url.a, "Click here", [{ id: "n3", type: "number", x: 0.2, y: 0.3, n: 1, size: 22, color: "#ef4444" }])] },
    { title: "", slots: [shot(url.b, "A step without a title")] },
    { title: "A long step title that should wrap across more than one line in the tutorial layout", slots: [shot(url.c, "", [{ id: "t4", type: "text", x: 0.1, y: 0.1, text: "Opaque", bgOn: true, color: "#3b82f6" }])] },
  ],
});

// A saved session with only the Annotator in use.
write("session-annotator.json", { v: 2, tab: "anno", anno: shot(url.d, "", richAnns()) });

// Tutorial steps with several screenshots each.
write("tutorial-multi.json", {
  v: 2, kind: "tutorial",
  title: "Multi-shot tutorial", description: "", descriptionAlign: "center", bg: "#ffffff", scale: 1, layout: "vertical", numbering: "numbers",
  steps: [
    { title: "Before and after clicking", slots: [shot(url.a, "First", [{ id: "b5", type: "box", x: 0.2, y: 0.2, w: 0.3, h: 0.3, color: "#ef4444" }]), shot(url.b, "Then this")] },
    { title: "Single shot", slots: [shot(url.c)] },
    { title: "Three shots", slots: [shot(url.d), shot(url.a, "Middle"), shot(null)] },
  ],
});
console.log("fixtures written");
