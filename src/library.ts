import { parseCarbon, loadImage, imageDataUrl, type CarbonEntry } from './carbon';
import { TYPES, type ItemDef } from './model';

export function validateAppearance(text: string): CarbonEntry[] {
  const value: unknown = parseCarbon(text);
  if (!Array.isArray(value) || !value.length) throw new Error('Appearance must contain an array of image entries.');
  const names = new Set();
  for (const entry of value) {
    if (!entry || typeof entry.filename !== 'string' || typeof entry.data !== 'string' || !entry.data || names.has(entry.filename)) throw new Error('Invalid or duplicate appearance entry.');
    names.add(entry.filename);
  }
  return value;
}
export function validateDefs(text: string): ItemDef[] {
  const value: unknown = parseCarbon(text);
  if (!Array.isArray(value)) throw new Error('Item definitions must be an array.');
  const ids = new Set();
  for (const d of value) {
    if (!d || !Number.isInteger(d._id) || d._id < 0 || typeof d.name !== 'string' || ids.has(d._id)) throw new Error('Item definitions need unique numeric IDs and names.');
    ids.add(d._id);
  }
  return value;
}
export class AssetLibrary {
  entries: CarbonEntry[] = [];
  defs: ItemDef[] = [];
  images = new Map<string, HTMLImageElement>();
  label = 'Bundled OpenSpell';
  async setAppearance(entries: CarbonEntry[]) {
    const decoded = await Promise.all(entries.filter(e => e.filename.endsWith('.png')).map(async e => [e.filename, await loadImage(imageDataUrl(e))] as const));
    for (const [name, image] of decoded) if (image.width % 64 || image.height % 128) throw new Error(`${name} is not a 64×128 cell atlas.`);
    this.entries = entries;
    this.images = new Map(decoded);
  }
  async bundled() {
    const responses = await Promise.all([fetch('/game/appearance.carbon'), fetch('/game/itemdefs.carbon')]);
    if (responses.some(r => !r.ok)) throw new Error('Bundled library unavailable. PNG authoring still works; connect project data when ready.');
    const [appearance, defs] = await Promise.all(responses.map(r => r.text()));
    const parsedDefs = validateDefs(defs);
    await this.setAppearance(validateAppearance(appearance)); this.defs = parsedDefs;
  }
  items() { return this.defs.filter(d => TYPES.includes(d.equipmentType!)); }
}
type FileLike = { name: string; webkitRelativePath?: string; text(): Promise<string> };
// Match known asset locations. Never choose an arbitrary first file from a recursive scan.
export async function readProjectFiles(files: FileLike[], fallback: { entries: CarbonEntry[]; defs: ItemDef[] }) {
  const path = (f: FileLike) => (f.webkitRelativePath || f.name).replaceAll('\\', '/');
  const choose = (name: string, variant: 'base' | 'custom') => {
    const candidates = files.filter(f => f.name === name && path(f).includes(`/shared-assets/${variant}/static/`));
    if (candidates.length > 1) throw new Error(`More than one ${variant} ${name}; select one OpenSpell checkout.`);
    return candidates[0];
  };
  let entries = fallback.entries, defs = fallback.defs;
  let loaded = 0;
  for (const name of ['appearance.carbon', 'itemdefs.carbon']) {
    const base = choose(name, 'base'), custom = choose(name, 'custom');
    const standalone = !base && !custom ? files.filter(f => f.name === name) : [];
    if (standalone.length > 1) throw new Error(`Multiple ${name} files outside the standard layout; choose a specific asset folder.`);
    for (const file of [base || standalone[0], custom]) if (file) {
      const text = await file.text(); loaded++;
      if (name === 'appearance.carbon') entries = validateAppearance(text); // wholesale overlay
      else {
        const parsed = validateDefs(text);
        defs = file === base ? parsed : [...new Map([...defs, ...parsed].map(d => [d._id, d])).values()];
      }
    }
  }
  if (!loaded) throw new Error('No appearance.carbon or itemdefs.carbon found. Your current library remains available.');
  return { entries, defs };
}
