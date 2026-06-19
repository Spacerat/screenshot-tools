import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const requiredSnippets = [
  ['Before/After paragraph control', '<textarea id="description"'],
  ['Tutorial paragraph control', '<textarea id="tutDescription"'],
  ['Before/After paragraph alignment control', '<select id="descriptionAlign">'],
  ['Tutorial paragraph alignment control', '<select id="tutDescriptionAlign">'],
  ['Before/After state field', 'description: "",'],
  ['Before/After alignment state field', 'descriptionAlign: "center",'],
  ['Tutorial state field', 'description: "",'],
  ['Tutorial alignment state field', 'descriptionAlign: "center",'],
  ['Before/After snapshot persistence', 'description: state.description'],
  ['Before/After alignment persistence', 'descriptionAlign: state.descriptionAlign'],
  ['Tutorial snapshot persistence', 'description: state.tutorial.description'],
  ['Tutorial alignment persistence', 'descriptionAlign: state.tutorial.descriptionAlign'],
  ['Before/After restore default', 'state.description = d.description || "";'],
  ['Before/After alignment restore default', 'state.descriptionAlign = d.descriptionAlign === "left" ? "left" : "center";'],
  ['Tutorial restore default', 'state.tutorial.description = tut.description || "";'],
  ['Tutorial alignment restore default', 'state.tutorial.descriptionAlign = tut.descriptionAlign === "left" ? "left" : "center";'],
  ['Before/After control sync', 'document.getElementById("description").value = state.description;'],
  ['Before/After alignment control sync', 'document.getElementById("descriptionAlign").value = state.descriptionAlign;'],
  ['Tutorial control sync', 'document.getElementById("tutDescription").value = state.tutorial.description;'],
  ['Tutorial alignment control sync', 'document.getElementById("tutDescriptionAlign").value = state.tutorial.descriptionAlign;'],
  ['Before/After input binding', 'bind("description", (e) => { state.description = e.target.value; drawPreview(); });'],
  ['Before/After alignment binding', 'bind("descriptionAlign", (e) => { state.descriptionAlign = e.target.value === "left" ? "left" : "center"; drawPreview(); });'],
  ['Tutorial input binding', 'bind("tutDescription", (e) => { state.tutorial.description = e.target.value; drawTutorialPreview(); });'],
  ['Tutorial alignment binding', 'bind("tutDescriptionAlign", (e) => { state.tutorial.descriptionAlign = e.target.value === "left" ? "left" : "center"; drawTutorialPreview(); });'],
  ['Before/After layout arguments', 'function computeLayout(title, description, descriptionAlign, changes)'],
  ['Tutorial layout description render', 'tut.description'],
  ['Tutorial layout description alignment render', 'tut.descriptionAlign'],
];

for (const [label, snippet] of requiredSnippets) {
  assert.ok(html.includes(snippet), `${label} missing: ${snippet}`);
}

console.log("title paragraph smoke checks passed");
