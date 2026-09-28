import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const defs: any[] = JSON.parse(await readFile('public/game/itemdefs.carbon', 'utf8'));
const customSpear = { ...defs.find(d => d.name === 'bronze longsword'), _id: 624, name: 'custom spear' };

// A checkout like OpenSpell's: base assets, a custom item, and a stale copy in node_modules.
async function checkout() {
  const root = join(await mkdtemp(join(tmpdir(), 'openspell-')), 'my-openspell');
  for (const [dir, custom] of [['apps/shared-assets', true], ['node_modules/old/apps/shared-assets', false]] as const) {
    await mkdir(join(root, dir, 'base/static/carbon'), { recursive: true }); await mkdir(join(root, dir, 'custom/static'), { recursive: true });
    await copyFile('public/game/itemdefs.carbon', join(root, dir, 'base/static/itemdefs.carbon'));
    await copyFile('public/game/appearance.carbon', join(root, dir, 'base/static/carbon/appearance.carbon'));
    await copyFile('public/game/items.carbon', join(root, dir, 'base/static/carbon/items.carbon'));
    await writeFile(join(root, dir, 'custom/static/itemdefs.carbon'), JSON.stringify(custom ? [customSpear] : []));
  }
  return root;
}

test('a connected folder shows what it loaded, lists custom items and moves new IDs past them', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#status')).toContainText('Ready.');
  await expect(page.locator('#libraryChip')).toHaveText('Library: bundled');
  await page.locator('#export').click();
  await expect(page.locator('#exportChecks')).toContainText('uses the bundled game library');
  await page.locator('#closeExport').click();
  await expect(page.locator('#itemId')).toHaveValue('624');

  await page.locator('#folder').setInputFiles(await checkout());
  await expect(page.locator('#status')).toContainText('Connected my-openspell: 1 custom item. Your new item moved from ID 624 to 625.');
  await expect(page.locator('#librarySource')).toHaveText('my-openspell');
  await expect(page.locator('#libraryReport')).toContainText('1 custom item');
  await expect(page.locator('#libraryReport')).toContainText('ignored 4 copies');
  await expect(page.locator('#libraryChip')).toHaveText('Library: my-openspell');
  await expect(page.locator('#itemId')).toHaveValue('625');
  await page.locator('#search').fill('custom spear'); await expect(page.locator('#catalog .item')).toHaveCount(1);
  await page.locator('#export').click();
  await expect(page.locator('#exportChecks')).toContainText('Library: my-openspell (1 custom item)');
  await expect(page.locator('#exportChecks')).not.toContainText('bundled game library');
});

test('a folder that can’t be read says why in the panel and keeps the library', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#status')).toContainText('Ready.');
  const empty = join(await mkdtemp(join(tmpdir(), 'openspell-')), 'nothing-here'); await mkdir(empty); await writeFile(join(empty, 'readme.txt'), 'x');
  await page.locator('#folder').setInputFiles(empty);
  await expect(page.locator('#libraryError')).toBeVisible();
  await expect(page.locator('#libraryError')).toContainText('No appearance.carbon');
  await expect(page.locator('#connection')).toHaveAttribute('open', '');
  await expect(page.locator('#librarySource')).toHaveText('Bundled OpenSpell assets');
});
