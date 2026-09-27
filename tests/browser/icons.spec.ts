import { test, expect, type Page } from '@playwright/test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { WEAPON_PRESETS } from '../../src/weapon-poses';

function unzip(bytes: Buffer) {
  const result = new Map<string, Buffer>(); let p = 0;
  while (bytes.readUInt32LE(p) === 0x04034b50) { const method = bytes.readUInt16LE(p + 8), size = bytes.readUInt32LE(p + 18), n = bytes.readUInt16LE(p + 26), extra = bytes.readUInt16LE(p + 28); const name = bytes.subarray(p + 30, p + 30 + n).toString(); const start = p + 30 + n + extra; const data = bytes.subarray(start, start + size); result.set(name, method === 8 ? inflateRawSync(data) : data); p = start + size; }
  return result;
}
const pixels = async (source: Buffer | string, x = 0, y = 0, w?: number, h?: number) => {
  const image = await loadImage(source), c = createCanvas(w ?? image.width, h ?? image.height);
  c.getContext('2d').drawImage(image, -x, -y); return Buffer.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
};
const preview = (page: Page) => page.evaluate(() => Array.from((document.getElementById('iconPreview') as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 48, 48).data));
const blade = createCanvas(9, 40); { const c = blade.getContext('2d'); c.fillStyle = '#1a1a1a'; c.fillRect(2, 0, 5, 30); c.fillStyle = '#c8c8d8'; c.fillRect(3, 1, 3, 28); c.fillStyle = '#7a4a20'; c.fillRect(3, 30, 3, 10); }
async function start(page: Page) { await page.goto('/'); await expect(page.locator('#status')).toContainText('Ready.'); }
async function nativeExport(page: Page) { await page.locator('#export').click(); const download = page.waitForEvent('download'); await page.locator('#native').click(); return unzip(await readFile((await (await download).path())!)); }

test('a new upload gets the lowest free ID and a generated icon written into the native icon bundle', async ({ page }) => {
  await start(page);
  await page.locator('#pngFile').setInputFiles({ name: 'blade.png', mimeType: 'image/png', buffer: blade.toBuffer('image/png') });
  await expect(page.locator('#operationLabel')).toHaveText('New item #624');
  await page.locator('#iconTab').click(); await expect(page.locator('#iconNote')).toContainText('Cell 623 of items.png');
  expect((await preview(page)).some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  const zip = await nativeExport(page);
  const icon = zip.get('icon/icon.png')!, outline = zip.get('icon/icon_outline.png')!, bundle = JSON.parse(zip.get('carbon/items.carbon')!.toString());
  const atlas = bundle.find((e: any) => e.filename === 'items.png').data, outlines = bundle.find((e: any) => e.filename === 'items_outline.png').data;
  expect((await loadImage(atlas)).height).toBe(32 * 48);
  const cell = [623 % 20 * 48, Math.floor(623 / 20) * 48, 48, 48] as const;
  expect(Buffer.compare(await pixels(atlas, ...cell), await pixels(icon))).toBe(0);
  expect(Buffer.compare(await pixels(outlines, ...cell), await pixels(outline))).toBe(0);
  expect(JSON.parse(zip.get('manifest.json')!.toString()).icon.cell).toBe(623);
});

test('a clone starts from the game icon, follows colour changes, and IDs without an icon cell are refused', async ({ page }) => {
  await start(page);
  await page.locator('#search').fill('bronze longsword'); await page.locator('#catalog .item').click(); await page.locator('#clone').click();
  await page.locator('#iconTab').click(); await expect(page.locator('#iconGame')).toBeVisible(); await expect(page.locator('#iconSource')).toHaveValue('image');
  const original = await preview(page);
  await page.locator('#coloursTab').click(); await page.locator('.group-pick').first().click();
  await expect(page.locator('#applyColour')).toContainText('Recolour'); await page.locator('#replaceTo').fill('#20e040'); await page.locator('#applyColour').click();
  const rule = (await page.evaluate(() => document.querySelector('#colourRules small')?.textContent)) || ''; expect(rule).toMatch(/shades → #20e040/);
  await page.locator('#iconTab').click(); const recoloured = await preview(page);
  expect(recoloured).not.toEqual(original);
  await page.locator('#iconRecolour').uncheck(); expect(await preview(page)).toEqual(original);
  await page.locator('#settingsTab').click(); await page.locator('#itemId').fill('1000'); await page.locator('#itemId').press('Tab');
  await page.locator('#iconTab').click(); await expect(page.locator('#iconNote')).toContainText('can’t show an icon'); await expect(page.locator('#iconNote')).toHaveClass(/error/);
  await page.locator('#export').click(); await page.locator('#native').click();
  await expect(page.locator('#status')).toContainText('Use ID 624');
});

test('grip style picks the measured preset used by generation', async ({ page }) => {
  await start(page);
  await page.locator('#pngFile').setInputFiles({ name: 'blade.png', mimeType: 'image/png', buffer: blade.toBuffer('image/png') });
  await expect(page.locator('#presetControl')).toBeVisible();
  await page.locator('#rigPreset').selectOption('staff'); await page.locator('#generate').click();
  const [x, y, rotation] = WEAPON_PRESETS.staff.frames[0];
  await expect(page.locator('#pose-x')).toHaveValue(String(x)); await expect(page.locator('#pose-y')).toHaveValue(String(y)); await expect(page.locator('#pose-rotation')).toHaveValue(String(rotation));
  await page.locator('#type').selectOption('shield'); await expect(page.locator('#presetControl')).toBeHidden();
});
