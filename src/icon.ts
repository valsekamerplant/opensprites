import { canvas, rotateArt, type Artwork } from './artwork';
import type { IconSettings } from './model';

// Pinned client: items.png and items_outline.png are 20 columns of 48×48 cells. An item
// uses cell _id − 1 in the inventory, shops and on the ground; the CSS sizes the atlas to
// ceil(definition count / 20) rows, so the image height must match exactly.
export const ICON = 48, ICON_COLUMNS = 20, ICON_ATLAS = 'items.png', OUTLINE_ATLAS = 'items_outline.png';
const MARGIN = 2;
export const iconRows = (definitionCount: number) => Math.ceil(definitionCount / ICON_COLUMNS);
export const iconFits = (id: number, definitionCount: number) => Number.isInteger(id) && id >= 1 && id <= iconRows(definitionCount) * ICON_COLUMNS;

export function extractIcon(atlas: Artwork, id: number): HTMLCanvasElement {
  const result = canvas(ICON, ICON), cell = id - 1;
  if (cell >= 0) result.getContext('2d')!.drawImage(atlas, cell % ICON_COLUMNS * ICON, Math.floor(cell / ICON_COLUMNS) * ICON, ICON, ICON, 0, 0, ICON, ICON);
  return result;
}
function opaqueBounds(image: Artwork) {
  const c = canvas(image.width, image.height), ctx = c.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let left = c.width, top = c.height, right = -1, bottom = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  return right < 0 ? undefined : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}
// A finished 48×48 image is kept pixel-for-pixel unless adjusted. Anything else is cropped
// to its visible pixels and fitted: whole-number enlargement for small pixel art keeps it
// crisp; larger art is reduced.
export function composeIcon(art: Artwork, settings: IconSettings): HTMLCanvasElement {
  const result = canvas(ICON, ICON), ctx = result.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const finished = art.width === ICON && art.height === ICON && !(settings.rotation % 360);
  const turned = settings.rotation % 360 ? rotateArt(art, settings.rotation) : art;
  const b = finished ? { x: 0, y: 0, w: ICON, h: ICON } : opaqueBounds(turned);
  if (!b) return result;
  const room = ICON - 2 * MARGIN, fit = finished ? 1 : Math.min(room / b.w, room / b.h), scale = (fit >= 1 ? Math.floor(fit) : fit) * settings.scale;
  const w = Math.max(1, Math.round(b.w * scale)), h = Math.max(1, Math.round(b.h * scale));
  ctx.drawImage(turned, b.x, b.y, b.w, b.h, Math.round((ICON - w) / 2 + settings.x), Math.round((ICON - h) / 2 + settings.y), w, h);
  return result;
}
// Native weapon frames have a hole where the hand grips them. Fill short transparent runs
// between opaque pixels in the same column, copying the nearer edge, so an icon made from a
// finished strip has a whole handle.
export function closeGripGap(art: HTMLCanvasElement, maxGap = 8): HTMLCanvasElement {
  const ctx = art.getContext('2d')!, data = ctx.getImageData(0, 0, art.width, art.height), d = data.data, w = art.width;
  for (let x = 0; x < w; x++) {
    let last = -1;
    for (let y = 0; y < art.height; y++) {
      if (!d[(y * w + x) * 4 + 3]) continue;
      const gap = y - last - 1;
      if (last >= 0 && gap > 0 && gap <= maxGap) for (let g = 1; g <= gap; g++) {
        const from = ((g <= gap / 2 ? last : y) * w + x) * 4, to = ((last + g) * w + x) * 4;
        for (let c = 0; c < 4; c++) d[to + c] = d[from + c];
      }
      last = y;
    }
  }
  ctx.putImageData(data, 0, 0);
  return art;
}
// Native outlines are opaque white on transparent pixels that share an edge with the icon.
export function outlineIcon(icon: HTMLCanvasElement): HTMLCanvasElement {
  const src = icon.getContext('2d')!.getImageData(0, 0, ICON, ICON).data, result = canvas(ICON, ICON), ctx = result.getContext('2d')!, out = ctx.createImageData(ICON, ICON);
  const solid = (x: number, y: number) => x >= 0 && x < ICON && y >= 0 && y < ICON && src[(y * ICON + x) * 4 + 3] > 0;
  for (let y = 0; y < ICON; y++) for (let x = 0; x < ICON; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) out.data.fill(255, (y * ICON + x) * 4, (y * ICON + x) * 4 + 4);
  ctx.putImageData(out, 0, 0);
  return result;
}
// Returns a copy of the atlas sized for the definition count, with the item's cell replaced.
export function writeIcon(atlas: Artwork, cellArt: HTMLCanvasElement, id: number, definitionCount: number): HTMLCanvasElement {
  if (!iconFits(id, definitionCount)) throw new Error(`Item ${id} has no icon cell; the game shows icons for IDs 1–${iconRows(definitionCount) * ICON_COLUMNS}.`);
  const result = canvas(ICON_COLUMNS * ICON, iconRows(definitionCount) * ICON), ctx = result.getContext('2d')!, cell = id - 1;
  const x = cell % ICON_COLUMNS * ICON, y = Math.floor(cell / ICON_COLUMNS) * ICON;
  ctx.drawImage(atlas, 0, 0); ctx.clearRect(x, y, ICON, ICON); ctx.drawImage(cellArt, x, y);
  return result;
}
