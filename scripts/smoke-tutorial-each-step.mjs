import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const requiredSnippets = [
  ['Tutorial each-step dropdown label', '⬇ Each step'],
  ['Each-step download helper', 'function downloadAllTutorialSteps(fmt)'],
  ['Each-step helper used by menu', 'onClick: () => downloadAllTutorialSteps(f)'],
  ['Tutorial layout options', 'function computeTutorialLayout(options = {})'],
  ['Per-step layout override', 'const steps = options.steps || tut.steps;'],
  ['Original step index offset', 'const startIndex = Number(options.startIndex) || 0;'],
  ['Step label uses original index', 'markerLabel(startIndex + idx + 1, tut.numbering)'],
  ['Heading omit option', 'if (!options.omitHeading)'],
  ['Per-step export omits heading and preserves index', 'computeTutorialLayout({ steps: [step], startIndex: idx, omitHeading: true })'],
  ['Per-step SVG export', 'buildTutorialSVGFromLayout'],
  ['Per-step filename fallback', 'slug(step.title || "step")'],
];

for (const [label, snippet] of requiredSnippets) {
  assert.ok(html.includes(snippet), `${label} missing: ${snippet}`);
}

console.log("tutorial each-step smoke checks passed");
