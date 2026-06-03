const noop = () => {};

const ctx = {
  measureText: (text) => ({ width: String(text).length * 8 }),
  setTransform: noop,
  fillRect: noop,
  fillText: noop,
  beginPath: noop,
  moveTo: noop,
  lineTo: noop,
  stroke: noop,
  fill: noop,
  save: noop,
  restore: noop,
  arc: noop,
  rect: noop,
  clip: noop,
  drawImage: noop,
  strokeRect: noop,
  setLineDash: noop,
  arcTo: noop,
  closePath: noop,
};

const makeEl = () => ({
  nodeType: 1,
  style: {},
  hidden: false,
  innerHTML: "",
  textContent: "",
  value: "",
  checked: false,
  dataset: {},
  files: [],
  classList: {
    add: noop,
    remove: noop,
    toggle: noop,
    contains: () => false,
  },
  addEventListener: noop,
  append: noop,
  appendChild: noop,
  remove: noop,
  setAttribute: noop,
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  getContext: () => ctx,
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
});

globalThis.document = {
  createElement: makeEl,
  createTextNode: (text) => ({ nodeType: 3, text }),
  getElementById: makeEl,
  querySelectorAll: () => [],
  body: makeEl(),
  addEventListener: noop,
};
globalThis.window = {
  addEventListener: noop,
  devicePixelRatio: 1,
  innerWidth: 1200,
  innerHeight: 800,
};
globalThis.location = { hash: "", pathname: "/" };
globalThis.history = { replaceState: noop };
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: noop,
  removeItem: noop,
};
globalThis.Image = class {
  set src(value) {
    this._src = value;
    this.naturalWidth = 100;
    this.naturalHeight = 100;
    if (this.onload) this.onload();
  }

  get src() {
    return this._src;
  }
};
globalThis.FileReader = class {};
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: {} },
  configurable: true,
});
globalThis.ClipboardItem = class {};
globalThis.Blob = class {
  constructor(parts, opts) {
    this.parts = parts;
    this.opts = opts;
  }
};
globalThis.URL = {
  createObjectURL: () => "blob:",
  revokeObjectURL: noop,
};
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.confirm = () => false;
globalThis.alert = noop;

await import("../src/main.js");
console.log("module import ok");
