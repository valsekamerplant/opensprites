import { activeParts, defaultPose, type ItemDef, type PartKey, type Pose, type SourcePart } from '../model';
import { clientLayers, renderClientPose } from '../compositor';
import { canvas, renderPart, colouredArtwork, tintCanvas, type Artwork } from '../artwork';
import { ICON_ATLAS, composeIcon, extractIcon, closeGripGap } from '../icon';
import { canvasDataUrl } from '../carbon';
import { nextSpriteId } from '../export';
import type { ColorReplacement } from '../palette';
import { input } from './dom';
import { state, library, type, profile, source, snapshot, status, emit, cutoutImages } from './state';

/** The definition as it will be exported: new items get the next free sprite (and trim) slots. */
export function effectiveDefinition(): ItemDef {
  const def = { ...state.project.definition };
  if (!state.project.replaceExisting && type() !== 'projectile') def.equipmentSpriteId = nextSpriteId(library.entries, library.images, library.defs, type());
  def.equipmentSpriteSheet = profile().sheet;
  if (activeParts(def).some(p => p.trim && state.strips.has(p.key))) {
    if (!state.project.replaceExisting || def.equipmentTrimSpriteId == null || def.equipmentTrimSpriteId < 0) def.equipmentTrimSpriteId = nextSpriteId(library.entries, library.images, library.defs, type(), true);
    def.equipmentTrimSpriteSheet = profile().sheet.replace('1', 'trim1');
  } else { def.equipmentTrimSpriteId = null; def.equipmentTrimSpriteSheet = null; }
  return def;
}
function poseLayers() {
  const body = input('character').checked, layers = clientLayers({ ...state.outfit, [type()]: state.browsing || effectiveDefinition() });
  if (state.browsing) return layers.filter(l => body || !!l.slot);
  return layers.filter(l => (body || !!l.slot) && (l.slot !== type() || l.supplemental || state.strips.has(l.part as PartKey)));
}
/** Draw one of the 15 frames with the draft (or its given strips) in the current outfit. */
export function drawPose(c: HTMLCanvasElement, index: number, strips = state.strips) {
  renderClientPose(c.getContext('2d')!, index, poseLayers(), library.images, l => !state.browsing && l.slot === type() && !l.supplemental ? strips.get(l.part as PartKey) : undefined);
}
function renderLayer(s: SourcePart, img: HTMLImageElement) {
  const hands = s.cutout && cutoutImages.get(s.cutout.hands), rear = s.cutout && cutoutImages.get(s.cutout.rear);
  return renderPart(s, img, profile().frames, hands && rear ? { hands, rear } : undefined);
}
/** Render every layer that has artwork, optionally with other colour rules per layer. Throws on a layer that can't render. */
export function renderStrips(rules?: Map<PartKey, ColorReplacement[] | undefined>) {
  const strips = new Map<PartKey, HTMLCanvasElement>();
  for (const part of activeParts(state.project.definition)) {
    const s = state.project.sourceParts[part.key], img = state.images.get(part.key);
    if (s && img) strips.set(part.key, renderLayer(rules?.has(part.key) ? { ...s, replacements: rules.get(part.key) } : s, img));
  }
  return strips;
}
/** Re-render every layer and the icon after an edit, then tell the panels. A layer that can't render doesn't hide the others. */
export function rebuild() {
  state.strips = new Map(); state.renderError = ''; state.artVersion++;
  for (const part of activeParts(state.project.definition)) {
    const s = state.project.sourceParts[part.key], img = state.images.get(part.key);
    if (s && img) try { state.strips.set(part.key, renderLayer(s, img)); } catch (e) { state.renderError = (e as Error).message; }
  }
  const art = iconSourceArt(); state.iconArt = art && composeIcon(art, state.project.icon!);
  emit('art');
  if (state.renderError) status(state.renderError, true);
}
const tinted = (art: Artwork, tint?: string) => { if (!tint) return art; const c = canvas(art.width, art.height); c.getContext('2d')!.drawImage(art, 0, 0); tintCanvas(c, tint); return c; };
export const primaryPart = () => activeParts(state.project.definition).find(p => !p.trim && !p.special && state.project.sourceParts[p.key]);
/**
 * Artwork the inventory icon is made from. Weapons lie diagonally like native icons; other
 * equipment uses every layer's front view (a cape's rear view). An uploaded or game icon
 * takes the item's colour changes when recolour is on: the icon's own tier rule first, as
 * icon art has its own shades, then the main layer's other rules.
 */
export function iconSourceArt(variant?: { strips: Map<PartKey, HTMLCanvasElement>; rules: Map<PartKey, ColorReplacement[] | undefined>; iconRule?: ColorReplacement }): Artwork | undefined {
  const icon = state.project.icon!, primary = primaryPart(), strips = variant?.strips ?? state.strips;
  const s = primary && state.project.sourceParts[primary.key], img = primary && state.images.get(primary.key);
  const rules = primary && variant?.rules.has(primary.key) ? variant.rules.get(primary.key) : s?.replacements;
  if (icon.source === 'image') {
    if (!state.iconImage) return;
    if (!icon.recolour || !s) return state.iconImage;
    const iconRule = variant ? variant.iconRule : icon.tierRule;
    const own = iconRule ? [iconRule, ...(rules ?? []).filter(r => !r.tier)] : rules;
    return tinted(colouredArtwork(state.iconImage, own), s.tint);
  }
  if (type() === 'weapon') {
    if (!s || !img) return;
    // A finished strip contributes its side view.
    let art: Artwork = colouredArtwork(img, rules);
    if (s.mode === 'strip') { const c = canvas(64); c.getContext('2d')!.drawImage(art, (img.width === 960 ? 6 : 2) * 64, 0, 64, 128, 0, 0, 64, 128); art = closeGripGap(c); }
    return tinted(art, s.tint);
  }
  const pose = type() === 'back' ? 12 : 0, cell = profile().frames === 5 ? Math.floor(pose / 3) : pose, c = canvas(64);
  let drawn = false;
  for (const part of activeParts(state.project.definition)) { const strip = strips.get(part.key); if (strip) { c.getContext('2d')!.drawImage(strip, cell * 64, 0, 64, 128, 0, 0, 64, 128); drawn = true; } }
  return drawn ? c : undefined;
}
export const iconDefinitionCount = () => library.defs.length + (library.defs.some(d => d._id === state.project.definition._id) ? 0 : 1);
export function gameIcon(id: number) { const atlas = library.icons.get(ICON_ATLAS); return atlas ? canvasDataUrl(extractIcon(atlas, id)) : undefined; }

const startPose = (s?: SourcePart): Pose => ({ ...defaultPose(), x: s?.mode === 'strip' ? 0 : 32, y: s?.mode === 'strip' ? 0 : 64 });
export function currentPose(): Pose { const s = source(); return s?.poses?.[state.pose] || startPose(s); }
/** Edit the current frame (all three frames of a direction on five-frame sheets). */
export function editPose(edit: (p: Pose) => void, saveHistory = true) {
  const s = source(); if (!s || state.browsing) return;
  if (saveHistory) snapshot();
  s.poses ??= Array.from({ length: 15 }, () => startPose(s));
  const d = Math.floor(state.pose / 3), indices = profile().frames === 5 ? [d * 3, d * 3 + 1, d * 3 + 2] : [state.pose];
  for (const i of indices) edit(s.poses[i]);
  rebuild(); emit('pose');
}
