import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage, Image } from '@napi-rs/canvas';
import { buildWeaponCutouts } from '../src/occlusion';
import { canvas, extractStrip, renderPart } from '../src/artwork';
import { defaultPose, defaultRig, type Project, type SourcePart } from '../src/model';
import { nativeBundle } from '../src/export';
import { clientLayers, renderClientPose } from '../src/compositor';

(globalThis as any).document = { createElement: () => createCanvas(1, 1) };
(globalThis as any).Image = Image;

const pixelData = (c: any) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
const png = (c: any) => c.toDataURL('image/png');

test('cuts hands and rear body gaps from the supplied finished weapon strip and exports the corrected pixels', async () => {
  const fixtureBytes = await readFile('tests/fixtures/uploaded-weapon-strip.png');
  const fixtureUrl = `data:image/png;base64,${fixtureBytes.toString('base64')}`;
  const uploaded = await loadImage(fixtureUrl);
  assert.equal(uploaded.width, 960); assert.equal(uploaded.height, 128);

  const entries = JSON.parse(await readFile('public/game/appearance.carbon', 'utf8'));
  const defs = JSON.parse(await readFile('public/game/itemdefs.carbon', 'utf8'));
  const images: Map<string, any> = new Map(await Promise.all(entries.map(async (e: any) => [e.filename, await loadImage(e.data)])));
  const masks = buildWeaponCutouts(images, 4);
  const settings = { mode: 'hands-body' as const, hands: png(masks.hands), rear: png(masks.rear) };
  const source: SourcePart = {
    fileName: 'uploaded-weapon-strip.png', dataUrl: fixtureUrl, mode: 'strip', anchor: { x: 0, y: 0 },
    poses: Array.from({ length: 15 }, defaultPose), cutout: settings,
  };
  const originalStrip = canvas(960); originalStrip.getContext('2d')!.drawImage(uploaded as any, 0, 0);
  const originalPixels = pixelData(originalStrip);
  const corrected = renderPart(source, uploaded as any, 15, masks);
  const actualPixels = pixelData(corrected), handPixels = pixelData(masks.hands), rearPixels = pixelData(masks.rear);
  let handRemoved = 0, rearRemoved = 0;
  for (let p = 0; p < 15; p++) {
    let handSourcePixels = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 960 + p * 64 + x) * 4;
      if (handPixels[i + 3] && originalPixels[i + 3]) handSourcePixels++;
      if (handPixels[i + 3] && originalPixels[i + 3] && actualPixels[i + 3] === 0) handRemoved++;
      if (p >= 9 && rearPixels[i + 3] && originalPixels[i + 3] && actualPixels[i + 3] === 0) rearRemoved++;
      if (handPixels[i + 3] && originalPixels[i + 3]) assert.equal(actualPixels[i + 3], 0, `hand overlap must be transparent in pose ${p}`);
      if (p >= 9 && rearPixels[i + 3] && originalPixels[i + 3]) assert.equal(actualPixels[i + 3], 0, `rear body overlap must be transparent in pose ${p}`);
    }
    assert.ok(handSourcePixels > 0, `uploaded strip has artwork under the hand mask in pose ${p}`);
  }
  assert.ok(handRemoved > 0, 'hands are cleared from uploaded pixels');
  assert.ok(rearRemoved > 0, 'rear body overlap is cleared from rear views');
  assert.deepEqual(Buffer.from(fixtureBytes), await readFile('tests/fixtures/uploaded-weapon-strip.png'), 'the original fixture stays untouched');
  assert.equal(source.dataUrl, fixtureUrl);

  const project: Project = {
    version: 3,
    definition: { _id: 1000, name: 'Uploaded strip regression', equipmentType: 'weapon', equipmentSpriteId: 0, equipmentSpriteSheet: 'weapon1' },
    sourceParts: { main: source }, replaceExisting: true, autoRig: defaultRig(),
  };
  const exported = await nativeBundle(project, new Map([['main', corrected]]), entries, images, defs);
  const sheet = await loadImage(exported.entries.find((e: any) => e.filename === 'weapon1.png')!.data);
  const decoded = extractStrip(sheet as any, 15, exported.definition.equipmentSpriteId!);
  assert.deepEqual(pixelData(decoded), actualPixels, 'native export decodes to the same corrected strip pixels');

  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/main-cutout.png', Buffer.from(corrected.toBuffer('image/png')));

  const comparison = createCanvas(960, 256), ctx = comparison.getContext('2d'), frame = canvas(64);
  for (let row = 0; row < 2; row++) for (let p = 0; p < 15; p++) {
    renderClientPose(frame.getContext('2d')!, p, clientLayers({ weapon: project.definition }), images,
      layer => layer.slot === 'weapon' ? (row ? corrected : originalStrip) : undefined);
    ctx.drawImage(frame as any, p * 64, row * 128);
  }
  const zoom = createCanvas(1920, 512), zctx = zoom.getContext('2d');
  zctx.fillStyle = '#263c30'; zctx.fillRect(0, 0, 1920, 512); zctx.imageSmoothingEnabled = false;
  zctx.drawImage(comparison as any, 0, 0, 1920, 512);
  await writeFile('artifacts/uploaded-cutout-comparison.png', zoom.toBuffer('image/png'));
});
