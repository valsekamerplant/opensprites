import { TIER_IDS, TIER_RAMPS, TIER_SHADES, type TierId } from './tier-palettes';
import { lightness, reshadeColours, type ColorReplacement } from './palette';

export { TIER_IDS, type TierId };
export type PaletteColour = { hex: string; count: number };
/** A tier the user defines: its material becomes `base`, shaded like a group recolour. */
export type CustomTier = { id: string; label: string; base: string; reshade: number };
export type Tier = { id: string; label: string; ramp: readonly string[]; native?: TierId; custom?: CustomTier };

const title = (s: string) => s[0].toUpperCase() + s.slice(1);
export const NATIVE_TIERS: Tier[] = TIER_IDS.map(id => ({ id, label: title(id), ramp: TIER_RAMPS[id], native: id }));
const GREYS = ['#2c2c2c', '#444444', '#5c5c5c', '#747474', '#8c8c8c', '#a8a8a8'].map(hex => ({ hex, count: 1 }));
export function customTier(c: CustomTier): Tier { return { id: c.id, label: c.label, ramp: reshadeColours(GREYS, c.base, c.reshade), custom: c }; }
export const allTiers = (custom: CustomTier[] = []) => [...NATIVE_TIERS, ...custom.map(customTier)];
export const isNativeTier = (id: string): id is TierId => (TIER_IDS as readonly string[]).includes(id);

const HEX = /^#[0-9a-f]{6}$/i;
export function validateCustomTiers(value: unknown): CustomTier[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('Custom tiers must be an array of at most 64 tiers.');
  const ids = new Set<string>();
  return value.map((t: any, i) => {
    if (!t || typeof t.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(t.id) || isNativeTier(t.id) || ids.has(t.id)) throw new Error(`Custom tier ${i + 1} needs a unique id.`);
    if (typeof t.label !== 'string' || !t.label.trim() || t.label.length > 40) throw new Error(`Custom tier ${i + 1} needs a name.`);
    if (typeof t.base !== 'string' || !HEX.test(t.base)) throw new Error(`Custom tier ${i + 1} has an invalid colour.`);
    if (typeof t.reshade !== 'number' || !Number.isFinite(t.reshade) || t.reshade < 0 || t.reshade > 100) throw new Error(`Custom tier ${i + 1} reshade must be between 0 and 100.`);
    ids.add(t.id);
    return { id: t.id, label: t.label.trim(), base: t.base.toLowerCase(), reshade: t.reshade };
  });
}

const shades = new Map<TierId, Set<string>>(TIER_IDS.map(t => [t, new Set(TIER_SHADES[t].split(' ').map(h => `#${h}`))]));

/** Colours of a palette that are material shades of a native tier. */
export const materialColours = (palette: PaletteColour[], tier: TierId) => palette.filter(c => shades.get(tier)!.has(c.hex.toLowerCase()));
/**
 * The native tier whose material shades cover the most pixels, when they make up a real
 * part of the image (at least three shades and a fifth of its pixels).
 */
export function detectTier(palette: PaletteColour[]): TierId | undefined {
  const total = palette.reduce((n, c) => n + c.count, 0);
  let best: TierId | undefined, bestPixels = 0;
  for (const tier of TIER_IDS) {
    const found = materialColours(palette, tier), pixels = found.reduce((n, c) => n + c.count, 0);
    if (found.length >= 3 && pixels > bestPixels) { best = tier; bestPixels = pixels; }
  }
  return best && bestPixels >= total * 0.2 ? best : undefined;
}

const weighted = (values: { l: number; w: number }[]) => {
  const total = values.reduce((n, v) => n + v.w, 0) || 1, mean = values.reduce((n, v) => n + v.l * v.w, 0) / total;
  return { mean, spread: Math.sqrt(values.reduce((n, v) => n + (v.l - mean) ** 2 * v.w, 0) / total) };
};
/**
 * Map colours onto a ramp's own shades by relative lightness, so the output only ever uses
 * the tier's palette. Contrast follows the source within reason.
 */
export function snapToRamp(colours: PaletteColour[], ramp: readonly string[]): string[] {
  const src = colours.map(c => ({ l: lightness(c.hex), w: Math.max(1, c.count) })), shades = ramp.map(hex => ({ hex, l: lightness(hex) }));
  const s = weighted(src), r = weighted(shades.map(x => ({ l: x.l, w: 1 })));
  const k = s.spread > 1e-3 ? Math.min(2, Math.max(0.5, r.spread / s.spread)) : 1;
  return src.map(({ l }) => { const goal = r.mean + (l - s.mean) * k; return shades.reduce((a, b) => Math.abs(b.l - goal) < Math.abs(a.l - goal) ? b : a).hex; });
}
/**
 * The exact colour map the game uses between two items that share art, such as a bronze
 * longsword and the iron one: every colour that changes, by majority over their pixels.
 * Returns undefined when the silhouettes differ.
 */
export function pairedMap(source: Uint8ClampedArray, sibling: Uint8ClampedArray): Map<string, string> | undefined {
  if (source.length !== sibling.length) return;
  let both = 0, either = 0;
  const votes = new Map<string, Map<string, number>>(), hex = (d: Uint8ClampedArray, i: number) => `#${((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]).toString(16).padStart(6, '0')}`;
  for (let i = 0; i < source.length; i += 4) {
    if (source[i + 3] || sibling[i + 3]) either++;
    if (!source[i + 3] || !sibling[i + 3]) continue;
    both++;
    const from = hex(source, i), to = hex(sibling, i);
    let tally = votes.get(from); if (!tally) votes.set(from, tally = new Map());
    tally.set(to, (tally.get(to) ?? 0) + 1);
  }
  if (!either || both / either < 0.95) return;
  const map = new Map<string, string>();
  for (const [from, tally] of votes) { const to = [...tally].sort((a, b) => b[1] - a[1])[0][0]; if (to !== from) map.set(from, to); }
  return map;
}
/**
 * The colour each material colour becomes in `target`. `exact` (from pairedMap) reproduces a
 * native sibling item; other colours snap to the tier's canonical ramp, and custom tiers
 * reshade onto their base colour.
 */
export function tierMap(colours: PaletteColour[], target: Tier, exact?: Map<string, string>): string[] {
  const fallback = target.custom ? reshadeColours(colours, target.custom.base, target.custom.reshade) : snapToRamp(colours, target.ramp);
  return colours.map((c, i) => exact?.get(c.hex.toLowerCase()) ?? fallback[i]);
}
/** A replacement rule applying `target` to these material colours, or none when unchanged. */
export function tierRule(colours: PaletteColour[], target: Tier, exact?: Map<string, string>): ColorReplacement | undefined {
  if (!colours.length) return;
  const hexes = colours.map(c => c.hex.toLowerCase()), map = tierMap(colours, target, exact);
  if (map.every((c, i) => c === hexes[i])) return;
  return { from: hexes[0], to: map[0], tolerance: 0, preserveShading: false, enabled: true, colours: hexes, map, tier: target.id };
}
/** "bronze spear" → "iron spear"; a name without a tier word gets one in front. */
export function swapTierWord(name: string, to: Tier, tiers: Tier[] = NATIVE_TIERS): string {
  const words = tiers.flatMap(t => [t.id, t.label.toLowerCase()]).sort((a, b) => b.length - a.length);
  const lower = name.toLowerCase(), word = to.label.toLowerCase();
  const found = words.find(w => lower === w || lower.startsWith(`${w} `));
  return found ? `${word}${name.slice(found.length)}` : `${word} ${name}`;
}
