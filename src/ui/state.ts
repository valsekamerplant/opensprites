import { AssetLibrary } from '../library';
import { PROFILES, defaultRig, defaultIcon, newDefinition, type EquipmentType, type ItemDef, type PartKey, type Project, type WeaponCutout } from '../model';
import type { Outfit } from '../compositor';
import type { ColourGroup } from '../palette';
import { $ } from './dom';

export type Panel = 'artwork' | 'colours' | 'settings' | 'icon';
export const PANELS: Panel[] = ['artwork', 'colours', 'settings', 'icon'];

export const library = new AssetLibrary();
export const fresh = (type: EquipmentType): Project => ({ version: 3, definition: newDefinition(type, library.defs), sourceParts: {}, autoRig: defaultRig(), replaceExisting: false, icon: defaultIcon(type) });

/** Everything the editor is showing. Panels read it directly and change it through actions. */
export const state = {
  project: fresh('weapon'),
  selected: 'main' as PartKey,
  uploadTarget: undefined as PartKey | undefined,
  pose: 0,
  playing: false,
  images: new Map<PartKey, HTMLImageElement>(),
  strips: new Map<PartKey, HTMLCanvasElement>(),
  iconImage: undefined as HTMLImageElement | undefined,
  iconArt: undefined as HTMLCanvasElement | undefined,
  /** A library item shown instead of the draft; the draft is untouched meanwhile. */
  browsing: undefined as ItemDef | undefined,
  librarySelection: undefined as ItemDef | undefined,
  sourceTool: 'pivot' as 'pivot' | 'colour',
  outfit: {} as Outfit,
  renderError: '',
  history: [] as Project[],
  future: [] as Project[],
  colourGroup: undefined as string[] | undefined,
  colourGroups: [] as ColourGroup[],
  openGroup: -1,
  panel: 'artwork' as Panel,
  /** Bumped on every rebuild, so derived renders can be cached per edit. */
  artVersion: 0,
  /** Unsaved edits since the last save or export. */
  dirty: false,
  ready: false,
};
export const drafts = new Map<EquipmentType, Project>();
export const cutoutImages = new Map<string, HTMLImageElement>();
export const masks = { defaultCutout: undefined as WeaponCutout | undefined };

export const type = () => state.project.definition.equipmentType!;
export const profile = () => PROFILES[type()];
export const source = () => state.project.sourceParts[state.selected];
export const hasArtwork = () => state.strips.size > 0;

export function snapshot() {
  state.history.push(structuredClone(state.project));
  if (state.history.length > 30) state.history.shift();
  state.future = []; state.dirty = true;
}
export function status(message: string, error = false) { const el = $('status'); el.textContent = message; el.classList.toggle('error', error); }
export async function task(fn: () => unknown) { try { await fn(); } catch (error) { status(error instanceof Error ? error.message : String(error), true); } }

// Events: 'project' — the draft's structure or fields changed (panels refill their fields);
// 'art' — layer strips and icon were rebuilt; 'pose' — the edited frame changed;
// 'library' — the game library changed; 'browse' — a library preview started or ended;
// 'panel' — the inspector tab changed.
export type StudioEvent = 'project' | 'art' | 'pose' | 'library' | 'browse' | 'panel';
const listeners = new Map<StudioEvent, (() => void)[]>();
export function on(event: StudioEvent, fn: () => void) { listeners.set(event, [...(listeners.get(event) ?? []), fn]); }
export function emit(event: StudioEvent) { for (const fn of listeners.get(event) ?? []) fn(); }
