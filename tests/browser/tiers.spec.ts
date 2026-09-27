import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { TIER_IDS, TIER_RAMPS } from '../../src/tier-palettes';

const defs: any[] = JSON.parse(await readFile('public/game/itemdefs.carbon', 'utf8'));
const appearance = JSON.parse(await readFile('public/game/appearance.carbon', 'utf8'));
const itemIcons = JSON.parse(await readFile('public/game/items.carbon', 'utf8'));
const def = (name: string) => defs.find(d => d.name === name);
async function nativeStrip(id: number) {
  const atlas = await loadImage(appearance.find((e: any) => e.filename === 'weapon1.png').data), c = createCanvas(960, 128), ctx = c.getContext('2d');
  for (let p = 0; p < 15; p++) { const cell = id * 15 + p, cols = atlas.width / 64; ctx.drawImage(atlas, cell % cols * 64, Math.floor(cell / cols) * 128, 64, 128, p * 64, 0, 64, 128); }
  return ctx.getImageData(0, 0, 960, 128).data;
}
async function nativeIcon(id: number) {
  const atlas = await loadImage(itemIcons.find((e: any) => e.filename === 'items.png').data), c = createCanvas(48, 48);
  c.getContext('2d').drawImage(atlas, (id - 1) % 20 * 48, Math.floor((id - 1) / 20) * 48, 48, 48, 0, 0, 48, 48);
  return c.getContext('2d').getImageData(0, 0, 48, 48).data;
}
const pixels = async (buffer: Buffer) => { const img = await loadImage(buffer), c = createCanvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
function unzip(bytes: Buffer) {
  const result = new Map<string, Buffer>(); let p = 0;
  while (bytes.readUInt32LE(p) === 0x04034b50) { const method = bytes.readUInt16LE(p + 8), size = bytes.readUInt32LE(p + 18), n = bytes.readUInt16LE(p + 26), extra = bytes.readUInt16LE(p + 28); const name = bytes.subarray(p + 30, p + 30 + n).toString(); const start = p + 30 + n + extra; const data = bytes.subarray(start, start + size); result.set(name, method === 8 ? inflateRawSync(data) : data); p = start + size; }
  return result;
}
const downloaded = async (page: Page, click: () => Promise<void>) => { const event = page.waitForEvent('download'); await click(); return readFile((await (await event).path())!); };
const hex = (d: Uint8ClampedArray, i: number) => `#${[0, 1, 2].map(c => d[i + c].toString(16).padStart(2, '0')).join('')}`;
async function start(page: Page) { await page.goto('/'); await expect(page.locator('#status')).toContainText('Ready.'); }
async function cloneBronzeLongsword(page: Page) {
  await page.locator('#search').fill('bronze longsword'); await page.locator('#catalog .item').click();
  await page.locator('#bannerClone').click(); await expect(page.locator('#status')).toContainText('bronze material is ready');
  await page.locator('#coloursTab').click();
}

test('a cloned tier item recolours to the game’s own art in any tier, icon included', async ({ page }) => {
  await start(page); await cloneBronzeLongsword(page);
  await expect(page.locator('#tierNote')).toContainText('drawn as Bronze');
  await expect(page.locator('#tierGrid .tier-card')).toHaveCount(TIER_IDS.length);
  await expect(page.locator('[data-tier=bronze]')).toHaveClass(/selected/);
  await page.locator('[data-tier=iron]').click();
  await expect(page.locator('#name')).toHaveValue('iron longsword copy');
  const layer = await pixels(await downloaded(page, () => page.locator('#layerExport').click()));
  expect(Buffer.from(layer)).toEqual(Buffer.from(await nativeStrip(def('iron longsword').equipmentSpriteId)));
  await page.locator('#iconTab').click();
  const icon = await page.locator('#iconPreview').evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(0, 0, 48, 48).data));
  const native = await nativeIcon(def('iron longsword')._id);
  let same = 0; for (let i = 0; i < native.length; i += 4) if (icon[i + 3] === native[i + 3] && (!native[i + 3] || hex(new Uint8ClampedArray(icon), i) === hex(native, i))) same++;
  expect(same / (native.length / 4)).toBeGreaterThan(0.99);
  // Undo goes back to bronze; the draft remembers the material and the shown tier.
  await page.keyboard.press('Control+z'); await expect(page.locator('#name')).toHaveValue('bronze longsword copy');
  await page.locator('#coloursTab').click(); await page.locator('[data-tier=celadon]').click();
  const saved = JSON.parse((await downloaded(page, () => page.locator('#save').click())).toString());
  expect(saved.material.from).toBe('bronze'); expect(saved.material.tier).toBe('celadon');
  expect(saved.sourceParts.main.replacements.find((r: any) => r.tier === 'celadon').map.length).toBeGreaterThan(0);
  expect(saved.icon.tierRule.tier).toBe('celadon');
});

test('duplicate as tier makes a new draft; every tier downloads as PNGs and drafts', async ({ page }) => {
  await start(page); await cloneBronzeLongsword(page);
  const first = Number(await page.locator('#itemId').inputValue());
  await page.locator('#duplicateTier').selectOption('steel'); await page.locator('#duplicate').click();
  await expect(page.locator('#name')).toHaveValue('steel longsword copy');
  await expect(page.locator('#operationLabel')).toContainText('Clone of #58');
  const second = Number(await page.locator('#itemId').inputValue());
  expect(second).not.toBe(first); expect(defs.some(d => d._id === second)).toBe(false);
  await expect(page.locator('#status')).toContainText('one Undo away');
  const zip = unzip(await downloaded(page, () => page.locator('#tierZip').click()));
  for (const tier of TIER_IDS) for (const file of ['layers/main.png', 'icon.png', 'project-v3.json']) expect(zip.has(`${tier}/${file}`), `${tier}/${file}`).toBe(true);
  expect(Buffer.from(await pixels(zip.get('palladium/layers/main.png')!))).toEqual(Buffer.from(await nativeStrip(def('palladium longsword').equipmentSpriteId)));
  const ids = TIER_IDS.map(t => JSON.parse(zip.get(`${t}/project-v3.json`)!.toString()).definition._id);
  expect(new Set([...ids, second]).size).toBe(ids.length + 1);
  // A downloaded variant reopens as an ordinary draft.
  await page.locator('#projectFile').setInputFiles({ name: 'gold.json', mimeType: 'application/json', buffer: zip.get('gold/project-v3.json')! });
  await expect(page.locator('#status')).toContainText('Draft loaded'); await expect(page.locator('#name')).toHaveValue('gold longsword copy');
});

test('new art: mark the material, snap to a tier ramp, and add a custom tier', async ({ page }) => {
  await start(page);
  const art = createCanvas(9, 60), ctx = art.getContext('2d');
  ctx.fillStyle = '#6b4a2b'; ctx.fillRect(3, 14, 3, 46);
  for (const [i, c] of ['#404850', '#707a86', '#a4aebb'].entries()) { ctx.fillStyle = c; ctx.fillRect(2 + i * 2, 0, 2, 14); }
  await page.locator('#pngFile').setInputFiles({ name: 'spear.png', mimeType: 'image/png', buffer: art.toBuffer('image/png') });
  await page.locator('#rigPreset').selectOption('spear'); await expect(page.locator('#name')).toHaveValue('New spear');
  await page.locator('#generate').click(); await page.locator('#coloursTab').click();
  await expect(page.locator('#tierNote')).toContainText('Choose the material first');
  // The metal is the three blue-grey shades; the wood stays wood.
  const metal = page.getByRole('button', { name: /^Mark #(404850|707a86|a4aebb) group as material$/ });
  while (await metal.count()) await metal.first().click();
  await page.locator('[data-tier=gold]').click();
  const layer = await pixels(await downloaded(page, () => page.locator('#layerExport').click()));
  // Opaque pixels only: rotated frames have a few soft edge pixels from the renderer itself.
  const colours = new Set<string>(); for (let i = 0; i < layer.length; i += 4) if (layer[i + 3] === 255) colours.add(hex(layer, i));
  expect([...colours].filter(c => c !== '#6b4a2b' && !TIER_RAMPS.gold.includes(c))).toEqual([]);
  expect(colours.has('#6b4a2b')).toBe(true);
  await page.locator('#customTiers summary').click();
  await page.locator('#customName').fill('Mithril'); await page.locator('#customBase').fill('#5a8fd0'); await page.locator('#addCustomTier').click();
  await page.locator('[data-tier=mithril]').click(); await expect(page.locator('#status')).toContainText('Mithril colours applied');
  const saved = JSON.parse((await downloaded(page, () => page.locator('#save').click())).toString());
  expect(saved.customTiers).toEqual([{ id: 'mithril', label: 'Mithril', base: '#5a8fd0', reshade: 40 }]);
  expect(saved.material.tier).toBe('mithril');
});

test('keyboard nudges and undo; old polearm drafts open with the halberd grip', async ({ page }) => {
  await start(page);
  await page.locator('#pngFile').setInputFiles({ name: 'bar.png', mimeType: 'image/png', buffer: (() => { const c = createCanvas(6, 40); c.getContext('2d').fillStyle = '#aa3344'; c.getContext('2d').fillRect(0, 0, 6, 40); return c.toBuffer('image/png'); })() });
  const x = Number(await page.locator('#pose-x').inputValue());
  await page.locator('#preview').click(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('#pose-x')).toHaveValue(String(Math.round((x + 1) * 100) / 100));
  await page.keyboard.press(']'); await expect(page.locator('#pose-rotation')).toHaveValue('5');
  await page.keyboard.press('Control+z'); await expect(page.locator('#pose-rotation')).toHaveValue('0');
  const draft = JSON.parse((await downloaded(page, () => page.locator('#save').click())).toString());
  draft.autoRig.preset = 'polearm';
  await page.locator('#projectFile').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await expect(page.locator('#status')).toContainText('Draft loaded'); await expect(page.locator('#rigPreset')).toHaveValue('halberd');
});
