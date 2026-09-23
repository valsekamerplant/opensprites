import { H, W, PROFILES, type EquipmentType, type ItemDef } from './model';

export type Layer = { atlas: string; sprite: number; frames: 5 | 15; slot?: EquipmentType; part?: string; supplemental?: boolean };
export type Outfit = Partial<Record<EquipmentType, ItemDef>>;
export type Mannequin = { body: number; shirt: number; pants: number; hair: number; beard: number };
export const DEFAULT_MANNEQUIN: Mannequin = { body: 0, shirt: 0, pants: 0, hair: 1, beard: 1 };
const valid = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id >= 0;
const has = (def?: ItemDef) => !!def && valid(def.equipmentSpriteId) && !!def.equipmentSpriteSheet;
const sheetIndex = (sheet?: string | null) => Number(sheet?.slice(-1)) - 1;

// Port of OpenSpell client.61.js iU HumanSpriteWorker, pinned in public/game/provenance.json.
// Preserve order and exceptions, including the unused leg-hiding flag in that worker.
export function clientLayers(outfit: Outfit, mannequin = DEFAULT_MANNEQUIN): Layer[] {
  const result: Layer[] = [];
  const base = (name: keyof Mannequin, frames: 5 | 15) => {
    if (valid(mannequin[name])) result.push({ atlas: `${name}.png`, sprite: mannequin[name], frames });
  };
  const part = (slot: EquipmentType, key = 'main', override?: number) => {
    const def = outfit[slot];
    if (!has(def)) return;
    const spec = PROFILES[slot].parts.find(p => p.key === key);
    if (!spec) return;
    const sprite = override ?? (spec.trim ? def!.equipmentTrimSpriteId : def!.equipmentSpriteId);
    if (!valid(sprite) || (spec.trim && !def!.equipmentTrimSpriteSheet)) return;
    result.push({ slot, part: key, atlas: spec.atlas, sprite, frames: PROFILES[slot].frames, supplemental: slot === 'gloves' && override === 12 });
  };
  const trimmed = (slot: EquipmentType) => { part(slot); part(slot, 'trim'); };
  if (outfit.helmet?._id === 617) part('helmet', 'back', 0);
  part('back', 'front');
  part('shield', 'back'); part('shield', 'trimBack');
  base('pants', 15);
  const legs = outfit.legs, boots = outfit.boots;
  const bootsOver = has(legs) && has(boots) && !(sheetIndex(legs!.equipmentSpriteSheet) === 0 && [9, 10, 11, 12, 13, 14].includes(legs!.equipmentSpriteId!));
  if (bootsOver) { trimmed('legs'); part('boots'); } else { part('boots'); trimmed('legs'); }
  base('body', 15);
  if (!outfit.chest?.hidesSpritesUnderneath) base('shirt', 15);
  const chest = outfit.chest, gloves = outfit.gloves;
  const chestId = chest?.equipmentSpriteId ?? -1, gloveId = gloves?.equipmentSpriteId ?? -1;
  const glovesOver = has(chest) && has(gloves)
    && !(sheetIndex(chest!.equipmentSpriteSheet) === 0 && [9, 10, 11, 12, 13, 14, 15].includes(chestId))
    && !(sheetIndex(chest!.equipmentSpriteSheet) === 0 && [0, 1, 2, 3, 4, 6, 7, 8].includes(chestId)
      && sheetIndex(gloves!.equipmentSpriteSheet) === 0 && [13, 14, 15, 16, 19, 20].includes(gloveId));
  if (glovesOver) { trimmed('chest'); part('gloves'); } else { part('gloves'); trimmed('chest'); }
  if ([611, 612, 613, 614, 615, 616].includes(gloves?._id ?? -1)) part('gloves', 'main', 12);
  part('neck'); part('back', 'back');
  if (!outfit.helmet?.hidesSpritesUnderneath) { base('beard', 5); base('hair', 5); }
  trimmed('helmet');
  part('shield', 'front'); part('shield', 'trimFront');
  part('weapon');
  return result;
}

export function drawAtlasFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement | HTMLCanvasElement, sprite: number, frames: number, pose: number) {
  const cols = image.width / W;
  const cell = sprite * frames + (frames === 5 ? Math.floor(pose / 3) : pose);
  const x = cell % cols * W, y = Math.floor(cell / cols) * H;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, x, y, W, H, 0, 0, W, H);
}
export function renderClientPose(ctx: CanvasRenderingContext2D, pose: number, layers: Layer[], images: Map<string, HTMLImageElement>, override?: (layer: Layer) => HTMLCanvasElement | undefined) {
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  for (const layer of layers) {
    const strip = override?.(layer);
    if (strip) drawAtlasFrame(ctx, strip, 0, layer.frames, pose);
    else {
      const atlas = images.get(layer.atlas);
      if (atlas) drawAtlasFrame(ctx, atlas, layer.sprite, layer.frames, pose);
    }
  }
}
