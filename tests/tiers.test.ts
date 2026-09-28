import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { applyColorReplacements, extractPalette, lightness, validateColorReplacements } from '../src/palette';
import { NATIVE_TIERS, customTier, detectTier, materialColours, pairedMap, snapToRamp, swapTierWord, tierRule, validateCustomTiers, type Tier } from '../src/tiers';
import { TIER_IDS, TIER_RAMPS } from '../src/tier-palettes';

const load = async (file: string) => new Map<string, any>(await Promise.all(JSON.parse(await readFile(file, 'utf8')).map(async (e: any) => [e.filename, await loadImage(e.data)])));
const appearance = await load('public/game/appearance.carbon'), icons = await load('public/game/items.carbon');
const defs: any[] = JSON.parse(await readFile('public/game/itemdefs.carbon', 'utf8'));
const def = (name: string) => defs.find(d => d.name === name);
function crop(image: any, x: number, y: number, w: number, h: number) { const c = createCanvas(w, h), ctx = c.getContext('2d'); ctx.drawImage(image, x, y, w, h, 0, 0, w, h); return ctx.getImageData(0, 0, w, h).data; }
function strip(atlas: string, frames: number, id: number) {
  const img = appearance.get(atlas), cols = img.width / 64, out = new Uint8ClampedArray(frames * 64 * 128 * 4);
  for (let p = 0; p < frames; p++) { const cell = id * frames + p, frame = crop(img, cell % cols * 64, Math.floor(cell / cols) * 128, 64, 128); for (let y = 0; y < 128; y++) out.set(frame.subarray(y * 256, y * 256 + 256), (y * frames * 64 + p * 64) * 4); }
  return out;
}
const icon = (id: number) => crop(icons.get('items.png'), (id - 1) % 20 * 48, Math.floor((id - 1) / 20) * 48, 48, 48);
const tier = (id: string) => NATIVE_TIERS.find(t => t.id === id)!;
// Recolour `src` to `target` the way the studio does for a clone, and score it against `dst`.
function recolour(src: Uint8ClampedArray, dst: Uint8ClampedArray, from: typeof TIER_IDS[number], target: Tier) {
  const exact = pairedMap(src, dst); assert.ok(exact, 'siblings share a silhouette');
  const palette = extractPalette(src, 256), material = palette.filter(c => exact.has(c.hex) || materialColours([c], from).length);
  const out = new Uint8ClampedArray(src), rule = tierRule(material, target, exact);
  if (rule) applyColorReplacements(out, [rule]);
  let same = 0, n = 0;
  for (let i = 0; i < out.length; i += 4) if (out[i + 3] || dst[i + 3]) { n++; if (out[i] === dst[i] && out[i + 1] === dst[i + 1] && out[i + 2] === dst[i + 2] && out[i + 3] === dst[i + 3]) same++; }
  return same / n;
}

test('cloning a native tier item reproduces its native siblings in every tier', () => {
  for (const family of ['longsword', 'battleaxe', 'shield', 'gloves']) for (const to of ['iron', 'steel', 'palladium', 'coronium', 'celadon', 'legendary']) {
    const a = def(`bronze ${family}`), b = def(`${to} ${family}`), atlas = { weapon: 'weapon1.png', shield: 'shield_front1.png', gloves: 'gloves1.png' }[a.equipmentType as string]!;
    const score = recolour(strip(atlas, 15, a.equipmentSpriteId), strip(atlas, 15, b.equipmentSpriteId), 'bronze', tier(to));
    assert.ok(score >= 0.99, `bronze ${family} → ${to}: ${(score * 100).toFixed(1)}% of pixels match`);
  }
});

test('inventory icons recolour to the native tier icon', () => {
  for (const to of ['iron', 'steel', 'palladium', 'coronium', 'celadon']) {
    const score = recolour(icon(def('bronze longsword')._id), icon(def(`${to} longsword`)._id), 'bronze', tier(to));
    assert.ok(score >= 0.99, `longsword icon → ${to}: ${(score * 100).toFixed(1)}%`);
  }
});

test('native tier material is recognised from the art', () => {
  for (const [name, atlas] of [['bronze longsword', 'weapon1.png'], ['steel battleaxe', 'weapon1.png'], ['celadon chestplate', 'chest1.png'], ['palladium chestplate', 'chest1.png']]) {
    const palette = extractPalette(strip(atlas, 15, def(name).equipmentSpriteId), 256);
    assert.equal(detectTier(palette), name.split(' ')[0], name);
  }
  assert.equal(detectTier([{ hex: '#ddcc88', count: 400 }, { hex: '#3f3f3f', count: 30 }]), undefined);
});

test('canonical ramps are native colours ordered dark to light', () => {
  for (const id of TIER_IDS) {
    const ramp = TIER_RAMPS[id];
    assert.ok(ramp.length >= 5, `${id} ramp has ${ramp.length} shades`);
    for (let i = 1; i < ramp.length; i++) assert.ok(lightness(ramp[i]) > lightness(ramp[i - 1]), `${id} ramp is ordered`);
  }
});

test('snapping keeps shading order and uses only the tier palette', () => {
  const colours = ['#202a30', '#3a4a55', '#58707f', '#8fa9b8', '#c7dbe6'].map((hex, i) => ({ hex, count: 10 + i }));
  for (const t of NATIVE_TIERS) {
    const out = snapToRamp(colours, t.ramp);
    assert.ok(out.every(c => t.ramp.includes(c)), `${t.id} output stays in its ramp`);
    for (let i = 1; i < out.length; i++) assert.ok(lightness(out[i]) >= lightness(out[i - 1]), `${t.id} keeps order`);
  }
  // Every new item made in a tier uses the same shades: two different artworks share the ramp.
  const other = snapToRamp([{ hex: '#554433', count: 5 }, { hex: '#998877', count: 5 }], tier('steel').ramp);
  assert.ok(other.every(c => tier('steel').ramp.includes(c)));
});

test('tier rules are exact palette maps that survive draft validation', () => {
  const rule = tierRule([{ hex: '#808080', count: 4 }, { hex: '#404040', count: 2 }], tier('bronze'))!;
  assert.equal(rule.tier, 'bronze'); assert.equal(rule.map!.length, 2);
  assert.deepEqual(validateColorReplacements([rule]), [rule]);
  const pixels = new Uint8ClampedArray([128, 128, 128, 255, 64, 64, 64, 90, 1, 2, 3, 255]);
  applyColorReplacements(pixels, [rule]);
  const hex = (i: number) => `#${[0, 1, 2].map(c => pixels[i + c].toString(16).padStart(2, '0')).join('')}`;
  assert.deepEqual([hex(0), hex(4)], rule.map); assert.equal(pixels[7], 90); assert.deepEqual([...pixels.slice(8)], [1, 2, 3, 255]);
  assert.throws(() => validateColorReplacements([{ ...rule, map: ['#000000'] }]), /palette map/);
  assert.equal(tierRule([], tier('iron')), undefined);
});

test('custom tiers reshade onto their colour and validate', () => {
  const [t] = validateCustomTiers([{ id: 'mithril', label: 'Mithril', base: '#5A8FD0', reshade: 40 }]);
  assert.equal(t.base, '#5a8fd0');
  const custom = customTier(t), rule = tierRule([{ hex: '#606060', count: 5 }, { hex: '#909090', count: 5 }], custom)!;
  assert.ok(lightness(rule.map![0]) < lightness(rule.map![1]));
  assert.ok(custom.ramp.length >= 5);
  for (const bad of [[{ id: 'iron', label: 'x', base: '#000000', reshade: 1 }], [{ id: 'x', label: '', base: '#000000', reshade: 1 }], [{ id: 'x', label: 'x', base: 'red', reshade: 1 }]]) assert.throws(() => validateCustomTiers(bad));
});

test('tier words swap in item names', () => {
  assert.equal(swapTierWord('bronze spear', tier('iron')), 'iron spear');
  assert.equal(swapTierWord('Celadon halberd', tier('legendary')), 'legendary halberd');
  assert.equal(swapTierWord('spear', tier('steel')), 'steel spear');
  const mithril = customTier({ id: 'mithril', label: 'Mithril', base: '#5a8fd0', reshade: 40 });
  assert.equal(swapTierWord('mithril spear', tier('gold'), [...NATIVE_TIERS, mithril]), 'gold spear');
});
