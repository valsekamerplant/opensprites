import { type CarbonEntry, copyAtlasWithSlot, loadImage, imageDataUrl, canvasDataUrl } from './carbon';
import { PROFILES, activeParts, type ItemDef, type Project, type PartKey } from './model';
import { canvas } from './artwork';
import { ICON_ATLAS, OUTLINE_ATLAS, outlineIcon, writeIcon } from './icon';

export function nextSpriteId(entries: CarbonEntry[], images: Map<string, HTMLImageElement>, defs: ItemDef[], type: keyof typeof PROFILES, trim = false): number {
  const p = PROFILES[type]; let next = 0;
  for (const part of p.parts.filter(s => !!s.trim === trim && !s.special)) {
    const image = images.get(part.atlas);
    if (image) next = Math.max(next, Math.ceil(image.width / 64 * image.height / 128 / p.frames));
  }
  for (const def of defs) {
    const sheet = trim ? def.equipmentTrimSpriteSheet : def.equipmentSpriteSheet;
    const sprite = trim ? def.equipmentTrimSpriteId : def.equipmentSpriteId;
    const expected = trim ? (type === 'back' ? '' : p.sheet.replace('1', 'trim1')) : p.sheet;
    if (sheet === expected && typeof sprite === 'number' && sprite >= 0) next = Math.max(next, sprite + 1);
  }
  return next;
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
  const def = structuredClone(project.definition), type = def.equipmentType!, p = PROFILES[type];
  if (type === 'projectile') { def.equipmentSpriteId = null; def.equipmentSpriteSheet = null; return { entries: original, definition: def }; }
  const id = project.replaceExisting ? def.equipmentSpriteId : nextSpriteId(original, images, defs, type);
  if (!Number.isInteger(id) || id! < 0) throw new Error('Replacement needs a valid sprite ID.');
  def.equipmentSpriteId = id; def.equipmentSpriteSheet = p.sheet;
  const hasTrim = p.parts.some(s => s.trim && strips.has(s.key));
  const trimId = hasTrim ? (project.replaceExisting && typeof def.equipmentTrimSpriteId === 'number' && def.equipmentTrimSpriteId >= 0 ? def.equipmentTrimSpriteId : nextSpriteId(original, images, defs, type, true)) : null;
  def.equipmentTrimSpriteId = trimId;
  def.equipmentTrimSpriteSheet = hasTrim ? p.sheet.replace('1', 'trim1') : null;
  const entries = original.map(e => ({ ...e }));
  for (const part of activeParts(def)) {
    if (part.trim && !hasTrim) continue;
    if (part.special && !strips.has(part.key)) continue;
    const entry = entries.find(e => e.filename === part.atlas);
    if (!entry) throw new Error(`Connected appearance bundle is missing ${part.atlas}.`);
    const base = images.get(part.atlas) || await loadImage(imageDataUrl(entry));
    const strip = strips.get(part.key) || canvas(p.frames * 64); // transparent mate is a valid layer
    const updated = copyAtlasWithSlot(base, await loadImage(canvasDataUrl(strip)), p.frames, part.special ? 0 : part.trim ? trimId! : id!);
    entry.data = canvasDataUrl(updated);
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
