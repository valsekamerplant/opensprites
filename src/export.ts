import { type CarbonEntry, copyAtlasWithSlot, loadImage, imageDataUrl, canvasDataUrl } from './carbon';
import { PROFILES, activeParts, type ItemDef, type Project, type PartKey, type PartSpec } from './model';
import { canvas } from './artwork';
import { ICON_ATLAS, OUTLINE_ATLAS, outlineIcon, writeIcon } from './icon';

const painted = new WeakMap<HTMLImageElement, number>();
/** Sprite slots up to the last one holding any pixels. A 15-frame sheet fits two sprites per
 *  row, so the image height alone would count a blank right half as taken. */
export function paintedSlots(image: HTMLImageElement, frames: number): number {
  const known = painted.get(image); if (known !== undefined) return known;
  const c = canvas(image.width, image.height), ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height), cols = Math.floor(image.width / 64);
  let slots = 0;
  for (let cell = cols * Math.floor(image.height / 128) - 1; cell >= 0 && !slots; cell--) {
    const x0 = (cell % cols) * 64, y0 = Math.floor(cell / cols) * 128;
    for (let y = y0; y < y0 + 128 && !slots; y++) for (let x = x0; x < x0 + 64; x++) if (data[(y * image.width + x) * 4 + 3]) { slots = Math.floor(cell / frames) + 1; break; }
  }
  painted.set(image, slots);
  return slots;
}
export function nextSpriteId(images: Map<string, HTMLImageElement>, defs: ItemDef[], type: keyof typeof PROFILES, trim = false): number {
  const p = PROFILES[type]; let next = 0;
  for (const part of p.parts.filter(s => !!s.trim === trim && !s.special)) {
    const image = images.get(part.atlas);
    if (image) next = Math.max(next, paintedSlots(image, p.frames));
  }
  for (const def of defs) {
    const sheet = trim ? def.equipmentTrimSpriteSheet : def.equipmentSpriteSheet;
    const sprite = trim ? def.equipmentTrimSpriteId : def.equipmentSpriteId;
    const expected = trim ? (type === 'back' ? '' : p.sheet.replace('1', 'trim1')) : p.sheet;
    if (sheet === expected && typeof sprite === 'number' && sprite >= 0) next = Math.max(next, sprite + 1);
  }
  return next;
}
export type SpritePlan = { id: number; sheet: string; trimId: number | null; trimSheet: string | null; layers: { part: PartSpec; slot: number }[] };
/** Where the export writes the artwork: the sprite IDs and each atlas slot it fills. */
export function planSprites(project: Project, strips: Map<PartKey, HTMLCanvasElement>, images: Map<string, HTMLImageElement>, defs: ItemDef[]): SpritePlan | null {
  const def = project.definition, type = def.equipmentType!, p = PROFILES[type];
  if (type === 'projectile') return null;
  const id = project.replaceExisting ? def.equipmentSpriteId : nextSpriteId(images, defs, type);
  if (!Number.isInteger(id) || id! < 0) throw new Error('Replacement needs a valid sprite ID.');
  const hasTrim = p.parts.some(s => s.trim && strips.has(s.key));
  const trimId = hasTrim ? (project.replaceExisting && typeof def.equipmentTrimSpriteId === 'number' && def.equipmentTrimSpriteId >= 0 ? def.equipmentTrimSpriteId : nextSpriteId(images, defs, type, true)) : null;
  const layers = activeParts(def).filter(part => (!part.trim || hasTrim) && (!part.special || strips.has(part.key)))
    .map(part => ({ part, slot: part.special ? 0 : part.trim ? trimId! : id! }));
  return { id: id!, sheet: p.sheet, trimId, trimSheet: hasTrim ? p.sheet.replace('1', 'trim1') : null, layers };
}
export function validateExport(project: Project, strips: Map<PartKey, HTMLCanvasElement>, defs: ItemDef[]) {
  const d = project.definition;
  if (!Number.isInteger(d._id) || d._id < 0 || !d.name.trim()) throw new Error('Give the item a name and a non-negative integer ID.');
  if (!project.replaceExisting && defs.some(x => x._id === d._id)) throw new Error(`Item ID ${d._id} already exists. Choose a new ID or explicitly enable replacement.`);
  if (d.equipmentType === 'projectile') return;
  if (!activeParts(d).some(s => !s.trim && !s.special && strips.has(s.key))) throw new Error('Add artwork or start from an existing item.');
  if (d._id !== 617 && d.equipmentType === 'helmet' && strips.has('back')) throw new Error('Only pumpkin mask 617 can use the helmet rear layer.');
}
export async function nativeBundle(project: Project, strips: Map<PartKey, HTMLCanvasElement>, original: CarbonEntry[], images: Map<string, HTMLImageElement>, defs: ItemDef[]) {
  validateExport(project, strips, defs);
  const def = structuredClone(project.definition), p = PROFILES[def.equipmentType!];
  const plan = planSprites(project, strips, images, defs);
  if (!plan) { def.equipmentSpriteId = null; def.equipmentSpriteSheet = null; return { entries: original, definition: def }; }
  def.equipmentSpriteId = plan.id; def.equipmentSpriteSheet = plan.sheet;
  def.equipmentTrimSpriteId = plan.trimId; def.equipmentTrimSpriteSheet = plan.trimSheet;
  const entries = original.map(e => ({ ...e }));
  for (const { part, slot } of plan.layers) {
    const entry = entries.find(e => e.filename === part.atlas);
    if (!entry) throw new Error(`Connected appearance bundle is missing ${part.atlas}.`);
    const base = images.get(part.atlas) || await loadImage(imageDataUrl(entry));
    const strip = strips.get(part.key) || canvas(p.frames * 64); // transparent mate is a valid layer
    entry.data = canvasDataUrl(copyAtlasWithSlot(base, strip, p.frames, slot));
  }
  return { entries, definition: def };
}
// Full icon bundle with the item's cell written into both atlases, sized for the merged
// definition count as the client expects.
export async function iconBundle(icon: HTMLCanvasElement, id: number, original: CarbonEntry[], images: Map<string, HTMLImageElement>, definitionCount: number) {
  const entries = original.map(e => ({ ...e }));
  for (const [name, art] of [[ICON_ATLAS, icon], [OUTLINE_ATLAS, outlineIcon(icon)]] as const) {
    const entry = entries.find(e => e.filename === name);
    if (!entry) throw new Error(`Connected icon bundle is missing ${name}.`);
    const atlas = images.get(name) || await loadImage(imageDataUrl(entry));
    entry.data = canvasDataUrl(writeIcon(atlas, art, id, definitionCount));
  }
  return entries;
}
