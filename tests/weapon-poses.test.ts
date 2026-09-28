import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { renderPart, generatePoses, extractStrip } from '../src/artwork';
import { defaultRig } from '../src/model';
import { parseProject } from '../src/project';
import { WEAPON_PRESETS } from '../src/weapon-poses';

(globalThis as any).document = { createElement: () => createCanvas(1, 1) };
const entries = JSON.parse(await readFile('public/game/appearance.carbon', 'utf8'));
const images: Map<string, any> = new Map(await Promise.all(entries.map(async (e: any) => [e.filename, await loadImage(e.data)])));
const alpha = (name: string, id: number) => extractStrip(images.get(name), 15, id).getContext('2d')!.getImageData(0, 0, 960, 128).data;
const body = alpha('body.png', 0), gloves = alpha('gloves1.png', 0), pants = alpha('pants.png', 0);

// Treat a native side view (frame 6) as an upload: stand it upright about the hand,
// generate poses, and score overlap with the real frames. Hidden pixels are ignored.
function nativeMatch(preset: string, sprite: number) {
  const weapon = alpha('weapon1.png', sprite), at = (p: number, x: number, y: number) => (y * 960 + p * 64 + x) * 4 + 3;
  let hx = 0, hy = 0, hn = 0, mx = 0, my = 0, n = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    if (weapon[at(6, x, y)]) { mx += x; my += y; n++; }
    if (body[at(6, x, y)] && gloves[at(6, x, y)] && [-2, -1, 0, 1, 2].some(dx => [-2, -1, 0, 1, 2].some(dy => x + dx >= 0 && x + dx < 64 && y + dy >= 0 && y + dy < 128 && weapon[at(6, x + dx, y + dy)]))) { hx += x + .5; hy += y + .5; hn++; }
  }
  mx /= n; my /= n; hx /= hn; hy /= hn;
  let sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) if (weapon[at(6, x, y)]) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const th = .5 * Math.atan2(2 * sxy, sxx - syy); let ux = Math.cos(th), uy = Math.sin(th); if (uy > 0) { ux = -ux; uy = -uy; }
  const upright = createCanvas(64, 128), ctx = upright.getContext('2d');
  ctx.translate(hx, hy); ctx.rotate(-Math.atan2(ux, -uy)); ctx.translate(-hx, -hy);
  ctx.drawImage(extractStrip(images.get('weapon1.png'), 15, sprite) as any, 6 * 64, 0, 64, 128, 0, 0, 64, 128);
  const out = renderPart({ fileName: 'x', dataUrl: '', mode: 'single', anchor: { x: hx, y: hy }, poses: generatePoses('weapon', { ...defaultRig(), preset }) }, upright as any, 15);
  const o = out.getContext('2d')!.getImageData(0, 0, 960, 128).data;
  let total = 0;
  for (let p = 0; p < 15; p++) {
    let hit = 0, miss = 0, target = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
      const i = at(p, x, y), hidden = (body[i] && gloves[i]) || (p >= 9 && (body[i] || pants[i]));
      if (weapon[i]) target++;
      if (o[i]) { if (weapon[i]) hit++; else if (!hidden) miss++; }
    }
    total += hit / (target + miss);
  }
  return total / 15;
}

test('measured presets reproduce native weapons of each family', () => {
  for (const [preset, sprite] of [['sword', 4], ['axe', 9], ['pickaxe', 10], ['bow', 24], ['staff', 27]] as const) {
    const score = nativeMatch(preset, sprite);
    assert.ok(score > .6, `${preset} matches native frames at mean IoU ${score.toFixed(2)}`);
    for (const other of Object.keys(WEAPON_PRESETS).filter(k => k !== preset && !['spear', 'halberd'].includes(k)))
      assert.ok(nativeMatch(other, sprite) < score, `${preset} sprite fits its own preset better than ${other}`);
  }
});

test('presets cover all 15 frames; rig settings still adjust them', () => {
  for (const preset of Object.values(WEAPON_PRESETS)) assert.equal(preset.frames.length, 15);
  const base = generatePoses('weapon', defaultRig()), moved = generatePoses('weapon', { ...defaultRig(), xOffset: 2, baseRotation: 5, scale: 2 });
  assert.deepEqual(base.map(p => [p.x + 2, p.rotation + 5, p.scaleY * 2]), moved.map(p => [p.x, p.rotation, p.scaleY]));
  const flat = generatePoses('weapon', { ...defaultRig(), preset: 'axe', sideCompression: 0, skewStrength: 0 });
  assert.ok(flat.every(p => p.scaleX === 1 && p.skewX === 0));
});

test('old drafts load retired presets: hand-tuned as sword, polearm as halberd', () => {
  const draft = (preset: string) => JSON.stringify({ version: 3, definition: { _id: 5000, name: 'x', equipmentType: 'weapon', equipmentSpriteSheet: 'weapon1' }, sourceParts: {}, autoRig: { preset } });
  assert.equal(parseProject(draft('reference-held')).autoRig.preset, 'sword');
  assert.equal(parseProject(draft('polearm')).autoRig.preset, 'halberd');
  assert.equal(parseProject(draft('spear')).autoRig.preset, 'spear');
});

test('spear and halberd derive from the staff grip', () => {
  const { staff, axe, spear, halberd } = WEAPON_PRESETS;
  for (let p = 0; p < 15; p++) {
    assert.deepEqual([halberd.frames[p][0], halberd.frames[p][1], halberd.frames[p][2], halberd.frames[p][4]], [staff.frames[p][0], staff.frames[p][1], staff.frames[p][2], axe.frames[p][4]]);
    assert.deepEqual([spear.frames[p][0], spear.frames[p][1], spear.frames[p][4]], [staff.frames[p][0], staff.frames[p][1], staff.frames[p][4]]);
    // The point leans toward the facing direction only in ¾ and side views.
    const lean = spear.frames[p][2] - staff.frames[p][2], view = Math.floor(p / 3);
    assert.ok(view === 0 || view === 4 ? Math.abs(lean) < 1e-9 : lean > 0, `frame ${p} lean ${lean}`);
  }
});
