import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { composeIcon, extractIcon, outlineIcon, writeIcon, closeGripGap, iconFits, iconRows, ICON_ATLAS, OUTLINE_ATLAS } from '../src/icon';
import { iconBundle } from '../src/export';
import { validateItemIcons } from '../src/library';
import { defaultIcon, lowestFreeId, newDefinition, type ItemDef } from '../src/model';
import { parseProject } from '../src/project';

(globalThis as any).document = { createElement: () => createCanvas(1, 1) };
(globalThis as any).Image = (await import('@napi-rs/canvas')).Image;
const entries = validateItemIcons(await readFile('public/game/items.carbon', 'utf8'));
const atlas: any = await loadImage(entries.find(e => e.filename === ICON_ATLAS)!.data);
const outlines: any = await loadImage(entries.find(e => e.filename === OUTLINE_ATLAS)!.data);
const defs: ItemDef[] = JSON.parse(await readFile('public/game/itemdefs.carbon', 'utf8'));
const pixels = (c: any) => Buffer.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);

test('the bundled atlas matches the client: 20 columns, rows sized by definition count', () => {
  assert.equal(atlas.width, 960);
  assert.equal(atlas.height, iconRows(defs.length) * 48);
});

test('generated outlines reproduce the native outline sheet', () => {
  let agree = 0, total = 0;
  for (const d of defs) {
    const mine = pixels(outlineIcon(extractIcon(atlas, d._id))), theirs = pixels(extractIcon(outlines, d._id));
    for (let i = 3; i < mine.length; i += 4) if (mine[i] || theirs[i]) { total++; if (!!mine[i] === !!theirs[i]) agree++; }
  }
  assert.ok(agree / total > .98, `outline agreement ${(agree / total).toFixed(3)}`);
});

test('finished 48×48 icons pass through unchanged; other art is cropped and fitted', () => {
  const sword = extractIcon(atlas, 58);
  assert.equal(Buffer.compare(pixels(composeIcon(sword, { ...defaultIcon('weapon'), rotation: 0 })), pixels(sword)), 0);
  const tiny = createCanvas(64, 128); tiny.getContext('2d').fillStyle = '#c04020'; tiny.getContext('2d').fillRect(30, 60, 10, 5);
  const fitted = pixels(composeIcon(tiny as any, { ...defaultIcon('helmet') }));
  let left = 48, right = -1;
  for (let i = 3; i < fitted.length; i += 4) if (fitted[i]) { const x = (i - 3) / 4 % 48; left = Math.min(left, x); right = Math.max(right, x); }
  assert.equal(right - left + 1, 40, 'small art is enlarged by a whole number (4×) to fill the icon');
  assert.ok(left >= 2 && right <= 45, 'icon keeps a margin');
});

test('writing an icon replaces only its cell and sizes the atlas for the definition count', () => {
  const icon = composeIcon(extractIcon(atlas, 58), { ...defaultIcon('weapon'), rotation: 0 });
  const grown = writeIcon(atlas, icon, 641, 641);
  assert.equal(grown.height, 33 * 48);
  assert.equal(Buffer.compare(pixels(extractIcon(grown, 641)), pixels(icon)), 0);
  assert.equal(Buffer.compare(pixels(extractIcon(grown, 57)), pixels(extractIcon(atlas, 57))), 0);
  assert.throws(() => writeIcon(atlas, icon, 1000, 624), /IDs 1–640/);
});

test('new items take the lowest free ID so their icon cell exists', () => {
  const id = lowestFreeId(defs);
  assert.equal(newDefinition('weapon', defs)._id, id);
  assert.ok(iconFits(id, defs.length + 1));
  assert.equal(lowestFreeId([{ _id: 1, name: 'a' }, { _id: 3, name: 'b' }]), 2);
  assert.ok(!iconFits(1000, defs.length + 1));
});

test('icon bundle updates both atlases and keeps other entries', async () => {
  const icon = composeIcon(extractIcon(atlas, 58), { ...defaultIcon('weapon'), rotation: 0 });
  const updated = await iconBundle(icon, 624, entries, new Map([[ICON_ATLAS, atlas], [OUTLINE_ATLAS, outlines]]), 624);
  assert.deepEqual(updated.map(e => e.filename), entries.map(e => e.filename));
  const [items, outline]: any[] = await Promise.all([ICON_ATLAS, OUTLINE_ATLAS].map(n => loadImage(updated.find(e => e.filename === n)!.data)));
  assert.equal(Buffer.compare(pixels(extractIcon(items, 624)), pixels(icon)), 0);
  assert.equal(Buffer.compare(pixels(extractIcon(outline, 624)), pixels(outlineIcon(icon))), 0);
  assert.equal(Buffer.compare(pixels(extractIcon(items, 1)), pixels(extractIcon(atlas, 1))), 0);
});

test('drafts gain default icon settings and reject invalid ones', () => {
  const draft = (icon?: unknown) => JSON.stringify({ version: 3, definition: { _id: 624, name: 'x', equipmentType: 'weapon', equipmentSpriteSheet: 'weapon1' }, sourceParts: {}, autoRig: {}, icon });
  assert.deepEqual(parseProject(draft()).icon, defaultIcon('weapon'));
  assert.throws(() => parseProject(draft({ source: 'svg' })), /icon/);
  assert.throws(() => parseProject(draft({ scale: 0 })), /Icon size/);
  assert.throws(() => parseProject(draft({ source: 'image', dataUrl: 'https://example.com/x.png' })), /icon/);
});

test('grip holes in finished weapon frames are closed for icons; wide gaps are kept', () => {
  const c = createCanvas(3, 30), ctx = c.getContext('2d');
  ctx.fillStyle = '#804020'; ctx.fillRect(1, 0, 1, 10); ctx.fillRect(1, 15, 1, 15); // 5 px hole
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1, 2); ctx.fillRect(0, 20, 1, 2);    // 18 px gap
  const d = pixels(closeGripGap(c as any));
  const alpha = (x: number, y: number) => d[(y * 3 + x) * 4 + 3];
  for (let y = 10; y < 15; y++) assert.equal(alpha(1, y), 255);
  assert.equal(d[(12 * 3 + 1) * 4], 0x80, 'filled with the handle colour');
  assert.equal(alpha(0, 10), 0);
});
