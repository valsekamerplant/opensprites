import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PROFILES, type ItemDef } from '../src/model';
import { oklab } from '../src/palette';
import { ICON, ICON_COLUMNS, ICON_ATLAS } from '../src/icon';

// Native metal tiers are recolours: a bronze item and its iron, steel… counterparts share
// one silhouette and differ only in the material pixels. Pairing the pixels that differ
// collects each tier's material shades; pixels equal in both items (hilts, outlines, gems)
// are not material. Gold and silver warrior equipment pairs the same way.
const LINES = { bronze: ['iron', 'steel', 'palladium', 'coronium', 'celadon', 'legendary'], gold: ['silver'] } as const;
export const TIER_IDS = ['bronze', 'iron', 'steel', 'palladium', 'coronium', 'celadon', 'legendary', 'gold', 'silver'] as const;
type Tier = typeof TIER_IDS[number];
const MIN_SILHOUETTE = 0.95, RAMP = 8;

const defs: ItemDef[] = JSON.parse(await readFile('public/game/itemdefs.carbon', 'utf8'));
const load = async (file: string) => new Map<string, any>(await Promise.all(JSON.parse(await readFile(file, 'utf8')).map(async (e: any) => [e.filename, await loadImage(e.data)])));
const appearance = await load('public/game/appearance.carbon'), icons = await load('public/game/items.carbon');

function pixels(image: any, sx: number, sy: number, w: number, h: number) {
  const c = createCanvas(w, h), ctx = c.getContext('2d');
  ctx.drawImage(image, sx, sy, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}
function strip(atlas: string, frames: number, id: number) {
  const img = appearance.get(atlas), cols = img.width / 64, out: Uint8ClampedArray[] = [];
  for (let p = 0; p < frames; p++) { const cell = id * frames + p; out.push(pixels(img, cell % cols * 64, Math.floor(cell / cols) * 128, 64, 128)); }
  const all = new Uint8ClampedArray(out.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of out) { all.set(a, o); o += a.length; }
  return all;
}
const icon = (id: number) => pixels(icons.get(ICON_ATLAS), (id - 1) % ICON_COLUMNS * ICON, Math.floor((id - 1) / ICON_COLUMNS) * ICON, ICON, ICON);

const tierOf = (name: string): Tier | undefined => TIER_IDS.find(t => name.startsWith(`${t} `));
const family = (d: ItemDef) => d.name.slice(tierOf(d.name)!.length + 1);
// Every item image a tier item has: each appearance layer, plus its inventory icon.
function images(d: ItemDef): [string, () => Uint8ClampedArray][] {
  const out: [string, () => Uint8ClampedArray][] = [[`icon#${d._id}`, () => icon(d._id)]];
  const type = d.equipmentType as keyof typeof PROFILES | undefined, p = type && PROFILES[type];
  if (p && p.frames && d.equipmentSpriteSheet === p.sheet) for (const part of p.parts.filter(s => !s.special)) {
    const id = part.trim ? d.equipmentTrimSpriteId : d.equipmentSpriteId;
    if (typeof id === 'number' && id >= 0 && (!part.trim || d.equipmentTrimSpriteSheet)) out.push([`${part.atlas}#${id}`, () => strip(part.atlas, p.frames, id)]);
  }
  return out;
}
const hex = (d: Uint8ClampedArray, i: number) => `#${[0, 1, 2].map(c => d[i + c].toString(16).padStart(2, '0')).join('')}`;

// Material shades per tier, pixel-weighted across every paired item and icon.
// A colour is material when it changes in at least half of the paired pixels it appears in:
// legendary swaps the gold guard, so the guard changes sometimes but is not bronze.
const changed = new Map<Tier, Map<string, number>>(TIER_IDS.map(t => [t, new Map()])), present = new Map<Tier, Map<string, number>>(TIER_IDS.map(t => [t, new Map()]));
const add = (m: Map<Tier, Map<string, number>>, tier: Tier, hex: string) => { const t = m.get(tier)!; t.set(hex, (t.get(hex) ?? 0) + 1); };
const seen = new Set<string>(); let pairs = 0, skipped = 0;
for (const [root, others] of Object.entries(LINES) as [Tier, readonly Tier[]][]) {
  for (const base of defs.filter(d => tierOf(d.name) === root)) for (const tier of others) {
    const other = defs.find(d => tierOf(d.name) === tier && family(d) === family(base));
    if (!other) continue;
    const mine = images(other);
    for (const [key, read] of images(base)) {
      // Layers pair by atlas (sprite IDs differ between tiers); icons pair by item.
      const match = mine.find(([k]) => k.split('#')[0] === key.split('#')[0]);
      if (!match || seen.has(`${key}>${match[0]}`)) continue;
      seen.add(`${key}>${match[0]}`);
      const a = read(), b = match[1]();
      let both = 0, either = 0;
      for (let i = 3; i < a.length; i += 4) { if (a[i] || b[i]) either++; if (a[i] && b[i]) both++; }
      if (!either || both / either < MIN_SILHOUETTE) { skipped++; continue; }
      pairs++;
      // Each root pixel counts once per pairing, so roots weigh as much as their tiers.
      for (let i = 0; i < a.length; i += 4) if (a[i + 3] && b[i + 3]) {
        const from = hex(a, i), to = hex(b, i);
        add(present, root, from); add(present, tier, to);
        if (from !== to) { add(changed, root, from); add(changed, tier, to); }
      }
    }
  }
}
const shades = new Map<Tier, Map<string, number>>(TIER_IDS.map(t => [t, new Map([...changed.get(t)!].filter(([hex, n]) => n >= 0.5 * present.get(t)!.get(hex)!))]));
const lab = (h: string) => oklab(...[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]);
const light = (h: string) => lab(h)[0];
// The game tints each item family separately, so one bronze shade becomes different iron
// shades on different items. A canonical ramp gives new items one consistent answer: split
// the tier's material lightness range (ignoring the extreme 3% of pixels at each end) into
// equal steps and take each step's most common native colour on the step's main hue, so
// stray accent shades don't break the ramp.
function ramp(tier: Tier) {
  let all = [...shades.get(tier)!].map(([hex, n]) => { const [l, a, b] = lab(hex); return { hex, n, l, c: Math.hypot(a, b), h: Math.atan2(b, a) }; }).sort((a, b) => a.l - b.l);
  // Grey tiers (iron, steel, coronium…) keep only greys: coloured pixels there are trim.
  const greys = all.filter(c => c.c < 0.03);
  if (greys.reduce((s, c) => s + c.n, 0) > all.reduce((s, c) => s + c.n, 0) / 2) all = greys;
  const total = all.reduce((s, c) => s + c.n, 0), at = (q: number) => { let seen = 0; for (const c of all) { seen += c.n; if (seen >= total * q) return c.l; } return all[all.length - 1].l; };
  const lo = at(0.03), hi = at(0.97), step = (hi - lo) / RAMP || 1;
  const bands: (typeof all)[] = Array.from({ length: RAMP }, () => []);
  for (const c of all) if (c.l >= lo && c.l <= hi) bands[Math.min(RAMP - 1, Math.floor((c.l - lo) / step))].push(c);
  const picked = bands.filter(b => b.length).map(band => {
    const byHue = [...band].sort((p, q) => p.h - q.h); let seen = 0, total = band.reduce((s, c) => s + c.n, 0), hue = byHue[0].h;
    for (const c of byHue) { seen += c.n; if (seen >= total / 2) { hue = c.h; break; } }
    const good = band.filter(c => c.c < 0.02 || Math.abs(Math.atan2(Math.sin(c.h - hue), Math.cos(c.h - hue))) < 5 * Math.PI / 180);
    return (good.length ? good : band).reduce((p, q) => q.n > p.n ? q : p).hex;
  });
  // Neighbouring steps must be visibly different.
  return picked.filter((hex, i) => !i || light(hex) - light(picked[i - 1]) >= 0.02);
}
const ramps = Object.fromEntries(TIER_IDS.map(t => [t, ramp(t)]));

console.log(`Paired ${pairs} images (${skipped} skipped: different silhouettes).`);
for (const tier of TIER_IDS) console.log(`  ${tier.padEnd(10)} ${String(shades.get(tier)!.size).padStart(3)} shades · ramp ${ramps[tier].join(' ')}`);

await writeFile('src/tier-palettes.ts', `// Generated by scripts/bake-tier-palettes.ts from the pinned OpenSpell assets. Do not edit by hand.
export const TIER_IDS = ${JSON.stringify(TIER_IDS)} as const;
export type TierId = typeof TIER_IDS[number];
// Canonical ramp per tier: native material colours from dark to light, one per equal-pixel band.
export const TIER_RAMPS: Record<TierId, readonly string[]> = {
${TIER_IDS.map(t => `  ${t}: ${JSON.stringify(ramps[t])},`).join('\n')}
};
// Every native material shade of each tier (hex without '#'), for recognising a tier's art.
export const TIER_SHADES: Record<TierId, string> = {
${TIER_IDS.map(t => `  ${t}: '${[...shades.get(t)!.keys()].sort().map(h => h.slice(1)).join(' ')}',`).join('\n')}
};
`);
console.log('Wrote src/tier-palettes.ts');
