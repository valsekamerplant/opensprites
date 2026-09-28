import { parseCarbon, loadImage, imageDataUrl, type CarbonEntry } from './carbon';
import { TYPES, type ItemDef } from './model';
import { ICON, ICON_COLUMNS, ICON_ATLAS, OUTLINE_ATLAS } from './icon';

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
export function validateItemIcons(text: string): CarbonEntry[] {
  const value = validateAppearance(text);
  for (const name of [ICON_ATLAS, OUTLINE_ATLAS]) if (!value.some(e => e.filename === name)) throw new Error(`Item icon bundle is missing ${name}.`);
  return value;
}
/** A bundled file's URL, relative to where the studio is hosted (e.g. /opensprites/). */
export const assetUrl = (path: string) => `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}${path}`;
export class AssetLibrary {
  entries: CarbonEntry[] = [];
  iconEntries: CarbonEntry[] = [];
  icons = new Map<string, HTMLImageElement>();
  defs: ItemDef[] = [];
  images = new Map<string, HTMLImageElement>();
  label = 'Bundled OpenSpell';
  /** Where the library came from; exports built on 'bundled' don't know your custom items. */
  source: 'bundled' | 'folder' | 'files' = 'bundled';
  report?: LibraryReport;
  async setAppearance(entries: CarbonEntry[]) {
    const decoded = await Promise.all(entries.filter(e => e.filename.endsWith('.png')).map(async e => [e.filename, await loadImage(imageDataUrl(e))] as const));
    for (const [name, image] of decoded) if (image.width % 64 || image.height % 128) throw new Error(`${name} is not a 64×128 cell atlas.`);
    this.entries = entries;
    this.images = new Map(decoded);
  }
  async setIcons(entries: CarbonEntry[]) {
    const decoded = await Promise.all([ICON_ATLAS, OUTLINE_ATLAS].map(async name => [name, await loadImage(imageDataUrl(entries.find(e => e.filename === name)!))] as const));
    for (const [name, image] of decoded) if (image.width !== ICON * ICON_COLUMNS || image.height % ICON) throw new Error(`${name} is not a ${ICON_COLUMNS}-column ${ICON}×${ICON} icon atlas.`);
    this.iconEntries = entries; this.icons = new Map(decoded);
  }
  async bundled() {
    const responses = await Promise.all(['appearance', 'itemdefs', 'items'].map(name => fetch(assetUrl(`game/${name}.carbon`))));
    if (responses.some(r => !r.ok)) throw new Error('Bundled library unavailable. PNG authoring still works; connect project data when ready.');
    const [appearance, defs, icons] = await Promise.all(responses.map(r => r.text()));
    const parsedDefs = validateDefs(defs), parsedIcons = validateItemIcons(icons);
    await this.setAppearance(validateAppearance(appearance)); await this.setIcons(parsedIcons); this.defs = parsedDefs;
    this.label = 'Bundled OpenSpell'; this.source = 'bundled'; this.report = undefined;
  }
  items() { return this.defs.filter(d => TYPES.includes(d.equipmentType!)); }
}
export type FileLike = { name: string; webkitRelativePath?: string; text(): Promise<string> };
export const LIBRARY_FILES = ['appearance.carbon', 'itemdefs.carbon', 'items.carbon'] as const;
/** Folders that hold copies (dependencies, builds, history), never the checkout's own assets. */
export const IGNORED_DIRECTORY = /^(node_modules|dist|build|coverage|\..+)$/;
export type LibraryReport = {
  used: { name: string; layer: 'base' | 'custom' | 'file'; path: string }[];
  skipped: { path: string; reason: string }[];
  baseItems: number; customItems: number;
};
const pathOf = (f: FileLike) => (f.webkitRelativePath || f.name).replaceAll('\\', '/');
// OpenSpell keeps assets in apps/shared-assets/{base,custom}/static/. Accept any folder above
// that (the checkout, apps, shared-assets itself) and ignore copies inside ignored folders.
function layerOf(path: string): 'base' | 'custom' | undefined {
  return (/(?:^|\/)shared-assets\/(base|custom)\/static\//.exec(path) ?? /^[^/]+\/(base|custom)\/static\//.exec(path))?.[1] as 'base' | 'custom' | undefined;
}
const depth = (path: string) => path.split('/').length;
/**
 * Read a picked OpenSpell folder (or loose asset files). Base and custom follow the game's
 * precedence: appearance and item icons replace the bundle wholesale, definitions merge by
 * _id. When copies remain, the shallowest file wins and the others are reported as skipped.
 */
export async function readProjectFiles(files: FileLike[], fallback: { entries: CarbonEntry[]; defs: ItemDef[]; iconEntries?: CarbonEntry[] }) {
  const report: LibraryReport = { used: [], skipped: [], baseItems: 0, customItems: 0 };
  const usable = files.filter(f => {
    if (!(LIBRARY_FILES as readonly string[]).includes(f.name)) return false;
    const ignored = pathOf(f).split('/').slice(0, -1).some(dir => IGNORED_DIRECTORY.test(dir));
    if (ignored) report.skipped.push({ path: pathOf(f), reason: 'inside an ignored folder' });
    return !ignored;
  });
  const pick = (candidates: FileLike[]) => {
    const sorted = [...candidates].sort((a, b) => depth(pathOf(a)) - depth(pathOf(b)) || pathOf(a).localeCompare(pathOf(b)));
    for (const extra of sorted.slice(1)) report.skipped.push({ path: pathOf(extra), reason: `another copy of ${pathOf(sorted[0])}` });
    return sorted[0];
  };
  let entries = fallback.entries, defs = fallback.defs, iconEntries = fallback.iconEntries ?? [];
  let baseIds = new Set(fallback.defs.map(d => d._id));
  for (const name of LIBRARY_FILES) {
    const named = usable.filter(f => f.name === name);
    const base = pick(named.filter(f => layerOf(pathOf(f)) === 'base')), custom = pick(named.filter(f => layerOf(pathOf(f)) === 'custom'));
    let loose: FileLike | undefined;
    if (!base && !custom) {
      if (named.length > 1) throw new Error(`Found ${named.length} copies of ${name} outside the OpenSpell layout (${named.map(pathOf).join(', ')}). Pick the checkout, or its apps/shared-assets folder.`);
      loose = named[0];
    }
    for (const [file, layer] of [[base, 'base'], [custom, 'custom'], [loose, 'file']] as const) if (file) {
      const text = await file.text();
      report.used.push({ name, layer, path: pathOf(file) });
      if (name === 'appearance.carbon') entries = validateAppearance(text); // wholesale overlay
      else if (name === 'items.carbon') iconEntries = validateItemIcons(text); // wholesale overlay
      else {
        const parsed = validateDefs(text);
        if (layer === 'base') { defs = parsed; baseIds = new Set(parsed.map(d => d._id)); }
        else defs = [...new Map([...defs, ...parsed].map(d => [d._id, d])).values()];
      }
    }
  }
  if (!report.used.length) throw new Error(`No appearance.carbon, itemdefs.carbon or items.carbon found${report.skipped.length ? ' outside ignored folders (node_modules, build…)' : ''}. Pick your OpenSpell checkout, or its apps/shared-assets folder. Your current library remains available.`);
  report.baseItems = defs.filter(d => baseIds.has(d._id)).length; report.customItems = defs.length - report.baseItems;
  return { entries, defs, iconEntries, report };
}
