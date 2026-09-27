import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { scale2x, renderPart, rotspriteSource } from '../src/artwork';
import { defaultPose, type Pose, type SourcePart } from '../src/model';
import { parseProject } from '../src/project';

(globalThis as any).document = { createElement: () => createCanvas(1, 1) };

// Small blade: outline, fill and highlight colours on a diagonal, like typical weapon art.
const COLOURS = ['#202020', '#a0a0b0', '#f0f0ff'];
function blade(size = 24): any {
  const c = createCanvas(size, size), ctx = c.getContext('2d');
  for (let i = 2; i < size - 2; i++) {
    ctx.fillStyle = COLOURS[0]; ctx.fillRect(i - 1, size - i - 2, 3, 3);
    ctx.fillStyle = COLOURS[1]; ctx.fillRect(i, size - i - 1, 1, 1);
    if (i % 4 === 0) { ctx.fillStyle = COLOURS[2]; ctx.fillRect(i, size - i - 1, 1, 1); }
  }
  return c;
}
const pose = (p: Partial<Pose>): Pose => ({ ...defaultPose(), x: 32, y: 64, ...p });
const source = (poses: Pose[], rotationQuality?: 'nearest'): SourcePart =>
  ({ fileName: 'blade.png', dataUrl: '', mode: 'single', anchor: { x: 12, y: 12 }, poses, rotationQuality });
const pixels = (c: any) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data as Uint8ClampedArray;
const hex = (d: Uint8ClampedArray, i: number) => '#' + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('');

test('scale2x closes diagonal gaps and keeps flat areas', () => {
  const X = 0xff0000ff;
  const out = scale2x(new Uint32Array([X, 0, 0, X]), 2, 2);
  // The transparent top-right pixel's bottom-left quarter joins the two diagonal pixels.
  assert.equal(out[1 * 4 + 2], X);
  assert.equal(out[0 * 4 + 3], 0);
  assert.deepEqual([...scale2x(new Uint32Array([X, X, X, X]), 2, 2)], Array(16).fill(X));
});

test('rotsprite rotation invents no colours or partial alpha, and differs from nearest', () => {
  const image = blade(), poses = Array.from({ length: 15 }, (_, i) => pose({ rotation: 7 + i * 11, skewX: i % 3 }));
  const smooth = pixels(renderPart(source(poses), image, 15)), nearest = pixels(renderPart(source(poses, 'nearest'), image, 15));
  for (let i = 0; i < smooth.length; i += 4) {
    assert.ok(smooth[i + 3] === 0 || smooth[i + 3] === 255, 'alpha stays binary');
    if (smooth[i + 3]) assert.ok(COLOURS.includes(hex(smooth, i)), `unexpected colour ${hex(smooth, i)}`);
  }
  assert.notEqual(Buffer.compare(Buffer.from(smooth), Buffer.from(nearest)), 0);
});

test('axis-aligned frames render identically in both modes', () => {
  const image = blade(), poses = Array.from({ length: 15 }, (_, i) => pose({ rotation: [0, 90, 180, -90, 360][i % 5], x: 20 + i }));
  assert.equal(Buffer.compare(Buffer.from(pixels(renderPart(source(poses), image, 15))), Buffer.from(pixels(renderPart(source(poses, 'nearest'), image, 15)))), 0);
});

test('large uploads use a smaller upscale factor; results are cached', () => {
  const big: any = createCanvas(1024, 1024);
  const up = rotspriteSource(big);
  assert.equal(up.factor, 4);
  assert.equal(up.image.width, 4096);
  assert.equal(rotspriteSource(big), up);
  assert.equal(rotspriteSource(blade()).factor, 8);
});

test('drafts keep a valid rotation quality and reject unknown ones', () => {
  const draft = (rotationQuality: unknown) => JSON.stringify({ version: 3, definition: { _id: 5000, name: 'x', equipmentType: 'weapon', equipmentSpriteSheet: 'weapon1' },
    sourceParts: { main: { fileName: 'a.png', dataUrl: 'data:', mode: 'single', anchor: { x: 0, y: 0 }, rotationQuality } }, autoRig: {} });
  assert.equal(parseProject(draft('nearest')).sourceParts.main!.rotationQuality, 'nearest');
  assert.throws(() => parseProject(draft('bilinear')), /rotation quality/);
});
