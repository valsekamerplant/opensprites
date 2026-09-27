import { PROFILES, activeParts, defaultIcon, type EquipmentType, type ItemDef, type PartKey, type Project, type SourcePart } from '../model';
import { canvas, extractStrip, generatePoses, shieldPoses, stripSource } from '../artwork';
import { loadImage, canvasDataUrl } from '../carbon';
import { parseProject } from '../project';
import { validateCutoutImage } from '../occlusion';
import { download } from './dom';
import { state, library, drafts, cutoutImages, masks, fresh, type, profile, source, snapshot, status, emit, type Panel } from './state';
import { rebuild, gameIcon } from './render';
import { detectMaterial } from './materials';

/** Refill every panel from the draft and re-render it. */
export function refresh() { emit('project'); rebuild(); }

export function showPanel(panel: Panel) {
  state.panel = panel;
  if (panel === 'artwork' || panel === 'colours') state.sourceTool = panel === 'colours' ? 'colour' : 'pivot';
  emit('panel');
}

/** Replace the draft (after an undo, a load, a template…), decoding its images first. */
export async function restore(next: Project) {
  const decoded = new Map<PartKey, HTMLImageElement>();
  for (const [key, part] of Object.entries(next.sourceParts)) if (part?.dataUrl) decoded.set(key as PartKey, await loadImage(part.dataUrl));
  for (const part of Object.values(next.sourceParts)) if (part?.cutout) for (const url of [part.cutout.hands, part.cutout.rear]) {
    if (!cutoutImages.has(url)) { const image = await loadImage(url); validateCutoutImage(image); cutoutImages.set(url, image); }
  }
  next.icon ??= defaultIcon(next.definition.equipmentType!);
  state.iconImage = next.icon.dataUrl ? await loadImage(next.icon.dataUrl) : undefined;
  const typeChanged = next.definition.equipmentType !== type() || next.definition.equipmentType === 'projectile';
  state.project = next; state.images = decoded; state.browsing = undefined; state.colourGroup = undefined; state.openGroup = -1;
  state.selected = activeParts(next.definition)[0]?.key || 'main';
  if (typeChanged) showPanel(next.definition.equipmentType === 'projectile' ? 'settings' : 'artwork');
  emit('browse'); emit('library'); refresh();
}

export async function undo() { const next = state.history.pop(); if (next) { state.future.push(structuredClone(state.project)); await restore(next); status('Undid edit.'); } }
export async function redo() { const next = state.future.pop(); if (next) { state.history.push(structuredClone(state.project)); await restore(next); status('Redid edit.'); } }

export async function newDraft(t: EquipmentType = type()) { snapshot(); await restore(fresh(t)); showPanel(t === 'projectile' ? 'settings' : 'artwork'); status('New item. Upload a PNG or start from a game item.'); }
export async function changeType(t: EquipmentType) { drafts.set(type(), structuredClone(state.project)); snapshot(); await restore(drafts.get(t) || fresh(t)); }
export async function openDraft(text: string) { const next = parseProject(text); snapshot(); await restore(next); if (!state.renderError) status('Draft loaded.'); }
export function saveDraft() { download('item-project-v3.json', JSON.stringify(state.project, null, 2)); state.dirty = false; status('Saved draft with source images and frame settings.'); }

export function browse(def: ItemDef | undefined) { state.librarySelection = def ?? state.librarySelection; state.browsing = def; emit('browse'); }

export function attachCutout(s: SourcePart) {
  if (type() === 'weapon' && !s.cutout) {
    if (!masks.defaultCutout) throw new Error('Automatic cutout references could not load. Refresh the studio to retry.');
    s.cutout = structuredClone(masks.defaultCutout);
  }
}

/** Start a draft from a library item: a clone with a new ID, or the original for replacement. */
export async function useTemplate(def: ItemDef, replaceExisting = false) {
  const next = fresh(def.equipmentType!);
  next.definition = { ...structuredClone(def), _id: replaceExisting ? def._id : next.definition._id, name: replaceExisting ? def.name : `${def.name} copy` };
  next.templateId = def._id; next.replaceExisting = replaceExisting;
  for (const spec of activeParts(next.definition)) {
    const id = spec.special ? 0 : spec.trim ? def.equipmentTrimSpriteId : def.equipmentSpriteId;
    if (id == null || id < 0 || spec.trim && !def.equipmentTrimSpriteSheet) continue;
    const img = library.images.get(spec.atlas); if (!img) throw new Error(`Missing ${spec.atlas} in this library.`);
    const strip = extractStrip(img, PROFILES[def.equipmentType!].frames, id);
    const unbaked = canvasDataUrl(strip);
    const specialGloves = def.equipmentType === 'gloves' && [611, 612, 613, 614, 615, 616].includes(def._id);
    if (specialGloves && !replaceExisting) strip.getContext('2d')!.drawImage(extractStrip(img, 15, 12), 0, 0);
    const s = stripSource(strip, `${def.name} · ${spec.label}`);
    if (specialGloves) { s.unbakedDataUrl = unbaked; s.bakedDataUrl = s.dataUrl; }
    next.sourceParts[spec.key] = s;
  }
  const icon = gameIcon(def._id);
  if (icon) next.icon = { ...defaultIcon(def.equipmentType!), source: 'image', dataUrl: icon, fileName: `${def.name} icon`, rotation: 0 };
  snapshot(); await restore(next);
  const material = detectMaterial();
  status(replaceExisting ? `Editing original ${def.name} (#${def._id}). Export will replace its shared artwork.`
    : def._id === 617 ? 'Pumpkin copied without its special rear layer: new helmet IDs cannot render that layer.'
    : `Copied ${def.name}. This draft gets a new item ID and new artwork.${material ? ` Its ${material} material is ready for tier variants in Colours & tiers.` : ''}`);
}

/** Use an uploaded PNG for the selected layer: a single sprite, a finished strip or an atlas. */
export async function setSource(dataUrl: string, fileName: string) {
  const img = await loadImage(dataUrl), pending = source(); snapshot();
  const isStrip = img.height === 128 && [320, 960].includes(img.width);
  const isAtlas = img.width % 64 === 0 && img.height % 128 === 0 && (img.height > 128 || img.width > 960);
  let s: SourcePart = { dataUrl, fileName, mode: isStrip || isAtlas ? 'strip' : 'single', anchor: { x: Math.round(img.width / 2), y: Math.round(img.height * (type() === 'shield' ? .35 : .75)) } };
  let decoded = img;
  if (isStrip) s.anchor = { x: 32, y: 64 };
  if (isAtlas) { s = { ...stripSource(extractStrip(img, profile().frames, 0), fileName), atlasDataUrl: dataUrl }; decoded = await loadImage(s.dataUrl); }
  if (s.mode === 'single') s.poses = generatePoses(type(), state.project.autoRig);
  // Replacing a single sprite keeps its grip, poses and colour work.
  if (pending?.mode === 'single' && s.mode === 'single') { s = { ...s, ...pending, dataUrl, fileName }; decoded = img; }
  if (type() === 'weapon') { await maskReady; attachCutout(s); }
  state.project.sourceParts[state.selected] = s; state.images.set(state.selected, decoded);
  const material = detectMaterial(); // art painted with a native tier's shades
  refresh();
  if (material) { status(`Artwork loaded. Its ${material} shades are marked as material for tier variants.`); return; }
  if (!state.renderError) status(s.mode === 'single' ? 'Sprite placed in every frame. Click its grip point on the source, set its size, then generate poses.' : 'Artwork loaded. Pick any frame to inspect or adjust it.');
}

export function generate() {
  const s = source(); if (!s) { status('Upload a PNG or start from a game item first.', true); return; }
  snapshot(); s.mode = 'single'; s.poses = generatePoses(type(), state.project.autoRig); delete s.requiresDirections; delete s.legacyFrames; attachCutout(s);
  if (type() === 'shield' && (state.selected === 'front' || state.selected === 'back')) {
    const side = state.selected, mate: PartKey = side === 'front' ? 'back' : 'front';
    const front = library.images.get('shield_front1.png'), back = library.images.get('shield_back1.png');
    const nativeId = library.defs.find(d => d._id === state.project.templateId && d.equipmentType === 'shield')?.equipmentSpriteId ?? 0;
    const make = (f: 'front' | 'back') => front && back ? shieldPoses(front, back, nativeId, state.project.autoRig, f) : generatePoses('shield', state.project.autoRig).map((p, i) => ({ ...p, visible: f === 'front' ? i < 9 : i >= 9 }));
    s.poses = make(side);
    if (!state.project.sourceParts[mate]) { const m = structuredClone(s); m.poses = make(mate as 'front' | 'back'); state.project.sourceParts[mate] = m; state.images.set(mate, state.images.get(side)!); }
  }
  state.pose = 0; refresh();
  status(type() === 'shield' ? 'Shield generated with front / rear visibility. Replace the rear artwork if it differs, and check the grip in each frame.' : `Generated ${profile().frames} poses. Every frame stays editable.`);
}

// The small bundled hand / rear-body masks load independently of the game bundles.
// Drafts embed their masks, so reopening one does not need them.
export const maskReady = (async () => {
  const [hands, rear] = await Promise.all(['hands', 'rear'].map(name => loadImage(`/reference/weapon-${name}-mask.png`)));
  const encode = (image: HTMLImageElement) => { validateCutoutImage(image); const c = canvas(960); c.getContext('2d')!.drawImage(image, 0, 0); const url = canvasDataUrl(c); cutoutImages.set(url, image); return url; };
  masks.defaultCutout = { mode: 'hands-body', hands: encode(hands), rear: encode(rear) };
})();
