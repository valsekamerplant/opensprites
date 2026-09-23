import { canvas, extractStrip } from './artwork';
import { W, H } from './model';

export type CutoutImages = { hands: HTMLImageElement | HTMLCanvasElement; rear: HTMLImageElement | HTMLCanvasElement };

// Calibrated to the native human and bronze longsword. Gloves locate the hands;
// the body's alpha limits the cutout to skin. Visible longsword pixels preserve
// the guard/pommel and the few pixels intentionally drawn over the character.
// Masks stay in character coordinates, AFTER the source's per-frame transform.
export function buildWeaponCutouts(images: Map<string, HTMLImageElement>, swordSprite: number): CutoutImages {
  const strip = (name: string, id = 0) => {
    const image = images.get(name);
    if (!image) throw new Error(`Cannot build weapon cutouts: missing ${name}.`);
    return extractStrip(image, 15, id).getContext('2d')!.getImageData(0, 0, W * 15, H).data;
  };
  const body = strip('body.png'), gloves = strip('gloves1.png'), pants = strip('pants.png');
  const sword = strip('weapon1.png', swordSprite);
  const hands = canvas(W * 15), rear = canvas(W * 15);
  const h = hands.getContext('2d')!.createImageData(W * 15, H), r = rear.getContext('2d')!.createImageData(W * 15, H);
  for (let i = 0; i < body.length; i += 4) {
    if (sword[i + 3] !== 0) continue;
    const pose = Math.floor((i / 4 % (W * 15)) / W);
    h.data[i + 3] = Math.min(body[i + 3], gloves[i + 3]);
    if (pose >= 9) r.data[i + 3] = Math.max(body[i + 3], pants[i + 3]);
  }
  hands.getContext('2d')!.putImageData(h, 0, 0); rear.getContext('2d')!.putImageData(r, 0, 0);
  return { hands, rear };
}

export function validateCutoutImage(image: HTMLImageElement | HTMLCanvasElement) {
  if (image.width !== W * 15 || image.height !== H) throw new Error('Weapon cutout masks must contain 15 frames (960 × 128).');
}
