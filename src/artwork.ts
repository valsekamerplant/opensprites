import { W, H, POSES, type SourcePart, type Pose, type Rig, type EquipmentType, defaultPose } from './model';
import { canvasDataUrl } from './carbon';
import type { CutoutImages } from './occlusion';
import { applyColorReplacements, applyTint } from './palette';
import { WEAPON_PRESETS, type WeaponPreset } from './weapon-poses';

export function canvas(width: number, height = H): HTMLCanvasElement {
  const result = document.createElement('canvas'); result.width = width; result.height = height; return result;
}
export function extractStrip(image: HTMLImageElement, frames: number, sprite: number): HTMLCanvasElement {
  if (!Number.isInteger(sprite) || sprite < 0 || image.width % W || image.height % H) throw new Error('Choose a valid sprite ID in an atlas with 64×128 cells.');
  const cols = image.width / W, start = sprite * frames;
  if (start + frames > cols * image.height / H) throw new Error(`Sprite ${sprite} does not have ${frames} complete cells in this atlas.`);
  const result = canvas(frames * W), ctx = result.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < frames; i++) {
    const cell = start + i;
    ctx.drawImage(image, cell % cols * W, Math.floor(cell / cols) * H, W, H, i * W, 0, W, H);
  }
  return result;
}
export function transform(ctx: CanvasRenderingContext2D, p: Pose) {
  ctx.translate(p.x, p.y); ctx.rotate(p.rotation * Math.PI / 180);
  ctx.transform(1, Math.tan(p.skewY * Math.PI / 180), Math.tan(p.skewX * Math.PI / 180), 1, 0, 0);
  ctx.scale(p.scaleX * (p.flipX ? -1 : 1), p.scaleY);
}
export type Artwork = HTMLImageElement | HTMLCanvasElement;
// Scale2x (EPX): doubles pixel art, rounding staircase diagonals without inventing colours.
// Pixels are packed RGBA; out-of-bounds neighbours repeat the edge pixel.
export function scale2x(src: Uint32Array, w: number, h: number): Uint32Array {
  const out = new Uint32Array(w * h * 4), ow = w * 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = src[y * w + x];
    const a = y > 0 ? src[(y - 1) * w + x] : p, d = y < h - 1 ? src[(y + 1) * w + x] : p;
    const c = x > 0 ? src[y * w + x - 1] : p, b = x < w - 1 ? src[y * w + x + 1] : p;
    const o = y * 2 * ow + x * 2;
    out[o] = c === a && c !== d && a !== b ? a : p;
    out[o + 1] = a === b && a !== c && b !== d ? b : p;
    out[o + ow] = d === c && d !== b && c !== a ? c : p;
    out[o + ow + 1] = b === d && b !== a && d !== c ? d : p;
  }
  return out;
}
const ROTSPRITE_SCALE = 8, MAX_UPSCALED_PIXELS = 1 << 24;
const upscaledCache = new WeakMap<Artwork, { image: HTMLCanvasElement; factor: number }>();
// RotSprite as in Aseprite: Scale2x three times, then the caller draws the result at
// 1/factor with nearest sampling. Large uploads use a smaller factor to bound memory.
export function rotspriteSource(image: Artwork) {
  const cached = upscaledCache.get(image);
  if (cached) return cached;
  let factor = ROTSPRITE_SCALE;
  while (factor > 1 && image.width * image.height * factor * factor > MAX_UPSCALED_PIXELS) factor /= 2;
  let w = image.width, h = image.height;
  const flat = canvas(w, h), flatCtx = flat.getContext('2d')!;
  flatCtx.drawImage(image, 0, 0);
  let pixels: Uint32Array = new Uint32Array(flatCtx.getImageData(0, 0, w, h).data.slice().buffer);
  const view = new Uint8Array(pixels.buffer);
  for (let i = 0; i < pixels.length; i++) if (view[i * 4 + 3] === 0) pixels[i] = 0; // hidden RGB must not split edges
  for (let f = 1; f < factor; f *= 2) { pixels = scale2x(pixels, w, h); w *= 2; h *= 2; }
  const result = canvas(w, h), ctx = result.getContext('2d')!, data = ctx.createImageData(w, h);
  data.data.set(new Uint8Array(pixels.buffer)); ctx.putImageData(data, 0, 0);
  const entry = { image: result, factor };
  upscaledCache.set(image, entry);
  return entry;
}
export function tintCanvas(target: HTMLCanvasElement, tint: string) {
  const ctx = target.getContext('2d')!, data = ctx.getImageData(0, 0, target.width, target.height);
  applyTint(data.data, tint); ctx.putImageData(data, 0, 0);
}
// Rotate about the centre into a canvas large enough for any angle, using RotSprite
// when the angle is not a right angle.
export function rotateArt(image: Artwork, degrees: number): HTMLCanvasElement {
  const size = Math.ceil(Math.hypot(image.width, image.height)) + 2, result = canvas(size, size), ctx = result.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(size / 2, size / 2); ctx.rotate(degrees * Math.PI / 180);
  if (degrees % 90) { const up = rotspriteSource(image); ctx.scale(1 / up.factor, 1 / up.factor); ctx.drawImage(up.image, -image.width * up.factor / 2, -image.height * up.factor / 2); }
  else ctx.drawImage(image, -image.width / 2, -image.height / 2);
  return result;
}
const colouredCache = new WeakMap<Artwork, { key: string; image: HTMLCanvasElement }>();
export function colouredArtwork(image: Artwork, replacements: SourcePart['replacements']): Artwork {
  const active = replacements?.filter(r => r.enabled !== false);
  if (!active?.length) return image;
  const key = JSON.stringify(active), cached = colouredCache.get(image);
  if (cached?.key === key) return cached.image;
  const coloured = canvas(image.width, image.height), ctx = coloured.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  applyColorReplacements(data.data, active);
  ctx.putImageData(data, 0, 0);
  colouredCache.set(image, { key, image: coloured });
  return coloured;
}
const axisAligned = (p: Pose) => p.rotation % 90 === 0 && !p.skewX && !p.skewY;
export function renderPart(source: SourcePart, image: HTMLImageElement, frames: number, cutouts?: CutoutImages): HTMLCanvasElement {
  if (source.requiresDirections) throw new Error('Choose the five directional frames from this legacy 15-frame project before exporting.');
  const artwork = colouredArtwork(image, source.replacements);
  const result = canvas(frames * W), ctx = result.getContext('2d')!;
  for (let i = 0; i < frames; i++) {
    const p = source.poses?.[frames === 5 ? i * 3 : i];
    if (p && !p.visible) continue;
    const smooth = !!p && source.rotationQuality !== 'nearest' && !axisAligned(p) ? rotspriteSource(artwork) : undefined;
    ctx.save(); ctx.translate(i * W, 0); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    if (source.mode === 'strip') {
      let frame = i;
      if (image.width === 960 && frames === 5) {
        if (!source.legacyFrames || source.legacyFrames.length !== 5) throw new Error('Choose the five directional frames from this legacy 15-frame strip before exporting.');
        frame = source.legacyFrames[i];
      } else if (image.width !== frames * W || image.height !== H) throw new Error(`This layer needs a ${frames * W}×128 strip. Switch to Single sprite for other image sizes.`);
      if (p) { ctx.translate(source.anchor.x, source.anchor.y); transform(ctx, p); ctx.translate(-source.anchor.x, -source.anchor.y); }
      if (smooth) ctx.drawImage(smooth.image, frame * W * smooth.factor, 0, W * smooth.factor, H * smooth.factor, 0, 0, W, H);
      else ctx.drawImage(artwork, frame * W, 0, W, H, 0, 0, W, H);
    } else {
      transform(ctx, p ?? defaultPose());
      if (smooth) { ctx.scale(1 / smooth.factor, 1 / smooth.factor); ctx.drawImage(smooth.image, -source.anchor.x * smooth.factor, -source.anchor.y * smooth.factor); }
      else ctx.drawImage(artwork, -source.anchor.x, -source.anchor.y);
    }
    ctx.restore();
  }
  if (source.tint) tintCanvas(result, source.tint);
  if (source.cutout && source.cutout.mode !== 'none') {
    if (frames !== 15 || !cutouts) throw new Error('Weapon cutout masks are missing. Reload the draft or turn automatic cutouts off.');
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(cutouts.hands, 0, 0);
    if (source.cutout.mode === 'hands-body') ctx.drawImage(cutouts.rear, 0, 0);
    ctx.restore();
  }
  return result;
}
export const weaponPreset = (preset: string): WeaponPreset => preset in WEAPON_PRESETS ? preset as WeaponPreset : 'sword';
// Weapons use poses measured from native art (scripts/bake-weapon-poses.ts) for an upright
// side-view source gripped at its anchor. Defaults reproduce the measurement exactly.
export function generatePoses(type: EquipmentType, settings: Rig): Pose[] {
  return Array.from({ length: POSES }, (_, i) => {
    const [x, y, rotation, skew, scale, scaleY]: readonly number[] = type === 'weapon' ? WEAPON_PRESETS[weaponPreset(settings.preset)].frames[i]
      : type === 'helmet' ? [32,20,0,0,1,1] : type === 'shield' ? [46,70,0,[0,.4,1,-.4,0][Math.floor(i/3)]*8,[1,.7,.12,.7,1][Math.floor(i/3)],1] : [32,62,0,0,1,1];
    return { ...defaultPose(), x: x + settings.xOffset, y: y + settings.yOffset, rotation: rotation + settings.baseRotation, skewX: skew * settings.skewStrength / 8, scaleX: Math.max(.05, 1 - (1 - scale) * settings.sideCompression / 30) * settings.scale, scaleY: scaleY * settings.scale };
  });
}
// Fit a rigid shield to measured native frame silhouettes. This supplies placement,
// side compression and blank-cell timing, not newly invented rear surface details.
export function shieldPoses(front: HTMLImageElement, back: HTMLImageElement, sprite: number, settings: Rig, side: 'front' | 'back'): Pose[] {
  const bounds = (image: HTMLImageElement) => {
    const strip = extractStrip(image, 15, sprite), ctx = strip.getContext('2d')!;
    return Array.from({ length: 15 }, (_, i) => {
      const pixels = ctx.getImageData(i * W, 0, W, H).data;
      let left=W, right=-1, top=H, bottom=-1;
      for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (pixels[(y*W+x)*4+3]>0) { left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y); }
      return right<0 ? undefined : { x:(left+right)/2, y:top+(bottom-top)*.35, width:right-left+1 };
    });
  };
  const f=bounds(front), b=bounds(back), widths=[...f,...b].filter(Boolean).map(v=>v!.width), max=Math.max(...widths,1);
  return Array.from({ length: 15 }, (_, i) => {
    const target=(side==='front'?f:b)[i], fallback=target||f[i]||b[i];
    return { ...defaultPose(), x:(fallback?.x??32)+settings.xOffset, y:(fallback?.y??70)+settings.yOffset, rotation:settings.baseRotation, scaleX:Math.max(.05,1-(1-(fallback?.width??max)/max)*settings.sideCompression/30)*settings.scale, scaleY:settings.scale, visible:!!target };
  });
}
export function stripSource(image: HTMLCanvasElement, name: string): SourcePart {
  return { fileName: name, mode: 'strip', dataUrl: canvasDataUrl(image), anchor: { x: 32, y: 64 } };
}
export function expandDirections(image: HTMLImageElement): HTMLCanvasElement {
  if (image.width !== 320 || image.height !== 128) throw new Error('Supply a 320×128 strip containing five directions.');
  const result = canvas(960), ctx = result.getContext('2d')!;
  for (let pose = 0; pose < 15; pose++) ctx.drawImage(image, Math.floor(pose / 3) * W, 0, W, H, pose * W, 0, W, H);
  return result;
}
