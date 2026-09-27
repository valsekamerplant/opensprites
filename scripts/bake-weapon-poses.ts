import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

// Fits a rigid 2D transform per frame that turns each native weapon's upright side view
// (frame 6) into its other 14 frames, then takes the per-family median. Pixels hidden by
// the hand or, in rear views, the body are "don't care": native art is cut out there.
const FAMILIES = {
  sword: { label: 'Sword / scimitar', sprites: [4, 5, 6, 7, 8, 20, 22] },
  axe: { label: 'Axe / hatchet', sprites: [9, 15, 16, 17, 18, 21, 23] },
  pickaxe: { label: 'Pickaxe', sprites: [10, 11, 12, 13, 14, 19] },
  bow: { label: 'Bow', sprites: [24, 25, 26] },
  staff: { label: 'Staff', sprites: [27, 28] },
} as const;
const REFERENCE = 6, W = 64, H = 128, SKEW_COST = 1.5;

const entries = JSON.parse(await readFile('public/game/appearance.carbon', 'utf8'));
const images: Map<string, any> = new Map(await Promise.all(entries.map(async (e: any) => [e.filename, await loadImage(e.data)])));
function alpha(name: string, id: number) {
  const img = images.get(name), cols = img.width / W, c = createCanvas(W * 15, H), ctx = c.getContext('2d');
  for (let p = 0; p < 15; p++) { const cell = id * 15 + p; ctx.drawImage(img, cell % cols * W, Math.floor(cell / cols) * H, W, H, p * W, 0, W, H); }
  const d = ctx.getImageData(0, 0, W * 15, H).data;
  return Array.from({ length: 15 }, (_, p) => { const m = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = d[(y * W * 15 + p * W + x) * 4 + 3] ? 1 : 0; return m; });
}
const body = alpha('body.png', 0), gloves = alpha('gloves1.png', 0), pants = alpha('pants.png', 0);
const occluder = body.map((b, p) => b.map((v, i) => (v && gloves[p][i]) || (p >= 9 && (v || pants[p][i])) ? 1 : 0));

type Params = { r: number; sx: number; sy: number; k: number; x: number; y: number };
const rad = Math.PI / 180;
// Same composition as src/artwork.ts transform(): translate, rotate, skewX, scale.
function project(pts: Float64Array, a: Params, out: Uint8Array, stamp: number) {
  const c = Math.cos(a.r * rad), s = Math.sin(a.r * rad), t = Math.tan(a.k * rad);
  let n = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const u = pts[i] * a.sx, v = pts[i + 1] * a.sy, w = u + t * v;
    const X = Math.floor(a.x + c * w - s * v), Y = Math.floor(a.y + s * w + c * v);
    if (X < 0 || X >= W || Y < 0 || Y >= H) continue;
    const idx = Y * W + X; if (out[idx] !== stamp) { out[idx] = stamp; n++; }
  }
  return n;
}
function scorer(target: Uint8Array, occ: Uint8Array) {
  const tCount = target.reduce((s, v) => s + v, 0), buf = new Uint8Array(W * H);
  let stamp = 0;
  return (pts: Float64Array, a: Params) => {
    stamp = stamp % 255 + 1; if (stamp === 1) buf.fill(0);
    project(pts, a, buf, stamp);
    let hit = 0, miss = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === stamp) { if (target[i]) hit++; else if (!occ[i]) miss++; }
    // Skew and rotation trade off on thin weapons; skew must earn its keep.
    return { score: 2 * hit - miss - tCount - SKEW_COST * Math.abs(a.k), iou: hit / (tCount + miss) };
  };
}
function handCentre(weapon: Uint8Array, p: number) {
  let x = 0, y = 0, n = 0;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    if (!body[p][Y * W + X] || !gloves[p][Y * W + X]) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) { const a = X + dx, b = Y + dy; if (a >= 0 && a < W && b >= 0 && b < H && weapon[b * W + a]) { near = true; break; } }
    if (near) { x += X + .5; y += Y + .5; n++; }
  }
  return { x: x / n, y: y / n };
}
// Reference points relative to the hand, turned upright, 2×2 supersampled.
function canonical(ref: Uint8Array, hand: { x: number; y: number }) {
  const pts: number[] = [];
  let mx = 0, my = 0, n = 0;
  for (let i = 0; i < ref.length; i++) if (ref[i]) { mx += i % W + .5; my += Math.floor(i / W) + .5; n++; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < ref.length; i++) if (ref[i]) { const dx = i % W + .5 - mx, dy = Math.floor(i / W) + .5 - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const th = .5 * Math.atan2(2 * sxy, sxx - syy); let ux = Math.cos(th), uy = Math.sin(th); if (uy > 0) { ux = -ux; uy = -uy; }
  const lean = Math.atan2(ux, -uy), c = Math.cos(-lean), s = Math.sin(-lean);
  for (let i = 0; i < ref.length; i++) if (ref[i]) for (const ox of [.25, .75]) for (const oy of [.25, .75]) {
    const dx = i % W + ox - hand.x, dy = Math.floor(i / W) + oy - hand.y;
    pts.push(c * dx - s * dy, s * dx + c * dy);
  }
  return new Float64Array(pts);
}
function fit(pts: Float64Array, target: Uint8Array, occ: Uint8Array, hand: { x: number; y: number }) {
  const score = scorer(target, occ);
  let best: Params = { r: 0, sx: 1, sy: 1, k: 0, x: hand.x, y: hand.y }, bestScore = -Infinity;
  for (let r = -45; r <= 45; r += 3) for (let sx = .1; sx <= 1.21; sx += .1) for (const sy of [.85, 1, 1.15]) for (let k = -24; k <= 24; k += 6) {
    const a = { r, sx, sy, k, x: hand.x, y: hand.y }, v = score(pts, a).score;
    if (v > bestScore) { bestScore = v; best = a; }
  }
  const steps: Record<keyof Params, number> = { r: 2, sx: .05, sy: .05, k: 3, x: 1, y: 1 };
  for (let round = 0; round < 4; round++) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const key of Object.keys(steps) as (keyof Params)[]) for (const dir of [-1, 1]) {
        const a = { ...best, [key]: best[key] + dir * steps[key] };
        if (a.sx < .05 || a.sx > 1.3 || a.sy < .7 || a.sy > 1.3 || Math.abs(a.k) > 30) continue;
        const v = score(pts, a).score;
        if (v > bestScore) { bestScore = v; best = a; improved = true; }
      }
    }
    for (const key of Object.keys(steps) as (keyof Params)[]) steps[key] /= 2;
  }
  return { params: best, iou: score(pts, best).iou };
}
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

const presets: Record<string, { label: string; frames: number[][] }> = {};
for (const [key, family] of Object.entries(FAMILIES)) {
  const fits = family.sprites.map(id => {
    const weapon = alpha('weapon1.png', id), pts = canonical(weapon[REFERENCE], handCentre(weapon[REFERENCE], REFERENCE));
    return weapon.map((target, p) => fit(pts, target, occluder[p], handCentre(target, p)));
  });
  // Foreshortening depends on the view direction, not the walk phase, so width and
  // height scales use the median of each three-frame direction group. This also steadies
  // rear views, where the body hides most of the weapon.
  const group = (p: number, key: 'sx' | 'sy') => median(fits.flatMap(f => [0, 1, 2].map(i => f[Math.floor(p / 3) * 3 + i].params[key])));
  const frames = Array.from({ length: 15 }, (_, p) => {
    const all = fits.map(f => f[p].params);
    return [round(median(all.map(a => a.x)), 1), round(median(all.map(a => a.y)), 1), round(median(all.map(a => a.r)), 1),
      round(median(all.map(a => a.k)), 1), round(group(p, 'sx'), 2), round(group(p, 'sy'), 2)];
  });
  presets[key] = { label: family.label, frames };
  const ious = Array.from({ length: 15 }, (_, p) => median(fits.map(f => f[p].iou)));
  const spread = Array.from({ length: 15 }, (_, p) => { const r = fits.map(f => f[p].params.r); return median(r.map(v => Math.abs(v - median(r)))); });
  console.log(`${family.label}
  IoU      ${ious.map(v => v.toFixed(2)).join(' ')}
  rot MAD° ${spread.map(v => v.toFixed(1).padStart(4)).join(' ')}`);
}
// No native spear or halberd exists, so both derive from measured families. Long weapons
// are held like the staff. A halberd's flat head foreshortens like an axe head, so it takes
// the axe's widths. A spear's round shaft keeps the staff's widths and leans its point a
// little toward the facing direction in the ¾ and side views, ready to thrust.
const SPEAR_LEAN = [0, 4, 6, 4, 0];
presets.spear = { label: 'Spear', frames: presets.staff.frames.map((f, p) => [f[0], f[1], round(f[2] + SPEAR_LEAN[Math.floor(p / 3)], 1), ...f.slice(3)]) };
presets.halberd = { label: 'Halberd / polearm', frames: presets.staff.frames.map((f, p) => [...f.slice(0, 4), presets.axe.frames[p][4], presets.staff.frames[p][5]]) };
const body_ = Object.entries(presets).map(([k, v]) => `  ${k}: { label: ${JSON.stringify(v.label)}, frames: [\n${v.frames.map(f => `    [${f.join(', ')}],`).join('\n')}\n  ] },`).join('\n');
await writeFile('src/weapon-poses.ts', `// Generated by scripts/bake-weapon-poses.ts from the pinned OpenSpell assets. Do not edit by hand.
// Per frame: hand x, hand y, rotation°, skewX°, scaleX, scaleY for an upright side-view source.
export const WEAPON_PRESETS = {
${body_}
} as const;
export type WeaponPreset = keyof typeof WEAPON_PRESETS;
`);
console.log('Wrote src/weapon-poses.ts');
