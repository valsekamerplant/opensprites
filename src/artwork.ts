import { W, H, POSES, type SourcePart, type Pose, type Rig, type EquipmentType, defaultPose } from './model';
import { canvasDataUrl } from './carbon';
import type { CutoutImages } from './occlusion';
import { applyColorReplacements } from './palette';

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
export function renderPart(source: SourcePart, image: HTMLImageElement, frames: number, cutouts?: CutoutImages): HTMLCanvasElement {
  if (source.requiresDirections) throw new Error('Choose the five directional frames from this legacy 15-frame project before exporting.');
  let artwork: HTMLImageElement | HTMLCanvasElement = image;
  if (source.replacements?.some(r => r.enabled !== false)) {
    const coloured = canvas(image.width, image.height), ctx = coloured.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height);
    applyColorReplacements(data.data, source.replacements);
    ctx.putImageData(data, 0, 0); artwork = coloured;
  }
  const result = canvas(frames * W), ctx = result.getContext('2d')!;
  for (let i = 0; i < frames; i++) {
    const p = source.poses?.[frames === 5 ? i * 3 : i];
    if (p && !p.visible) continue;
    ctx.save(); ctx.translate(i * W, 0); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    if (source.mode === 'strip') {
      let frame = i;
      if (image.width === 960 && frames === 5) {
        if (!source.legacyFrames || source.legacyFrames.length !== 5) throw new Error('Choose the five directional frames from this legacy 15-frame strip before exporting.');
        frame = source.legacyFrames[i];
      } else if (image.width !== frames * W || image.height !== H) throw new Error(`This layer needs a ${frames * W}×128 strip. Switch to Single sprite for other image sizes.`);
      if (p) { ctx.translate(source.anchor.x, source.anchor.y); transform(ctx, p); ctx.translate(-source.anchor.x, -source.anchor.y); }
      ctx.drawImage(artwork, frame * W, 0, W, H, 0, 0, W, H);
    } else {
      transform(ctx, p ?? defaultPose());
      ctx.drawImage(artwork, -source.anchor.x, -source.anchor.y);
    }
    ctx.restore();
  }
  if (source.tint) {
    const data = ctx.getImageData(0, 0, result.width, result.height);
    const color = source.tint?.match(/[a-f\d]{2}/gi)?.map(x => parseInt(x, 16));
    if (color?.length === 3) for (let i = 0; i < data.data.length; i += 4) {
      const light = Math.max(data.data[i], data.data[i + 1], data.data[i + 2]) / 255;
      for (let j = 0; j < 3; j++) data.data[i + j] = Math.round(light * color[j]);
    }
    ctx.putImageData(data, 0, 0);
  }
  if (source.cutout && source.cutout.mode !== 'none') {
    if (frames !== 15 || !cutouts) throw new Error('Weapon cutout masks are missing. Reload the draft or turn automatic cutouts off.');
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(cutouts.hands, 0, 0);
    if (source.cutout.mode === 'hands-body') ctx.drawImage(cutouts.rear, 0, 0);
    ctx.restore();
  }
  return result;
}
const HELD = [[16,68,0,.2,1],[13,68,2.5,.3,1],[14,68,6,.4,1],[23,67,5.7,.35,.92],[22,67,8.7,.45,.9],[19,68,15.6,.6,.88],[42,65,1.9,.75,.78],[37,67,10.3,.9,.74],[34,67,24.3,1,.7],[56,80,2.4,-.75,.78],[52,81,9.7,-.9,.74],[50,80,11.7,-1,.7],[50,80,0,-.2,.96],[52,81,-4.7,-.1,.98],[51,80,-6.9,0,1]];
export function generatePoses(type: EquipmentType, settings: Rig): Pose[] {
  return Array.from({ length: POSES }, (_, i) => {
    const held = type === 'weapon';
    const [x, y, rotation, skew, scale] = held ? HELD[i] : type === 'helmet' ? [32,20,0,0,1] : type === 'shield' ? [46,70,0,[0,.4,1,-.4,0][Math.floor(i/3)],[1,.7,.12,.7,1][Math.floor(i/3)]] : [32,62,0,0,1];
    return { ...defaultPose(), x: x + settings.xOffset, y: y + settings.yOffset, rotation: rotation + settings.baseRotation, skewX: skew * settings.skewStrength, scaleX: Math.max(.08, 1 - (1 - scale) * settings.sideCompression / 30) * settings.scale, scaleY: settings.scale };
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
