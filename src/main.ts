import './style.css';
import { TYPES, PROFILES, DIRECTIONS, activeParts, defaultRig, defaultPose, newDefinition, type EquipmentType, type PartKey, type Pose, type Project, type ItemDef, type SourcePart, type WeaponCutout } from './model';
import { AssetLibrary, readProjectFiles } from './library';
import { clientLayers, renderClientPose, type Outfit } from './compositor';
import { canvas, extractStrip, renderPart, generatePoses, shieldPoses, stripSource, expandDirections } from './artwork';
import { loadImage, canvasDataUrl, buildZip, dataUrlToBytes } from './carbon';
import { nextSpriteId, nativeBundle, validateExport } from './export';
import { parseProject } from './project';
import { validateCutoutImage } from './occlusion';
import { extractPalette, validateColorReplacements } from './palette';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const library = new AssetLibrary();
const fresh = (type: EquipmentType): Project => ({ version: 3, definition: newDefinition(type, library.defs), sourceParts: {}, autoRig: defaultRig(), replaceExisting: false });
let project = fresh('weapon'), selected: PartKey = 'main', uploadTarget: PartKey | undefined, pose = 0, playing = false;
let images = new Map<PartKey, HTMLImageElement>(), strips = new Map<PartKey, HTMLCanvasElement>();
const cutoutImages = new Map<string, HTMLImageElement>();
let defaultCutout: WeaponCutout | undefined;
let browsing: ItemDef | undefined, librarySelection: ItemDef | undefined, sourceTool: 'pivot' | 'colour' = 'pivot';
let outfit: Outfit = {}, renderError = '', history: Project[] = [], future: Project[] = [];
const drafts = new Map<EquipmentType, Project>();
const type = () => project.definition.equipmentType!;
const profile = () => PROFILES[type()];
const source = () => project.sourceParts[selected];
const snapshot = () => { history.push(structuredClone(project)); if (history.length > 30) history.shift(); future = []; };
function status(message: string, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
async function task(fn: () => Promise<void>) { try { await fn(); } catch (error) { status(error instanceof Error ? error.message : String(error), true); } }
function download(name: string, data: Blob | string) {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type: 'application/json' }) : data);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileData = (file: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
const input = (id: string) => $<HTMLInputElement>(id);
const number = (id: string) => Number(input(id).value);

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><div class="brand"><strong>OpenSpell <span>Item studio</span></strong><small id="operationLabel">New item</small></div>
<input id="name" aria-label="Item name" placeholder="Item name"><select id="type" aria-label="Equipment type"></select>
<button id="new">New item</button><button id="open">Open draft</button><button id="save">Save draft</button><button id="export" class="primary">Export…</button></header>
<main><aside class="library"><div class="section-title"><h2>Game items</h2><span id="count"></span></div>
<input id="search" type="search" placeholder="Search name or ID" aria-label="Find an item">
<div id="catalog"></div><div class="library-actions"><strong id="selectedItem">Select an item to preview</strong><small id="selectedInfo">Clone makes a new item. Edit original replaces it.</small><div class="two"><button id="clone" class="primary" disabled>Clone item</button><button id="editExisting" disabled>Edit original</button></div></div><details id="connection"><summary>Project library <span class="badge">optional</span></summary><p id="librarySource">Bundled OpenSpell assets</p><p class="muted">Connect your checkout to include custom items. PNG uploads work on their own.</p><button id="folderButton">Connect project folder</button><button id="carbonButton">Load asset files</button></details></aside>
<section class="workspace"><div class="stagebar"><span id="poseLabel"></span><div><button id="backToDraft" hidden>Back to draft</button><button id="undo" title="Undo edit">Undo</button><button id="redo" title="Redo edit">Redo</button><label><input id="character" type="checkbox" checked> Body</label><label><input id="guidesToggle" type="checkbox" checked> Pivot</label><button id="play">▶ Walk</button></div></div>
<div id="stage"><div class="canvas-stack"><canvas id="preview" width="64" height="128" aria-label="Equipped item preview"></canvas><svg id="guides" viewBox="0 0 64 128" aria-hidden="true"><g id="pivotMarker"><circle r="1.3"/><path d="M-3 0H3M0-3V3"/><text x="3" y="-2">PIVOT</text></g></svg></div><span id="empty">Upload a PNG, or select a game item to clone.</span></div>
<div class="canvas-help" id="canvasHelp">Drag to move · Scroll to rotate · Ctrl + scroll to resize · Shift + scroll to skew</div>
<div id="frames"></div><details class="outfit"><summary>Try with other equipment</summary><div id="outfit"></div></details></section>
<aside id="inspector" class="inspector" data-panel="artwork"><div id="libraryNotice" hidden><h2>Library preview</h2><p id="browseName"></p><p class="muted">Choose <b>Clone item</b> for a new item, or <b>Edit original</b> to change the existing one. Your current draft is kept while you browse.</p></div><div id="draftControls"><nav class="inspector-tabs" aria-label="Item editor"><button id="artworkTab" class="selected">Artwork</button><button id="coloursTab">Colours</button><button id="settingsTab">Item settings</button></nav><div id="layerControls"><h2>Item layers</h2><p id="hint" class="muted"></p><div id="layers"></div><button id="upload" class="wide">Upload PNG</button></div>
<div id="artworkControls" hidden><div id="sourceControls"><div class="source-tools"><small>Original source</small><button id="setPivot" class="selected">Set pivot</button><button id="pickColour">Pick colour</button></div><div class="sourcebox"><canvas id="source" aria-label="Original source; click to set pivot or pick a colour"></canvas></div><small id="sourceName"></small></div>
<div id="placementControls"><div class="two"><label>Pivot X<input id="anchorX" type="number"></label><label>Pivot Y<input id="anchorY" type="number"></label></div>
<label>Input <select id="mode"><option value="single">Single sprite → generate poses</option><option value="strip">Finished frame strip</option></select></label>
<div id="atlasControl" hidden><label>Item index in atlas <input id="atlasIndex" type="number" min="0" value="0"></label><button id="extract">Extract item</button></div>
<button id="expand" class="wide" hidden>Repeat 5 directions into 15 frames</button>
<div id="migration" hidden><p>Select one frame (1–15) for each direction:</p><div id="migrationInputs" class="five"></div><button id="convert">Use these 5 frames</button></div>
<label id="cutoutControl">Automatic cutouts<select id="cutoutMode"><option value="hands-body">Hands + rear body</option><option value="hands">Hands only</option><option value="none">Off</option></select><small>Leaves room for the character’s hands and body. Included in exported PNGs; your source image stays intact.</small></label>
<div id="rigControls"><div class="two"><label>Generation size<input id="rigScale" type="number" step="0.1" min="0.05"></label></div>
<button id="generate" class="primary wide">Generate 15 poses</button><small id="rigNote"></small>
<details><summary>Generation settings</summary><div class="two"><label>Rotation<input id="baseRotation" type="number"></label><label>Side compression<input id="sideCompression" type="number"></label><label>Skew<input id="skewStrength" type="number"></label><label>X offset<input id="xOffset" type="number"></label><label>Y offset<input id="yOffset" type="number"></label></div></details></div>
<details open><summary>Edit this frame <span id="editFrame"></span></summary><small>Drag the artwork in the preview. Scroll to rotate around the pivot.</small><div class="three" id="poseFields"></div><div class="checks"><label><input id="visible" type="checkbox"> Visible</label><label><input id="flip" type="checkbox"> Flip</label></div><div class="two"><button id="copy">Copy previous</button><button id="reset">Reset frame</button></div></details>
</div><details id="colours" open><summary>Colour replacement</summary><div id="palette"></div><small>Pick a swatch or use Pick colour on the source.</small><div class="two"><label>From<input id="replaceFrom" type="color" value="#808080"></label><label>To<input id="replaceTo" type="color" value="#c76035"></label></div><label>Match nearby shades <input id="colourTolerance" type="range" min="0" max="100" value="10"><span id="toleranceValue">10</span></label><label><input id="keepShading" type="checkbox" checked> Keep shading</label><button id="applyColour" class="wide">Apply replacement</button><div id="colourRules"></div><details><summary>Tint entire layer</summary><div class="two tint"><label>Colour <input id="tint" type="color" value="#e85d36"></label><button id="clearTint">Clear tint</button></div></details></details>
<div class="two"><button id="layerExport">Save layer PNG</button><button id="remove">Remove layer</button></div></div>
<details id="metadata" open><summary>Item settings</summary><label>Description<textarea id="description" rows="2"></textarea></label><div class="two"><label>Item ID<input id="itemId" type="number" min="0"></label><label>Cost<input id="cost" type="number" min="0"></label><label>Weight<input id="weight" type="number" min="0" step="0.1"></label><label id="speedLabel">Weapon speed<input id="weaponSpeed" type="number" min="1"></label></div>
<label><input id="hides" type="checkbox"> Hide clothing / hair underneath</label><small id="hideNote"></small><label><input id="tradeable" type="checkbox"> Tradeable</label>
<details><summary>Native sprite</summary><p id="nativeModeNote" class="muted"></p><label>Sprite ID<input id="spriteId" type="number" min="0"></label><small>Trims are managed by the trim layers above.</small></details></details></div></aside></main>
<footer><span id="status" role="status">Loading the bundled game library…</span><span id="target"></span></footer>
<dialog id="exportDialog"><h2>Export your item</h2><p>Your editable draft is included with either download.</p><button id="pack" class="export-choice"><strong>Sprite pack</strong><span>PNG layers + item definition. No carbon files required.</span></button><button id="native" class="export-choice"><strong>OpenSpell patch</strong><span>Full appearance bundle + item definition, using your current library.</span></button><p class="muted">Inventory icons are separate. Check item settings and preview the other equipment you expect players to wear.</p><button id="closeExport">Cancel</button></dialog>
<input id="pngFile" type="file" accept="image/png" hidden><input id="projectFile" type="file" accept=".json" hidden><input id="carbonFiles" type="file" accept=".carbon,.json" multiple hidden><input id="folder" type="file" webkitdirectory multiple hidden>`;

for (const t of TYPES) $<HTMLSelectElement>('type').add(new Option(PROFILES[t].label, t));
for (const field of ['x', 'y', 'rotation', 'skewX', 'scaleX', 'scaleY']) {
  const label = document.createElement('label'); label.textContent = field;
  const el = document.createElement('input'); el.id = `pose-${field}`; el.type = 'number'; el.step = field.startsWith('scale') ? '0.05' : '1'; label.append(el); $('poseFields').append(label);
  el.addEventListener('change', () => editPose(p => { (p as any)[field] = Number(el.value); }));
}
for (let d = 0; d < 5; d++) {
  const group = document.createElement('div'); group.className = 'direction';
  const label = document.createElement('small'); label.textContent = DIRECTIONS[d]; group.append(label);
  for (let f = 0; f < 3; f++) {
    const index = d * 3 + f, button = document.createElement('button'); button.title = `${DIRECTIONS[d]}, frame ${f + 1}`; button.dataset.pose = String(index);
    const c = canvas(64); c.id = `frame-${index}`; button.append(c); button.onclick = () => { pose = index; updatePoseFields(); render(); }; group.append(button);
  }
  $('frames').append(group);
  const el = document.createElement('input'); el.type = 'number'; el.min = '1'; el.max = '15'; el.value = String(d * 3 + 1); el.id = `direction-${d}`; el.title = DIRECTIONS[d]; $('migrationInputs').append(el);
}

function effectiveDefinition(): ItemDef {
  const def = { ...project.definition };
  if (!project.replaceExisting && type() !== 'projectile') def.equipmentSpriteId = nextSpriteId(library.entries, library.images, library.defs, type());
  def.equipmentSpriteSheet = profile().sheet;
  if (activeParts(def).some(p => p.trim && strips.has(p.key))) { if (!project.replaceExisting || def.equipmentTrimSpriteId == null || def.equipmentTrimSpriteId < 0) def.equipmentTrimSpriteId = nextSpriteId(library.entries, library.images, library.defs, type(), true); def.equipmentTrimSpriteSheet = profile().sheet.replace('1', 'trim1'); }
  else { def.equipmentTrimSpriteId = null; def.equipmentTrimSpriteSheet = null; }
  return def;
}
function poseLayers() {
  const layers = clientLayers({ ...outfit, [type()]: browsing || effectiveDefinition() });
  if (browsing) return layers.filter(l => input('character').checked || !!l.slot);
  return layers.filter(l => (input('character').checked || !!l.slot) && (l.slot !== type() || l.supplemental || strips.has(l.part as PartKey)));
}
function drawPose(c: HTMLCanvasElement, index: number) {
  renderClientPose(c.getContext('2d')!, index, poseLayers(), library.images, l => !browsing && l.slot === type() && !l.supplemental ? strips.get(l.part as PartKey) : undefined);
}
function rebuild() {
  strips = new Map(); renderError = '';
  for (const part of activeParts(project.definition)) {
    const s = project.sourceParts[part.key], img = images.get(part.key);
    const hands = s?.cutout && cutoutImages.get(s.cutout.hands), rear = s?.cutout && cutoutImages.get(s.cutout.rear);
    if (s && img) try { strips.set(part.key, renderPart(s, img, profile().frames, hands && rear ? { hands, rear } : undefined)); } catch (e) { renderError = (e as Error).message; }
  }
  render(); if (renderError) status(renderError, true);
}
function render() {
  drawPose($<HTMLCanvasElement>('preview'), pose);
  for (let i = 0; i < 15; i++) { drawPose($<HTMLCanvasElement>(`frame-${i}`), i); document.querySelector(`[data-pose="${i}"]`)?.classList.toggle('selected', i === pose); }
  $('poseLabel').textContent = `${browsing ? 'Library · ' : ''}${DIRECTIONS[Math.floor(pose / 3)]} · frame ${pose % 3 + 1}`;
  $('empty').hidden = !!browsing || strips.size > 0 || type() === 'projectile';
  $('backToDraft').hidden = !browsing; $('libraryNotice').hidden = !browsing; $('draftControls').hidden = !!browsing;
  input('name').disabled = !!browsing; $('save').toggleAttribute('disabled', !!browsing); $('export').toggleAttribute('disabled', !!browsing);
  $('browseName').textContent = browsing?.name || '';
  $('preview').classList.toggle('read-only', !!browsing);
  $('canvasHelp').textContent = browsing ? 'Library preview — choose Clone item or Edit original to make changes.' : 'Drag to move · Scroll to rotate · Ctrl + scroll to resize · Shift + scroll to skew';
  $('undo').toggleAttribute('disabled', !history.length); $('redo').toggleAttribute('disabled', !future.length);
  const id = effectiveDefinition().equipmentSpriteId;
  $('target').textContent = type() === 'projectile' ? 'Metadata only' : `${profile().frames} frames · ${profile().sheet} #${id} · ${project.replaceExisting ? 'replace' : 'append'}`;
  drawGuides();
}
function drawGuides() {
  const s = source(); $('guides').toggleAttribute('hidden', !!browsing || !s || !images.has(selected) || !input('guidesToggle').checked);
  const p = currentPose(), x = p.x + (s?.mode === 'strip' ? s.anchor.x : 0), y = p.y + (s?.mode === 'strip' ? s.anchor.y : 0);
  $('pivotMarker').setAttribute('transform', `translate(${x} ${y}) rotate(${p.rotation})`);
}
function currentPose(): Pose {
  const s = source();
  return s?.poses?.[pose] || { ...defaultPose(), x: s?.mode === 'strip' ? 0 : 32, y: s?.mode === 'strip' ? 0 : 64 };
}
function editPose(edit: (p: Pose) => void, saveHistory = true) {
  const s = source(); if (!s || browsing) return;
  if (saveHistory) snapshot();
  s.poses ??= Array.from({ length: 15 }, () => ({ ...defaultPose(), x: s.mode === 'strip' ? 0 : 32, y: s.mode === 'strip' ? 0 : 64 }));
  const indices = profile().frames === 5 ? [Math.floor(pose / 3) * 3, Math.floor(pose / 3) * 3 + 1, Math.floor(pose / 3) * 3 + 2] : [pose];
  for (const i of indices) edit(s.poses[i]);
  rebuild(); updatePoseFields();
}
function updatePoseFields() {
  const p = currentPose(); $('editFrame').textContent = `· ${pose + 1}`;
  for (const k of ['x', 'y', 'rotation', 'skewX', 'scaleX', 'scaleY'] as const) input(`pose-${k}`).value = String(Math.round(p[k] * 100) / 100);
  input('visible').checked = p.visible; input('flip').checked = p.flipX;
  drawSource(); drawGuides();
}
function drawSource() {
  const s = source(), img = images.get(selected); if (!s || !img) return;
  const c = $<HTMLCanvasElement>('source'), strip = s.mode === 'strip' && img.height === 128 && [320,960].includes(img.width);
  c.width = strip ? 64 : img.width; c.height = img.height;
  const frame = img.width === 320 ? Math.floor(pose / 3) : profile().frames === 5 ? s.legacyFrames?.[Math.floor(pose / 3)] ?? Math.floor(pose / 3) * 3 : pose;
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  if (strip) ctx.drawImage(img, frame * 64, 0, 64, 128, 0, 0, 64, 128); else ctx.drawImage(img, 0, 0);
  if (sourceTool === 'pivot') { ctx.strokeStyle = '#ffce6a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.anchor.x - 4, s.anchor.y); ctx.lineTo(s.anchor.x + 4, s.anchor.y); ctx.moveTo(s.anchor.x, s.anchor.y - 4); ctx.lineTo(s.anchor.x, s.anchor.y + 4); ctx.stroke(); }
}
function updateSource() {
  const s = source(), img = images.get(selected); $('artworkControls').hidden = !s || !img;
  if (!s || !img) return;
  drawSource();
  $('sourceName').textContent = `${s.fileName} · ${img.width} × ${img.height}`;
  $<HTMLSelectElement>('mode').value = s.mode; $('rigControls').hidden = s.mode !== 'single';
  $('cutoutControl').hidden = type() !== 'weapon'; $<HTMLSelectElement>('cutoutMode').value = s.cutout?.mode || 'none';
  $('atlasControl').hidden = !s.atlasDataUrl;
  $('expand').hidden = !(img.width === 320 && img.height === 128 && profile().frames === 15 && s.mode === 'strip');
  $('migration').hidden = !(s.requiresDirections || img.width === 960 && profile().frames === 5 && s.mode === 'strip' && !s.legacyFrames);
  input('anchorX').value = String(s.anchor.x); input('anchorY').value = String(s.anchor.y); input('rigScale').value = String(project.autoRig.scale);
  for (const k of ['baseRotation', 'sideCompression', 'skewStrength', 'xOffset', 'yOffset'] as const) input(k).value = String(project.autoRig[k]);
  input('tint').value = s.tint || '#e85d36';
  $('generate').textContent = `Generate ${profile().frames === 5 ? '5 directions' : '15 poses'}`;
  $('rigNote').textContent = type() === 'weapon' ? 'Uses an adjustable hand-placement preset. Check the grip in each frame.' : type() === 'shield' ? 'Uses native shield placement and visibility. The same source supplies both faces until you replace the rear artwork.' : 'Rigid prototype: transforms cannot invent rear artwork or bend armour. Use a template for a finished fit.';
  updatePoseFields();
  updateColours();
}
function chooseColour(hex: string) {
  input('replaceFrom').value = hex;
  const rule = source()?.replacements?.find(r => r.from.toLowerCase() === hex.toLowerCase());
  if (rule) { input('replaceTo').value = rule.to; input('colourTolerance').value = String(rule.tolerance); input('keepShading').checked = rule.preserveShading; }
  $('toleranceValue').textContent = input('colourTolerance').value;
}
function updateColours() {
  $('palette').replaceChildren(); $('colourRules').replaceChildren();
  const s = source(), img = images.get(selected); if (!s || !img) return;
  const c = canvas(img.width,img.height); c.getContext('2d')!.drawImage(img,0,0);
  for (const colour of extractPalette(c.getContext('2d')!.getImageData(0,0,c.width,c.height).data,24)) {
    const b = document.createElement('button'); b.className='swatch'; b.style.backgroundColor=colour.hex; b.title=`${colour.hex} · ${colour.count} pixels`; b.setAttribute('aria-label',`Select ${colour.hex}`); b.onclick=()=>chooseColour(colour.hex); $('palette').append(b);
  }
  for (const [i, rule] of (s.replacements || []).entries()) {
    const row = document.createElement('div'); row.className='colour-rule';
    const enabled = document.createElement('input'); enabled.type='checkbox'; enabled.checked=rule.enabled!==false; enabled.setAttribute('aria-label',`Enable replacement ${i+1}`); enabled.onchange=()=>{snapshot();rule.enabled=enabled.checked;rebuild();};
    const edit=document.createElement('button'); edit.className='rule-edit'; edit.title='Edit this replacement';
    for(const colour of [rule.from,rule.to]) { const chip=document.createElement('span');chip.style.backgroundColor=colour;chip.className='rule-swatch';edit.append(chip); }
    const label=document.createElement('small');label.textContent=`${rule.from} → ${rule.to}`;edit.append(label);edit.onclick=()=>chooseColour(rule.from);
    const remove=document.createElement('button');remove.textContent='×';remove.title='Remove replacement';remove.onclick=()=>{snapshot();s.replacements!.splice(i,1);updateColours();rebuild();};
    row.append(enabled,edit,remove);$('colourRules').append(row);
  }
}
function updateUI(refreshLibrary = false) {
  input('name').value = project.definition.name; $<HTMLSelectElement>('type').value = type();
  $('operationLabel').textContent = project.replaceExisting ? `Editing original #${project.definition._id}` : project.templateId != null ? `Clone of #${project.templateId} · new #${project.definition._id}` : `New item #${project.definition._id}`;
  $('nativeModeNote').textContent = project.replaceExisting ? 'Export replaces this original item and its shared artwork.' : 'Export appends new artwork. Existing items stay unchanged.';
  input('itemId').disabled = project.replaceExisting;
  $('hint').textContent = profile().hint; $('upload').hidden = type() === 'projectile';
  $('layers').replaceChildren();
  for (const spec of activeParts(project.definition)) {
    const row = document.createElement('div'); row.className = 'layer-row'; row.dataset.part = spec.key;
    row.style.display = 'grid'; row.style.gridTemplateColumns = '1fr auto'; row.style.gap = '5px'; row.style.marginBottom = '5px';
    const button = document.createElement('button'); button.className = `layer ${selected === spec.key ? 'selected' : ''}`;
    button.textContent = `${project.sourceParts[spec.key] ? '●' : '+'} ${spec.label}${spec.trim ? ' (optional)' : ''}`;
    button.onclick = () => { selected = spec.key; updateUI(); };
    const upload = document.createElement('button'); upload.id = `upload-${spec.key}`; upload.className = 'layer-upload'; upload.textContent = 'Upload'; upload.title = `Upload ${spec.label.toLowerCase()}`;
    upload.onclick = event => { event.stopPropagation(); selected = uploadTarget = spec.key; input('pngFile').click(); };
    row.append(button, upload); $('layers').append(row);
  }
  for (const [id, key] of [['description', 'description'], ['itemId', '_id'], ['cost', 'cost'], ['weight', 'weight'], ['spriteId', 'equipmentSpriteId'], ['weaponSpeed', 'weaponSpeed']]) input(id).value = String(project.definition[key] ?? '');
  input('hides').checked = !!project.definition.hidesSpritesUnderneath; input('tradeable').checked = !!project.definition.isTradeable;
  input('spriteId').disabled = !project.replaceExisting; $('speedLabel').hidden = type() !== 'weapon';
  $('hideNote').textContent = type() === 'legs' ? 'The current client still draws base pants; this flag is stored but not applied to legs.' : type() === 'helmet' ? 'Hides hair and beard.' : type() === 'chest' ? 'Hides the base shirt.' : 'Only chest and helmet use this flag in the current renderer.';
  updateSource(); rebuild(); if (refreshLibrary) { catalog(); outfitControls(); }
}
function catalog() {
  const q = input('search').value.toLowerCase(); $('catalog').replaceChildren();
  const defs = library.items().filter(d => d.equipmentType === type() && `${d.name} ${d._id}`.toLowerCase().includes(q));
  $('count').textContent = String(defs.length);
  for (const def of defs) {
    const button = document.createElement('button'); button.className = `item ${librarySelection?._id === def._id ? 'selected' : ''}`; button.title = `Preview ${def.name} (#${def._id})`;
    const c = canvas(64); renderClientPose(c.getContext('2d')!, type() === 'back' ? 12 : 0, clientLayers({ [type()]: def }), library.images);
    const text = document.createElement('span'); text.textContent = def.name; const small = document.createElement('small'); small.textContent = `#${def._id}`; text.append(small); button.append(c, text);
    button.onclick = () => { librarySelection = browsing = def; catalog(); render(); status(`Previewing ${def.name}. Choose Clone item or Edit original.`); }; $('catalog').append(button);
  }
  const available = librarySelection?.equipmentType === type();
  $('clone').toggleAttribute('disabled', !available); $('editExisting').toggleAttribute('disabled', !available);
  $('selectedItem').textContent = available ? librarySelection!.name : 'Select an item to preview';
  $('selectedInfo').textContent = available ? `#${librarySelection!._id} · ${librarySelection!.equipmentSpriteSheet || 'metadata'} · sprite ${librarySelection!.equipmentSpriteId ?? '—'}` : 'Clone makes a new item. Edit original replaces it.';
}
function outfitControls() {
  $('outfit').replaceChildren();
  for (const t of TYPES.filter(t => t !== type() && t !== 'projectile')) {
    const label = document.createElement('label'); label.textContent = PROFILES[t].label; const select = document.createElement('select'); select.add(new Option('None', ''));
    for (const d of library.items().filter(d => d.equipmentType === t)) select.add(new Option(d.name, String(d._id)));
    select.value = String(outfit[t]?._id ?? ''); select.onchange = () => { outfit[t] = library.defs.find(d => String(d._id) === select.value); render(); }; label.append(select); $('outfit').append(label);
  }
}
async function restore(next: Project) {
  const decoded = new Map<PartKey, HTMLImageElement>();
  for (const [key, part] of Object.entries(next.sourceParts)) if (part?.dataUrl) decoded.set(key as PartKey, await loadImage(part.dataUrl));
  for (const part of Object.values(next.sourceParts)) if (part?.cutout) for (const url of [part.cutout.hands, part.cutout.rear]) {
    if (!cutoutImages.has(url)) { const image = await loadImage(url); validateCutoutImage(image); cutoutImages.set(url, image); }
  }
  if (next.definition.equipmentType !== type() || next.definition.equipmentType === 'projectile') showPanel(next.definition.equipmentType === 'projectile' ? 'settings' : 'artwork');
  project = next; images = decoded; browsing = undefined; selected = activeParts(project.definition)[0]?.key || 'main'; updateUI(true);
}
function attachCutout(s: SourcePart) {
  if (type() === 'weapon' && !s.cutout) {
    if (!defaultCutout) throw new Error('Automatic cutout references could not load. Refresh the studio to retry.');
    s.cutout = structuredClone(defaultCutout);
  }
}
async function useTemplate(def: ItemDef, replaceExisting = false) {
  const next = fresh(def.equipmentType!); next.definition = { ...structuredClone(def), _id: replaceExisting ? def._id : next.definition._id, name: replaceExisting ? def.name : `${def.name} copy` }; next.templateId = def._id; next.replaceExisting = replaceExisting;
  for (const spec of activeParts(next.definition)) {
    const id = spec.special ? 0 : spec.trim ? def.equipmentTrimSpriteId : def.equipmentSpriteId;
    if (id == null || id < 0 || spec.trim && !def.equipmentTrimSpriteSheet) continue;
    const img = library.images.get(spec.atlas); if (!img) throw new Error(`Missing ${spec.atlas} in this library.`);
    const strip = extractStrip(img, PROFILES[def.equipmentType!].frames, id);
    const unbaked = canvasDataUrl(strip);
    const specialGloves = def.equipmentType === 'gloves' && [611,612,613,614,615,616].includes(def._id);
    if (specialGloves && !replaceExisting) strip.getContext('2d')!.drawImage(extractStrip(img, 15, 12), 0, 0);
    const s = stripSource(strip, `${def.name} · ${spec.label}`);
    if (specialGloves) { s.unbakedDataUrl = unbaked; s.bakedDataUrl = s.dataUrl; }
    next.sourceParts[spec.key] = s;
  }
  snapshot(); await restore(next); status(replaceExisting ? `Editing original ${def.name} (#${def._id}). Export will replace its shared artwork.` : def._id === 617 ? 'Pumpkin copied without its special rear layer: new helmet IDs cannot render that layer.' : `Copied ${def.name}. This draft gets a new item ID and new artwork.`);
}
async function setSource(dataUrl: string, fileName: string) {
  const img = await loadImage(dataUrl), pending = source(); snapshot();
  const isStrip = img.height === 128 && [320,960].includes(img.width);
  const isAtlas = img.width % 64 === 0 && img.height % 128 === 0 && (img.height > 128 || img.width > 960);
  let s = { dataUrl, fileName, mode: isStrip || isAtlas ? 'strip' as const : 'single' as const, anchor: { x: Math.round(img.width / 2), y: Math.round(img.height * (type() === 'shield' ? .35 : .75)) } } as NonNullable<ReturnType<typeof source>>;
  let decoded = img;
  if (isStrip) s.anchor = { x: 32, y: 64 };
  if (isAtlas) { s = { ...stripSource(extractStrip(img, profile().frames, 0), fileName), atlasDataUrl: dataUrl }; decoded = await loadImage(s.dataUrl); }
  if (s.mode === 'single') s.poses = generatePoses(type(), project.autoRig);
  if (pending?.mode === 'single' && s.mode === 'single') { s = { ...s, ...pending, dataUrl, fileName }; decoded = img; }
  if (type() === 'weapon') { await maskReady; attachCutout(s); }
  project.sourceParts[selected] = s; images.set(selected, decoded); updateUI();
  if (!renderError) status(s.mode === 'single' ? 'Sprite placed in all frames. Click its grip point, set size, then generate poses.' : 'Artwork loaded. Pick any frame to inspect or adjust it.');
}
function generate() {
  const s = source(); if (!s) { status('Upload a PNG or choose a template first.', true); return; }
  snapshot(); s.mode = 'single'; s.poses = generatePoses(type(), project.autoRig); delete s.requiresDirections; delete s.legacyFrames; attachCutout(s);
  if (type() === 'shield' && (selected === 'front' || selected === 'back')) {
    const mate: PartKey = selected === 'front' ? 'back' : 'front';
    const front = library.images.get('shield_front1.png'), back = library.images.get('shield_back1.png');
    const nativeId = library.defs.find(d => d._id === project.templateId && d.equipmentType === 'shield')?.equipmentSpriteId ?? 0;
    const make = (side: 'front' | 'back') => front && back ? shieldPoses(front, back, nativeId, project.autoRig, side) : generatePoses('shield', project.autoRig).map((p,i) => ({...p,visible:side==='front'?i<9:i>=9}));
    s.poses = make(selected);
    if (!project.sourceParts[mate]) { const m = structuredClone(s); m.poses = make(mate as 'front' | 'back'); project.sourceParts[mate] = m; images.set(mate, images.get(selected)!); }
  }
  pose = 0; updateUI(); status(type() === 'shield' ? 'Shield prototype generated with front / rear visibility. Replace rear artwork if it differs, and check the grip in each frame.' : `Generated ${profile().frames} poses. All frames are editable.`);
}

$('upload').onclick = () => { uploadTarget = selected; input('pngFile').click(); }; input('pngFile').onchange = () => task(async () => { const f = input('pngFile').files?.[0]; if (f) { selected = uploadTarget ?? selected; await setSource(await fileData(f), f.name); } uploadTarget = undefined; input('pngFile').value = ''; });
$('open').onclick = () => input('projectFile').click(); input('projectFile').onchange = () => task(async () => { const f = input('projectFile').files?.[0]; if (f) { const next = parseProject(await f.text()); snapshot(); await restore(next); if (!renderError) status('Draft loaded.'); } input('projectFile').value = ''; });
$('save').onclick = () => { download('item-project-v3.json', JSON.stringify(project, null, 2)); status('Saved draft with source images and frame settings.'); };
$('new').onclick = () => task(async () => { snapshot(); await restore(fresh(type())); showPanel(type()==='projectile'?'settings':'artwork'); status('New item. Upload a PNG or choose a starting item.'); });
$('type').onchange = () => task(async () => { const t = $<HTMLSelectElement>('type').value as EquipmentType; drafts.set(type(), structuredClone(project)); snapshot(); await restore(drafts.get(t) || fresh(t)); });
$('name').onchange = () => { snapshot(); project.definition.name = input('name').value; };
$('search').oninput = catalog;
$('clone').onclick = () => task(async () => { if (librarySelection) await useTemplate(librarySelection); });
$('editExisting').onclick = () => task(async () => { if (librarySelection) await useTemplate(librarySelection, true); });
$('backToDraft').onclick = () => { browsing = undefined; render(); };
$('undo').onclick = () => task(async () => { const next = history.pop(); if (next) { future.push(structuredClone(project)); await restore(next); status('Undid edit.'); } });
$('redo').onclick = () => task(async () => { const next = future.pop(); if (next) { history.push(structuredClone(project)); await restore(next); status('Redid edit.'); } });
$('character').onchange = render;
$('guidesToggle').onchange = drawGuides;
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Ⅱ Pause' : '▶ Walk'; };
setInterval(() => { if (playing) { pose = Math.floor(pose / 3) * 3 + (pose + 1) % 3; render(); updatePoseFields(); } }, 220);
$('generate').onclick = () => task(async () => { if (type() === 'weapon') await maskReady; generate(); });
$('cutoutMode').onchange = () => task(async () => {
  const s = source(); if (!s || type() !== 'weapon') return;
  const mode = $<HTMLSelectElement>('cutoutMode').value as WeaponCutout['mode'];
  if (!s.cutout) await maskReady;
  snapshot(); attachCutout(s); s.cutout!.mode = mode; rebuild();
  status(mode === 'none' ? 'Automatic cutouts off. Original source pixels restored.' : 'Cutouts applied to the frames and exports. Source image is unchanged.');
});
$('mode').onchange = () => { const s = source(); if (!s) return; snapshot(); s.mode = $<HTMLSelectElement>('mode').value as 'single' | 'strip'; s.poses = s.mode === 'single' ? generatePoses(type(), project.autoRig) : undefined; updateUI(); };
for (const [id, key] of [['anchorX', 'x'], ['anchorY', 'y']] as const) $(id).onchange = () => { const s = source(); if (s) { snapshot(); s.anchor[key] = number(id); updateSource(); rebuild(); } };
for (const k of ['baseRotation', 'sideCompression', 'skewStrength', 'xOffset', 'yOffset', 'scale'] as const) $(k === 'scale' ? 'rigScale' : k).onchange = () => { snapshot(); project.autoRig[k] = number(k === 'scale' ? 'rigScale' : k); };
$('source').onclick = e => { const s = source(); if (!s || browsing) return; const c = $<HTMLCanvasElement>('source'), rect = c.getBoundingClientRect(); const x = Math.max(0,Math.min(c.width-1,Math.round((e.clientX-rect.left)*c.width/rect.width))), y = Math.max(0,Math.min(c.height-1,Math.round((e.clientY-rect.top)*c.height/rect.height)));
  if (sourceTool === 'colour') { const rgba = c.getContext('2d')!.getImageData(x,y,1,1).data; if (rgba[3]) { chooseColour(`#${Array.from(rgba.slice(0,3)).map(v=>v.toString(16).padStart(2,'0')).join('')}`); $<HTMLDetailsElement>('colours').open=true; } else status('That pixel is transparent. Pick a visible source colour.'); return; }
  snapshot(); s.anchor={x,y}; updateSource(); rebuild();
};
function showPanel(panel: 'artwork' | 'colours' | 'settings') {
  $('inspector').dataset.panel=panel;
  for(const p of ['artwork','colours','settings']) $(`${p}Tab`).classList.toggle('selected',p===panel);
  if(panel!=='settings'){sourceTool=panel==='colours'?'colour':'pivot';$('setPivot').classList.toggle('selected',sourceTool==='pivot');$('pickColour').classList.toggle('selected',sourceTool==='colour');drawSource();}
  $('inspector').scrollTop=0;
}
for(const panel of ['artwork','colours','settings'] as const) $(`${panel}Tab`).onclick=()=>showPanel(panel);
for (const [id,panel] of [['setPivot','artwork'],['pickColour','colours']] as const) $(id).onclick=()=>showPanel(panel);
$('colourTolerance').oninput=()=>{$('toleranceValue').textContent=input('colourTolerance').value;};
$('applyColour').onclick=()=>task(async()=>{const s=source();if(!s)return;const rule={from:input('replaceFrom').value,to:input('replaceTo').value,tolerance:number('colourTolerance'),preserveShading:input('keepShading').checked,enabled:true};const rules=[...(s.replacements||[])];const i=rules.findIndex(r=>r.from.toLowerCase()===rule.from.toLowerCase());if(i<0)rules.push(rule);else rules[i]=rule;const valid=validateColorReplacements(rules);snapshot();s.replacements=valid;updateColours();rebuild();status('Colour replacement applied to this layer.');});
$('expand').onclick = () => task(async () => { const s = source(); if (s) { snapshot(); s.dataUrl = canvasDataUrl(expandDirections(images.get(selected)!)); s.poses = undefined; images.set(selected, await loadImage(s.dataUrl)); updateUI(); status('Directions repeated. This supplies a static walk cycle; edit frames or use a template for moving limbs.'); } });
$('extract').onclick = () => task(async () => { const s = source(); if (s?.atlasDataUrl) { const c = extractStrip(await loadImage(s.atlasDataUrl), profile().frames, number('atlasIndex')); snapshot(); s.dataUrl = canvasDataUrl(c); s.poses = undefined; s.legacyFrames = undefined; images.set(selected, await loadImage(s.dataUrl)); updateUI(); } });
$('convert').onclick = () => { const s = source(); const frames = Array.from({ length: 5 }, (_, i) => number(`direction-${i}`) - 1); if (frames.some(x => !Number.isInteger(x) || x < 0 || x > 14)) { status('Choose frame numbers from 1 through 15.', true); return; } if (s) { snapshot(); if (s.mode === 'single' && s.requiresDirections && s.poses) { const old = s.poses; s.poses = Array.from({length:15},(_,i)=>structuredClone(old[frames[Math.floor(i/3)]])); } s.requiresDirections = false; s.legacyFrames = frames; updateUI(); status('Five directional frames selected. Ready to edit or export.'); } };
$('visible').onchange = () => editPose(p => { p.visible = input('visible').checked; }); $('flip').onchange = () => editPose(p => { p.flipX = input('flip').checked; });
$('copy').onclick = () => { const previous = structuredClone(source()?.poses?.[Math.max(0, pose - (profile().frames === 5 ? 3 : 1))] || currentPose()); editPose(p => Object.assign(p, previous)); };
$('reset').onclick = () => editPose(p => Object.assign(p, source()?.mode === 'single' ? generatePoses(type(), project.autoRig)[pose] : { ...defaultPose(), x: 0, y: 0 }));
$('tint').onchange = () => { const s = source(); if (s) { snapshot(); s.tint = input('tint').value; rebuild(); } }; $('clearTint').onclick = () => { const s = source(); if (s) { snapshot(); delete s.tint; rebuild(); } };
$('remove').onclick = () => { snapshot(); delete project.sourceParts[selected]; images.delete(selected); updateUI(); };
$('layerExport').onclick = () => { const c = strips.get(selected); if (c) download(`${selected}.png`, new Blob([dataUrlToBytes(canvasDataUrl(c)) as BlobPart], { type: 'image/png' })); else status(renderError || 'This layer has no artwork.', true); };
for (const [id, key] of [['description', 'description'], ['itemId', '_id'], ['cost', 'cost'], ['weight', 'weight'], ['spriteId', 'equipmentSpriteId'], ['weaponSpeed', 'weaponSpeed']]) $(id).onchange = () => { snapshot(); project.definition[key] = id === 'description' ? input(id).value : number(id); updateUI(); };
$('hides').onchange = () => { snapshot(); project.definition.hidesSpritesUnderneath = input('hides').checked; rebuild(); }; $('tradeable').onchange = () => { snapshot(); project.definition.isTradeable = input('tradeable').checked; };
let drag: { x: number; y: number; px: number; py: number } | undefined;
$('preview').onpointerdown = e => { if (!source() || browsing) return; snapshot(); const p = currentPose(); drag = { x: e.clientX, y: e.clientY, px: p.x, py: p.y }; $('preview').setPointerCapture(e.pointerId); };
$('preview').onpointermove = e => { if (!drag) return; const r = $('preview').getBoundingClientRect(); editPose(p => { p.x = Math.round(drag!.px + (e.clientX - drag!.x) * 64 / r.width); p.y = Math.round(drag!.py + (e.clientY - drag!.y) * 128 / r.height); }, false); };
$('preview').onpointerup = () => { drag = undefined; }; $('preview').onpointercancel = () => { drag = undefined; };
$('preview').onwheel = e => { if (!source() || browsing || !e.deltaY) return; e.preventDefault(); editPose(p => { if (e.ctrlKey || e.metaKey) { const factor=e.deltaY>0?.95:1.05;p.scaleX*=factor;p.scaleY*=factor; } else if (e.shiftKey) p.skewX += e.deltaY>0?1:-1; else p.rotation += e.deltaY>0?5:-5; }); };
$('folderButton').onclick = () => input('folder').click(); $('carbonButton').onclick = () => input('carbonFiles').click();
for (const id of ['folder', 'carbonFiles']) $(id).onchange = () => task(async () => {
  const files = Array.from(input(id).files || []); if (!files.length) return;
  const result = await readProjectFiles(files, library); await library.setAppearance(result.entries); library.defs = result.defs;
  library.label = id === 'folder' ? files[0].webkitRelativePath.split('/')[0] : 'Imported assets'; $('librarySource').textContent = library.label;
  catalog(); outfitControls(); rebuild(); status(`Connected ${library.label}. Existing draft artwork is preserved.`); input(id).value = '';
});
$('export').onclick = () => $<HTMLDialogElement>('exportDialog').showModal(); $('closeExport').onclick = () => $<HTMLDialogElement>('exportDialog').close();
async function exportFiles(native: boolean) {
  if (renderError) throw new Error(renderError); validateExport(project, strips, library.defs);
  let def = effectiveDefinition();
  const files: { name: string; data: string | Uint8Array }[] = [{ name: 'project-v3.json', data: JSON.stringify(project, null, 2) }];
  for (const [key, c] of strips) files.push({ name: `layers/${key}.png`, data: dataUrlToBytes(canvasDataUrl(c)) });
  if (native) {
    if (!library.entries.length) throw new Error('Native export needs an appearance library. Sprite packs work without it.');
    const result = await nativeBundle(project, strips, library.entries, library.images, library.defs); def = result.definition;
    files.push({ name: 'carbon/appearance.carbon', data: JSON.stringify(result.entries) });
  }
  files.push({ name: 'itemdefs.carbon', data: JSON.stringify([def], null, 2) });
  files.push({ name: 'manifest.json', data: JSON.stringify({ frames: profile().frames, cell: [64,128], native, layers: activeParts(def).filter(p => strips.has(p.key)), library: library.label }, null, 2) });
  files.push({ name: 'README.txt', data: native ? `OpenSpell equipment patch\n\nLibrary: ${library.label}\n1. Copy carbon/appearance.carbon to apps/shared-assets/custom/static/carbon/appearance.carbon. This is a FULL bundle; it replaces the appearance bundle. Connect your current project before exporting to retain its custom artwork.\n2. Merge the records in itemdefs.carbon BY _id into apps/shared-assets/custom/static/itemdefs.carbon (an array). Retain all other existing custom definitions.\n3. Rebuild/restart OpenSpell assets as appropriate for your checkout.\n\nItem ${def._id}: ${def.name}; ${def.equipmentSpriteSheet} #${def.equipmentSpriteId}.\nInventory icons are not supplied. Existing icon metadata is retained when copying templates.\n` : `OpenSpell sprite pack\n\nPNG layers use 64x128 cells, ${profile().frames} consecutive frames per item. The manifest maps layers to native sheets.\nitemdefs.carbon contains a proposed definition. Sprite IDs are provisional until merged into your target project's atlas. Use OpenSpell patch export to allocate and merge native artwork automatically.\nOpen project-v3.json in the studio to continue editing. No carbon import is needed.\nInventory icons are separate.\n` });
  download(`${def.name.replace(/[^a-z0-9_-]/gi, '-')}-${native ? 'openspell-patch' : 'sprites'}.zip`, buildZip(files));
  $<HTMLDialogElement>('exportDialog').close(); status(native ? `Exported full appearance patch. Item ${def._id} → sprite ${def.equipmentSpriteId}.` : 'Exported sprite pack and editable draft.');
}
$('pack').onclick = () => task(() => exportFiles(false)); $('native').onclick = () => task(() => exportFiles(true));
updateUI();
// These small, bundled references load independently of appearance.carbon.
// Drafts embed their masks, so reopening one does not need any game bundles.
const maskReady = (async () => {
  const [hands, rear] = await Promise.all(['hands','rear'].map(name => loadImage(`/reference/weapon-${name}-mask.png`)));
  const encode = (image: HTMLImageElement) => { validateCutoutImage(image); const c = canvas(960); c.getContext('2d')!.drawImage(image,0,0); const url = canvasDataUrl(c); cutoutImages.set(url, image); return url; };
  defaultCutout = { mode: 'hands-body', hands: encode(hands), rear: encode(rear) };
})();
task(async () => { await Promise.all([library.bundled(), maskReady]); catalog(); outfitControls(); rebuild(); status('Ready. Start from a game item, or upload your own PNG. Carbon imports are optional.'); });
