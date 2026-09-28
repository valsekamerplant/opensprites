import { activeParts, defaultPose, type PartKey, type WeaponCutout } from '../../model';
import { WEAPON_PRESETS, type WeaponPreset } from '../../weapon-poses';
import { canvasDataUrl, dataUrlToBytes, loadImage } from '../../carbon';
import { expandDirections, extractStrip, generatePoses, weaponPreset } from '../../artwork';
import { $, h, input, number, select, downloadBytes } from '../dom';
import { state, type, profile, source, snapshot, status, task, on, emit } from '../state';
import { rebuild, currentPose, editPose } from '../render';
import { refresh, generate, attachCutout, maskReady } from '../actions';
import { chooseColour, chooseGroup } from './colours';

const POSE_FIELDS = [['x', 'X'], ['y', 'Y'], ['rotation', 'Rotation'], ['skewX', 'Skew'], ['scaleX', 'Width'], ['scaleY', 'Height']] as const;
// Spears and halberds suggest a starting name and speed like the nearest native weapon.
const WEAPON_DEFAULTS: Partial<Record<WeaponPreset, { name: string; weaponSpeed: number }>> = { spear: { name: 'New spear', weaponSpeed: 5 }, halberd: { name: 'New halberd', weaponSpeed: 6 } };

export const layersMarkup = `
<section id="layerControls" data-tabs="artwork colours">
  <h2>Layers</h2><p id="hint" class="muted" data-tabs="artwork"></p>
  <div id="layers"></div>
  <button id="upload" class="wide" data-tabs="artwork">Upload PNG</button>
</section>`;
export const sourceMarkup = `
<div id="sourceControls">
  <div class="source-tools"><small>Source image</small><button id="setPivot" class="selected" title="Click the source to choose the point the artwork turns around">Set grip point</button><button id="pickColour" title="Click the source to select that colour">Pick colour</button></div>
  <div class="sourcebox"><canvas id="source" aria-label="Original source; click to set the grip point or pick a colour"></canvas></div>
  <small id="sourceName"></small>
</div>`;
export const placementMarkup = `
<div id="placementControls" data-tabs="artwork">
  <div id="atlasControl" hidden><label>Item index in atlas <input id="atlasIndex" type="number" min="0" value="0"></label><button id="extract">Extract item</button></div>
  <button id="expand" class="wide" hidden>Repeat 5 directions into 15 frames</button>
  <div id="migration" hidden><p>This older draft has 15 frames; this slot uses 5. Pick one frame (1–15) for each direction:</p><div id="migrationInputs" class="five"></div><button id="convert">Use these 5 frames</button></div>
  <div id="rigControls">
    <div class="two"><label id="presetControl">Grip style<select id="rigPreset">${Object.entries(WEAPON_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
    <label title="Scale of the artwork on the character">Size<input id="rigScale" type="number" step="0.1" min="0.05"></label></div>
    <button id="generate" class="primary wide">Generate 15 poses</button><small id="rigNote"></small>
  </div>
  <details open id="frameEditor"><summary>Edit this frame <span id="editFrame"></span></summary>
    <small>Drag the artwork in the preview; scroll to rotate. Arrow keys nudge it.</small>
    <div class="three" id="poseFields"></div>
    <div class="checks"><label><input id="visible" type="checkbox"> Visible</label><label><input id="flip" type="checkbox"> Flip</label></div>
    <div class="two"><button id="copy">Copy previous</button><button id="reset">Reset frame</button></div>
  </details>
  <details id="advancedArtwork"><summary>Advanced</summary>
    <div class="two"><label><span class="pivot-word">Grip point</span> X<input id="anchorX" type="number"></label><label><span class="pivot-word">Grip point</span> Y<input id="anchorY" type="number"></label></div>
    <label>Input <select id="mode"><option value="single">Single sprite → generate poses</option><option value="strip">Finished frame strip</option></select></label>
    <label>Rotation quality<select id="rotationQuality"><option value="rotsprite">Pixel art (RotSprite)</option><option value="nearest">Nearest pixel</option></select><small>RotSprite keeps outlines clean on rotated or skewed frames.</small></label>
    <label id="cutoutControl">Automatic cutouts<select id="cutoutMode"><option value="hands-body">Hands + rear body</option><option value="hands">Hands only</option><option value="none">Off</option></select><small>Leaves room for the character’s hands and body in exported PNGs. Your source image stays intact.</small></label>
    <div id="generationSettings"><small>Generation adjustments (apply on Generate)</small><div class="two"><label>Rotation<input id="baseRotation" type="number"></label><label>Side compression<input id="sideCompression" type="number"></label><label>Skew<input id="skewStrength" type="number"></label><label>X offset<input id="xOffset" type="number"></label><label>Y offset<input id="yOffset" type="number"></label></div></div>
  </details>
</div>`;
export const layerActionsMarkup = `<div class="two" data-tabs="artwork colours"><button id="layerExport">Save layer PNG</button><button id="remove">Remove layer</button></div>`;

function layers() {
  $('hint').textContent = profile().hint; $('upload').hidden = type() === 'projectile';
  $('layers').replaceChildren(...activeParts(state.project.definition).map(spec => {
    const has = !!state.project.sourceParts[spec.key];
    const select = h('button', { class: `layer ${state.selected === spec.key ? 'selected' : ''}`, text: `${has ? '●' : '+'} ${spec.label}${spec.trim ? ' (optional)' : ''}`, title: has ? `Edit ${spec.label.toLowerCase()}` : `No artwork yet: upload ${spec.label.toLowerCase()}`, onclick: () => { state.selected = spec.key; state.colourGroup = undefined; state.openGroup = -1; emit('project'); } });
    const upload = h('button', { id: `upload-${spec.key}`, class: 'layer-upload', text: 'Upload', title: `Upload ${spec.label.toLowerCase()}`, onclick: (e: Event) => { e.stopPropagation(); state.selected = state.uploadTarget = spec.key; input('pngFile').click(); } });
    return h('div', { class: 'layer-row', dataset: { part: spec.key } }, select, upload);
  }));
}
export function drawSource() {
  const s = source(), img = state.images.get(state.selected); if (!s || !img) return;
  const c = $<HTMLCanvasElement>('source'), strip = s.mode === 'strip' && img.height === 128 && [320, 960].includes(img.width);
  c.width = strip ? 64 : img.width; c.height = img.height;
  const frame = img.width === 320 ? Math.floor(state.pose / 3) : profile().frames === 5 ? s.legacyFrames?.[Math.floor(state.pose / 3)] ?? Math.floor(state.pose / 3) * 3 : state.pose;
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  if (strip) ctx.drawImage(img, frame * 64, 0, 64, 128, 0, 0, 64, 128); else ctx.drawImage(img, 0, 0);
  if (state.sourceTool === 'pivot') { ctx.strokeStyle = '#ffce6a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.anchor.x - 4, s.anchor.y); ctx.lineTo(s.anchor.x + 4, s.anchor.y); ctx.moveTo(s.anchor.x, s.anchor.y - 4); ctx.lineTo(s.anchor.x, s.anchor.y + 4); ctx.stroke(); }
}
function poseFields() {
  const p = currentPose(); $('editFrame').textContent = `· ${state.pose + 1}`;
  for (const [k] of POSE_FIELDS) input(`pose-${k}`).value = String(Math.round(p[k] * 100) / 100);
  input('visible').checked = p.visible; input('flip').checked = p.flipX;
  drawSource();
}
function fields() {
  layers();
  const s = source(), img = state.images.get(state.selected), weapon = type() === 'weapon';
  $('artworkControls').hidden = !s || !img;
  for (const el of document.querySelectorAll('.pivot-word')) el.textContent = weapon ? 'Grip point' : 'Pivot';
  $('setPivot').textContent = weapon ? 'Set grip point' : 'Set pivot';
  if (!s || !img) return;
  $('sourceName').textContent = `${s.fileName} · ${img.width} × ${img.height}`;
  select('mode').value = s.mode; $('rigControls').hidden = s.mode !== 'single';
  $('cutoutControl').hidden = !weapon; select('cutoutMode').value = s.cutout?.mode || 'none'; select('rotationQuality').value = s.rotationQuality || 'rotsprite';
  $('generationSettings').hidden = s.mode !== 'single';
  $('atlasControl').hidden = !s.atlasDataUrl;
  $('expand').hidden = !(img.width === 320 && img.height === 128 && profile().frames === 15 && s.mode === 'strip');
  $('migration').hidden = !(s.requiresDirections || img.width === 960 && profile().frames === 5 && s.mode === 'strip' && !s.legacyFrames);
  input('anchorX').value = String(s.anchor.x); input('anchorY').value = String(s.anchor.y); input('rigScale').value = String(state.project.autoRig.scale);
  for (const k of ['baseRotation', 'sideCompression', 'skewStrength', 'xOffset', 'yOffset'] as const) input(k).value = String(state.project.autoRig[k]);
  $('presetControl').hidden = !weapon; select('rigPreset').value = weaponPreset(state.project.autoRig.preset);
  $('generate').textContent = `Generate ${profile().frames === 5 ? '5 directions' : '15 poses'}`;
  $('rigNote').textContent = weapon ? 'Draw the weapon upright, seen from the side. Click where the hand holds it on the source, pick a grip style, then generate.'
    : type() === 'shield' ? 'Uses native shield placement and visibility. The same source supplies both faces until you replace the rear artwork.'
    : 'Rigid prototype: it cannot invent rear artwork or bend armour. Start from a game item for a finished fit.';
  poseFields();
}

export function mountArtwork() {
  for (const [field, label] of POSE_FIELDS) {
    const el = h('input', { id: `pose-${field}`, type: 'number', step: field.startsWith('scale') ? '0.05' : '1', onchange: () => editPose(p => { p[field] = Number(el.value); }) });
    $('poseFields').append(h('label', {}, label, el));
  }
  for (let d = 0; d < 5; d++) $('migrationInputs').append(h('input', { type: 'number', min: '1', max: '15', value: String(d * 3 + 1), id: `direction-${d}`, title: ['Front', 'Front ¾', 'Side', 'Rear ¾', 'Rear'][d] }));
  on('project', fields); on('pose', poseFields); on('panel', drawSource);

  $('upload').onclick = () => { state.uploadTarget = state.selected; input('pngFile').click(); };
  $('generate').onclick = () => task(async () => { if (type() === 'weapon') await maskReady; generate(); });
  $('cutoutMode').onchange = () => task(async () => {
    const s = source(); if (!s || type() !== 'weapon') return;
    const mode = select('cutoutMode').value as WeaponCutout['mode'];
    if (!s.cutout) await maskReady;
    snapshot(); attachCutout(s); s.cutout!.mode = mode; rebuild();
    status(mode === 'none' ? 'Automatic cutouts off. Original source pixels restored.' : 'Cutouts applied to the frames and exports. Source image is unchanged.');
  });
  $('rigPreset').onchange = () => {
    snapshot(); const preset = weaponPreset(select('rigPreset').value), def = state.project.definition; state.project.autoRig.preset = preset;
    const suggested = WEAPON_DEFAULTS[preset];
    if (suggested && /^New (weapon|spear|halberd)/i.test(def.name)) { def.name = suggested.name; def.weaponSpeed = suggested.weaponSpeed; emit('project'); }
    status(`${WEAPON_PRESETS[preset].label} grip selected. Generate poses to apply it.`);
  };
  $('rotationQuality').onchange = () => { const s = source(); if (!s) return; snapshot(); s.rotationQuality = select('rotationQuality').value === 'nearest' ? 'nearest' : undefined; rebuild(); };
  $('mode').onchange = () => { const s = source(); if (!s) return; snapshot(); s.mode = select('mode').value as 'single' | 'strip'; s.poses = s.mode === 'single' ? generatePoses(type(), state.project.autoRig) : undefined; refresh(); };
  for (const [id, key] of [['anchorX', 'x'], ['anchorY', 'y']] as const) $(id).onchange = () => { const s = source(); if (s) { snapshot(); s.anchor[key] = number(id); fields(); rebuild(); } };
  for (const k of ['baseRotation', 'sideCompression', 'skewStrength', 'xOffset', 'yOffset', 'scale'] as const) $(k === 'scale' ? 'rigScale' : k).onchange = () => { snapshot(); state.project.autoRig[k] = number(k === 'scale' ? 'rigScale' : k); };
  $('source').onclick = e => {
    const s = source(); if (!s || state.browsing) return;
    const c = $<HTMLCanvasElement>('source'), rect = c.getBoundingClientRect();
    const x = Math.max(0, Math.min(c.width - 1, Math.round((e.clientX - rect.left) * c.width / rect.width))), y = Math.max(0, Math.min(c.height - 1, Math.round((e.clientY - rect.top) * c.height / rect.height)));
    if (state.sourceTool === 'colour') {
      const rgba = c.getContext('2d')!.getImageData(x, y, 1, 1).data;
      if (!rgba[3]) { status('That pixel is transparent. Pick a visible source colour.'); return; }
      const hex = `#${Array.from(rgba.slice(0, 3)).map(v => v.toString(16).padStart(2, '0')).join('')}`, group = state.colourGroups.find(g => g.colours.some(c => c.hex === hex));
      if (group) chooseGroup(group); else chooseColour(hex);
      $<HTMLDetailsElement>('colours').open = true; return;
    }
    snapshot(); s.anchor = { x, y }; fields(); rebuild();
  };
  $('expand').onclick = () => task(async () => { const s = source(); if (s) { snapshot(); s.dataUrl = canvasDataUrl(expandDirections(state.images.get(state.selected)!)); s.poses = undefined; state.images.set(state.selected, await loadImage(s.dataUrl)); refresh(); status('Directions repeated. This is a static walk cycle; edit frames or start from a game item for moving limbs.'); } });
  $('extract').onclick = () => task(async () => { const s = source(); if (s?.atlasDataUrl) { const c = extractStrip(await loadImage(s.atlasDataUrl), profile().frames, number('atlasIndex')); snapshot(); s.dataUrl = canvasDataUrl(c); s.poses = undefined; s.legacyFrames = undefined; state.images.set(state.selected, await loadImage(s.dataUrl)); refresh(); } });
  $('convert').onclick = () => {
    const s = source(), frames = Array.from({ length: 5 }, (_, i) => number(`direction-${i}`) - 1);
    if (frames.some(x => !Number.isInteger(x) || x < 0 || x > 14)) { status('Choose frame numbers from 1 through 15.', true); return; }
    if (!s) return;
    snapshot();
    if (s.mode === 'single' && s.requiresDirections && s.poses) { const old = s.poses; s.poses = Array.from({ length: 15 }, (_, i) => structuredClone(old[frames[Math.floor(i / 3)]])); }
    s.requiresDirections = false; s.legacyFrames = frames; refresh(); status('Five directional frames selected. Ready to edit or export.');
  };
  $('visible').onchange = () => editPose(p => { p.visible = input('visible').checked; });
  $('flip').onchange = () => editPose(p => { p.flipX = input('flip').checked; });
  $('copy').onclick = () => { const previous = structuredClone(source()?.poses?.[Math.max(0, state.pose - (profile().frames === 5 ? 3 : 1))] || currentPose()); editPose(p => Object.assign(p, previous)); };
  $('reset').onclick = () => editPose(p => Object.assign(p, source()?.mode === 'single' ? generatePoses(type(), state.project.autoRig)[state.pose] : { ...defaultPose(), x: 0, y: 0 }));
  $('remove').onclick = () => { snapshot(); delete state.project.sourceParts[state.selected]; state.images.delete(state.selected); if (state.project.material) delete state.project.material.colours[state.selected as PartKey]; refresh(); };
  $('layerExport').onclick = () => { const c = state.strips.get(state.selected); if (c) downloadBytes(`${state.selected}.png`, dataUrlToBytes(canvasDataUrl(c))); else status(state.renderError || 'This layer has no artwork.', true); };
}
