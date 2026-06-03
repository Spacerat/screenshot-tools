import { annoDoc, getCurrentTab, loadProject as applyProject, loadSaved, newChange, newTutorialStep, resetAll as resetAllState, resetTutorial as resetTutorialState, setCurrentTab, state, syncControls, syncTutorialControls } from './state.js';
import { mountShell } from './shell.js';
import { buildEditor, configureBeforeAfterEditor } from './before-after-editor.js';
import { addTutorialFiles, buildTutorialEditor, configureTutorialEditor } from './tutorial-editor.js';
import { configureImageHooks, dropAddChange, imageFiles, refreshAllSlotAnnotations, refreshSlot } from './images.js';
import { buildAnnoActions, configureAnnotator, hydrateAnno, isAnnotatorTextEditing, loadAnnoFile, navTo, showTab, tabFromLocation } from './annotator.js';
import { buildBarActions, buildTutorialActions, configureExport, drawPreview, drawTutorialPreview, openProjectFile, saveProject } from './export.js';
import { hydrateImages as hydrateImagesState } from './state.js';

mountShell();

function hydrateImages() {
  hydrateImagesState({ refreshSlot, drawPreview, drawTutorialPreview });
}

function loadProject(d) {
  applyProject(d, { syncControls, syncTutorialControls, buildEditor, buildTutorialEditor, hydrateImages, drawPreview, drawTutorialPreview });
}

function resetAll() {
  resetAllState({ buildEditor, drawPreview });
}

function resetTutorial() {
  resetTutorialState({ buildTutorialEditor, drawTutorialPreview });
}

function renderActivePreview() {
  getCurrentTab() === 'tut' ? drawTutorialPreview() : drawPreview();
}

configureImageHooks({ buildEditor, drawPreview, drawTutorialPreview, getCurrentTab, isAnnotatorTextEditing, loadAnnoFile });
configureBeforeAfterEditor({ drawPreview });
configureTutorialEditor({ drawTutorialPreview });
configureExport({ loadProject });
configureAnnotator({ drawTutorialPreview, refreshSlot, renderActivePreview });

// ---------- global controls ----------
const bind = (id, fn) => document.getElementById(id).addEventListener('input', fn);
bind('title', (e) => { state.title = e.target.value; drawPreview(); });
bind('beforeLabel', (e) => { state.beforeLabel = e.target.value; updateColTags(); drawPreview(); });
bind('afterLabel', (e) => { state.afterLabel = e.target.value; updateColTags(); drawPreview(); });
bind('bg', (e) => { state.bg = e.target.value; drawPreview(); });
bind('scale', (e) => { state.scale = Number(e.target.value); drawPreview(); });
bind('layout', (e) => { state.layout = e.target.value; drawPreview(); });
document.getElementById('dateEnabled').addEventListener('change', (e) => { state.dateEnabled = e.target.checked; drawPreview(); });
bind('dateText', (e) => { state.dateText = e.target.value; drawPreview(); });
bind('tutTitle', (e) => { state.tutorial.title = e.target.value; drawTutorialPreview(); });
bind('tutBg', (e) => { state.tutorial.bg = e.target.value; drawTutorialPreview(); });
bind('tutScale', (e) => { state.tutorial.scale = Number(e.target.value); drawTutorialPreview(); });
bind('tutLayout', (e) => { state.tutorial.layout = e.target.value; drawTutorialPreview(); });
bind('tutNumbering', (e) => { state.tutorial.numbering = e.target.value === 'letters' ? 'letters' : 'numbers'; drawTutorialPreview(); });

const addChangeBtn = document.getElementById('addChange');
addChangeBtn.addEventListener('click', () => { state.changes.push(newChange()); buildEditor(); drawPreview(); });
addChangeBtn.addEventListener('dragover', (e) => { e.preventDefault(); addChangeBtn.classList.add('drag'); });
addChangeBtn.addEventListener('dragleave', () => addChangeBtn.classList.remove('drag'));
addChangeBtn.addEventListener('drop', (e) => {
  e.preventDefault(); addChangeBtn.classList.remove('drag');
  const files = imageFiles(e.dataTransfer.files);
  if (files.length) dropAddChange(files);
});
document.getElementById('reset').addEventListener('click', resetAll);
document.getElementById('saveProject').addEventListener('click', () => saveProject(state.title));
const openInput = document.getElementById('openProjectInput');
document.getElementById('openProject').addEventListener('click', () => openInput.click());
document.getElementById('tutOpenProject').addEventListener('click', () => openInput.click());
openInput.addEventListener('change', (e) => { openProjectFile(e.target.files[0]); e.target.value = ''; });
document.getElementById('tutSaveProject').addEventListener('click', () => saveProject(state.tutorial.title || 'tutorial'));
document.getElementById('tutReset').addEventListener('click', resetTutorial);
const tutFiles = document.getElementById('tutFiles');
document.getElementById('tutBrowse').addEventListener('click', () => tutFiles.click());
tutFiles.addEventListener('change', (e) => { addTutorialFiles(e.target.files); e.target.value = ''; });
document.getElementById('addTutorialStep').addEventListener('click', () => {
  state.tutorial.steps.push(newTutorialStep());
  buildTutorialEditor(); drawTutorialPreview();
});

function updateColTags() {
  document.querySelectorAll('.img-col.before .col-tag').forEach((e) => e.textContent = state.beforeLabel || 'Before');
  document.querySelectorAll('.img-col.after .col-tag').forEach((e) => e.textContent = state.afterLabel || 'After');
}

// ---------- tab + annotator wiring ----------
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => navTo(b.dataset.tab)));
window.addEventListener('popstate', () => showTab(tabFromLocation() || getCurrentTab()));
window.addEventListener('resize', refreshAllSlotAnnotations);
const annoFile = document.getElementById('annoFile');
document.getElementById('annoBrowse').addEventListener('click', () => annoFile.click());
document.getElementById('annoReplace').addEventListener('click', () => annoFile.click());
annoFile.addEventListener('change', (e) => { loadAnnoFile(e.target.files[0]); e.target.value = ''; });
const annoDrop = document.getElementById('annoDrop');
annoDrop.addEventListener('dragover', (e) => { e.preventDefault(); annoDrop.classList.add('drag'); });
annoDrop.addEventListener('dragleave', () => annoDrop.classList.remove('drag'));
annoDrop.addEventListener('drop', (e) => { e.preventDefault(); annoDrop.classList.remove('drag'); loadAnnoFile(e.dataTransfer.files[0]); });

// ---------- init ----------
const restored = loadSaved();
syncControls();
syncTutorialControls();
buildBarActions();
buildAnnoActions();
buildTutorialActions();
buildEditor();
buildTutorialEditor();
if (restored) { hydrateImages(); hydrateAnno(); }
// The URL wins over the saved tab, so a shared /annotator/ link opens the right tool.
const initialTab = tabFromLocation() || getCurrentTab();
showTab(initialTab);
drawPreview();
drawTutorialPreview();
