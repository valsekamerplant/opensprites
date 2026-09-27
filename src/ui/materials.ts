import { PROFILES, activeParts, lowestFreeId, type ItemDef, type PartKey, type PartSpec, type Project } from '../model';
import { extractPalette, applyColorReplacements, type ColorReplacement } from '../palette';
import { NATIVE_TIERS, TIER_IDS, allTiers, detectTier, materialColours, pairedMap, swapTierWord, tierRule, type CustomTier, type PaletteColour, type Tier, type TierId } from '../tiers';
import { canvas, extractStrip } from '../artwork';
import { ICON_ATLAS, composeIcon, extractIcon } from '../icon';
import { canvasDataUrl, dataUrlToBytes, buildZip } from '../carbon';
import { renderClientPose, clientLayers } from '../compositor';
import { stored, store } from './dom';
import { state, library, type, profile } from './state';
import { effectiveDefinition, iconSourceArt, renderStrips } from './render';

// ── Tiers on offer: the native line, gold / silver, and custom tiers (saved in this browser
// and inside each draft that uses them, so a shared draft carries its tiers along).
const CUSTOM_KEY = 'openspell-studio.custom-tiers';
export function customTiers(): CustomTier[] {
  const byId = new Map<string, CustomTier>();
  for (const t of [...stored<CustomTier[]>(CUSTOM_KEY, []), ...(state.project.customTiers ?? [])]) byId.set(t.id, t);
  return [...byId.values()];
}
export function saveCustomTier(tier: CustomTier) {
  store(CUSTOM_KEY, [...stored<CustomTier[]>(CUSTOM_KEY, []).filter(t => t.id !== tier.id), tier]);
  // A draft carries only the custom tiers it uses (added when one is applied).
  if (state.project.customTiers?.some(t => t.id === tier.id)) state.project.customTiers = state.project.customTiers.map(t => t.id === tier.id ? tier : t);
}
export function removeCustomTier(id: string) {
  store(CUSTOM_KEY, stored<CustomTier[]>(CUSTOM_KEY, []).filter(t => t.id !== id));
  state.project.customTiers = (state.project.customTiers ?? []).filter(t => t.id !== id);
  if (!state.project.customTiers.length) delete state.project.customTiers;
}
export const tiers = (): Tier[] => allTiers(customTiers());
export const tierById = (id?: string) => tiers().find(t => t.id === id);
const tierOfName = (name: string): TierId | undefined => TIER_IDS.find(t => name.toLowerCase().startsWith(`${t} `));

// ── Pixels and palettes of source images (cached per image).
const pixelCache = new WeakMap<object, Uint8ClampedArray>(), paletteCache = new WeakMap<object, PaletteColour[]>();
function pixelsOf(image: HTMLImageElement | HTMLCanvasElement) {
  let data = pixelCache.get(image);
  if (!data) { const c = canvas(image.width, image.height), ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0); data = ctx.getImageData(0, 0, c.width, c.height).data; pixelCache.set(image, data); }
  return data;
}
export function paletteOf(image: HTMLImageElement | HTMLCanvasElement) {
  let palette = paletteCache.get(image);
  if (!palette) { palette = extractPalette(pixelsOf(image), 256); paletteCache.set(image, palette); }
  return palette;
}

// ── Native siblings: a clone of "bronze longsword" can take its colours from the game's own
// iron longsword, exactly, as long as the layer still has the same silhouette.
const template = () => library.defs.find(d => d._id === state.project.templateId);
function sibling(target: Tier): ItemDef | undefined {
  const base = template();
  if (!base || !target.native || !tierOfName(base.name)) return;
  const name = swapTierWord(base.name, target).toLowerCase();
  return library.defs.find(d => d._id !== base._id && d.equipmentType === base.equipmentType && d.name.toLowerCase() === name);
}
const exactCache = new WeakMap<object, Map<string, Map<string, string> | undefined>>();
function cachedExact(image: object, key: string, make: () => Map<string, string> | undefined) {
  let byKey = exactCache.get(image); if (!byKey) exactCache.set(image, byKey = new Map());
  if (!byKey.has(key)) byKey.set(key, make());
  return byKey.get(key);
}
function exactMap(part: PartSpec, target: Tier) {
  const img = state.images.get(part.key), def = sibling(target), atlas = library.images.get(part.atlas);
  const id = def && (part.special ? undefined : part.trim ? def.equipmentTrimSpriteId : def.equipmentSpriteId);
  if (!img || !def || !atlas || typeof id !== 'number' || id < 0) return;
  return cachedExact(img, `${def._id}|${part.key}`, () => pairedMap(pixelsOf(img), pixelsOf(extractStrip(atlas, PROFILES[def.equipmentType!].frames, id))));
}
function iconExactMap(target: Tier) {
  const def = sibling(target), atlas = library.icons.get(ICON_ATLAS), img = state.iconImage;
  if (!def || !atlas || !img || state.project.icon?.source !== 'image') return;
  return cachedExact(img, `${def._id}|icon`, () => pairedMap(pixelsOf(img), pixelsOf(extractIcon(atlas, def._id))));
}

// ── Material: which source colours are the item's metal (or cloth…) on each layer.
export const material = () => state.project.material;
export const hasMaterial = () => Object.values(material()?.colours ?? {}).some(c => c?.length);
/**
 * Choose the material automatically when a layer is native tier art: a clone of a tier item,
 * or art painted with a tier's own shades. Returns the tier label found.
 */
export function detectMaterial(): string | undefined {
  if (hasMaterial()) return;
  const base = template(), known = base && tierOfName(base.name), colours: Partial<Record<PartKey, string[]>> = {};
  let from: TierId | undefined;
  for (const part of activeParts(state.project.definition)) {
    const img = state.images.get(part.key); if (!img) continue;
    const palette = paletteOf(img), tier = known ?? detectTier(palette); if (!tier) continue;
    const found = materialColours(palette, tier);
    if (found.length) { colours[part.key] = found.map(c => c.hex); from ??= tier; }
  }
  if (!from) return;
  state.project.material = { from, tier: from, colours };
  return NATIVE_TIERS.find(t => t.id === from)!.label.toLowerCase();
}
/** Add colours (e.g. a selected colour group) to the selected layer's material. */
export function addMaterial(part: PartKey, colours: string[]) {
  const m = state.project.material ??= { colours: {} };
  m.colours[part] = [...new Set([...(m.colours[part] ?? []), ...colours.map(c => c.toLowerCase())])];
}
export function removeMaterial(part: PartKey, colours: string[]) {
  const m = state.project.material; if (!m?.colours[part]) return;
  const drop = new Set(colours.map(c => c.toLowerCase()));
  m.colours[part] = m.colours[part]!.filter(c => !drop.has(c));
  if (!m.colours[part]!.length) delete m.colours[part];
}
/** Re-apply the shown tier after the material changed (or drop tier colours without material). */
export function reapplyTier() {
  const tier = tierById(material()?.tier);
  if (hasMaterial() && tier) applyTier(tier);
  else if (!hasMaterial()) clearMaterial();
}
export function clearMaterial() {
  delete state.project.material;
  for (const s of Object.values(state.project.sourceParts)) if (s?.replacements) { s.replacements = s.replacements.filter(r => !r.tier); if (!s.replacements.length) delete s.replacements; }
  delete state.project.icon?.tierRule;
}

type Variant = { rules: Map<PartKey, ColorReplacement[] | undefined>; iconRule?: ColorReplacement };
/** Colour rules for every layer (and the icon) in `target`, keeping hand-made rules. */
export function variantRules(target: Tier): Variant {
  const m = material(), rules = new Map<PartKey, ColorReplacement[] | undefined>(), all = new Set<string>();
  const same = target.id === m?.from; // the art already is this tier
  for (const part of activeParts(state.project.definition)) {
    const s = state.project.sourceParts[part.key], img = state.images.get(part.key); if (!s) continue;
    const own = new Set(m?.colours[part.key] ?? []); own.forEach(c => all.add(c));
    const exact = exactMap(part, target), palette = img ? paletteOf(img) : [];
    const rule = same || !img ? undefined : tierRule(palette.filter(c => own.has(c.hex) || exact?.has(c.hex)), target, exact);
    const list = [...(s.replacements ?? []).filter(r => !r.tier), ...(rule ? [rule] : [])];
    rules.set(part.key, list.length ? list : undefined);
  }
  let iconRule: ColorReplacement | undefined;
  if (!same && state.project.icon?.source === 'image' && state.iconImage) {
    const palette = paletteOf(state.iconImage), exact = iconExactMap(target), native = detectTier(palette);
    iconRule = tierRule(palette.filter(c => all.has(c.hex) || exact?.has(c.hex) || (native && materialColours([c], native).length)), target, exact);
  }
  return { rules, iconRule };
}
function withVariant(project: Project, target: Tier, variant: Variant, rename: 'swap' | 'always') {
  for (const [key, list] of variant.rules) { const s = project.sourceParts[key]!; if (list) s.replacements = list; else delete s.replacements; }
  if (project.icon) { if (variant.iconRule) project.icon.tierRule = variant.iconRule; else delete project.icon.tierRule; }
  project.material = { ...(project.material ?? { colours: {} }), tier: target.id };
  if (target.custom && !project.customTiers?.some(t => t.id === target.id)) project.customTiers = [...(project.customTiers ?? []), target.custom];
  // The name's tier word follows the tier; a new variant always gets one.
  const name = project.definition.name.toLowerCase(), all = tiers();
  if (rename === 'always' || all.some(t => [t.id, t.label.toLowerCase()].some(w => name.startsWith(`${w} `)))) project.definition.name = swapTierWord(project.definition.name, target, all);
  return project;
}
/** Show the draft in `target` (undoable). The item name's tier word follows along. */
export function applyTier(target: Tier) { withVariant(state.project, target, variantRules(target), 'swap'); }

/** A new draft of the same item in another tier, with the next free item ID. */
export function tierDraft(target: Tier, id: number): Project {
  const next = withVariant(structuredClone(state.project), target, variantRules(target), 'always');
  return { ...next, definition: { ...next.definition, _id: id }, replaceExisting: false };
}
/** Free item IDs for new variants, after the draft's own. */
export function freeIds(count: number) {
  const taken = [...library.defs, { _id: state.project.definition._id, name: '' }], ids: number[] = [];
  for (let i = 0; i < count; i++) { const id = lowestFreeId(taken); ids.push(id); taken.push({ _id: id, name: '' }); }
  return ids;
}

/**
 * Small previews of the item alone in the current frame, in every tier, cropped to the same
 * box. Layers are rendered once without tier rules; each tier then only recolours that
 * frame, which keeps this fast enough to update live.
 */
let untiered: { version: number; strips?: Map<PartKey, HTMLCanvasElement> } = { version: -1 };
function untieredStrips() {
  if (untiered.version !== state.artVersion) {
    const base = new Map<PartKey, ColorReplacement[] | undefined>();
    for (const [key, s] of Object.entries(state.project.sourceParts)) { const own = s?.replacements?.filter(r => !r.tier); base.set(key as PartKey, own?.length ? own : undefined); }
    let strips: Map<PartKey, HTMLCanvasElement> | undefined;
    try { strips = renderStrips(base); } catch { /* the layer's error is already shown */ }
    untiered = { version: state.artVersion, strips };
  }
  return untiered.strips;
}
export function tierPreviews(frame: number): { tier: Tier; canvas: HTMLCanvasElement }[] {
  if (!hasMaterial() || state.browsing) return [];
  const strips = untieredStrips(); if (!strips) return [];
  const cell = profile().frames === 5 ? Math.floor(frame / 3) : frame;
  const layers = clientLayers({ [type()]: effectiveDefinition() }).filter(l => l.slot === type() && !l.supplemental && strips.has(l.part as PartKey));
  const frames = tiers().map(tier => {
    const variant = variantRules(tier), recoloured = new Map<PartKey, HTMLCanvasElement>();
    for (const [key, strip] of strips) {
      const c = canvas(strip.width), ctx = c.getContext('2d')!, rule = variant.rules.get(key)?.find(r => r.tier);
      ctx.drawImage(strip, cell * 64, 0, 64, 128, cell * 64, 0, 64, 128);
      if (rule) { const data = ctx.getImageData(cell * 64, 0, 64, 128); applyColorReplacements(data.data, [rule]); ctx.putImageData(data, cell * 64, 0); }
      recoloured.set(key, c);
    }
    const out = canvas(64);
    renderClientPose(out.getContext('2d')!, frame, layers, library.images, l => recoloured.get(l.part as PartKey));
    return { tier, canvas: out };
  });
  // One crop for all, so the cards line up.
  let left = 64, top = 128, right = -1, bottom = -1;
  const alpha = frames[0]?.canvas.getContext('2d')!.getImageData(0, 0, 64, 128).data;
  if (alpha) for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) if (alpha[(y * 64 + x) * 4 + 3]) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  if (right < 0) return frames;
  const w = right - left + 3, h = bottom - top + 3;
  return frames.map(({ tier, canvas: full }) => { const c = canvas(w, h); c.getContext('2d')!.drawImage(full, left - 1, top - 1, w, h, 0, 0, w, h); return { tier, canvas: c }; });
}

/** Every tier's layer PNGs, icon and an editable draft, in one zip. */
export function tierZip(): Blob {
  const all = tiers(), ids = freeIds(all.length), files: { name: string; data: string | Uint8Array }[] = [];
  for (const [i, tier] of all.entries()) {
    const variant = variantRules(tier), strips = renderStrips(variant.rules), dir = tier.id;
    for (const [key, strip] of strips) files.push({ name: `${dir}/layers/${key}.png`, data: dataUrlToBytes(canvasDataUrl(strip)) });
    const art = iconSourceArt({ strips, ...variant });
    if (art) files.push({ name: `${dir}/icon.png`, data: dataUrlToBytes(canvasDataUrl(composeIcon(art, state.project.icon!))) });
    files.push({ name: `${dir}/project-v3.json`, data: JSON.stringify(tierDraft(tier, ids[i]), null, 2) });
  }
  files.push({ name: 'README.txt', data: `OpenSpell tier variants of ${state.project.definition.name}\n\nEach folder holds one tier: layer PNGs (64x128 cells, ${profile().frames} frames), the 48x48 inventory icon and an editable draft.\nDraft item IDs (${ids[0]}–${ids[ids.length - 1]}) are provisional. Open a draft in the studio and export it; connect the updated library before exporting the next one so their IDs and sprites don't collide.\n` });
  return buildZip(files);
}
