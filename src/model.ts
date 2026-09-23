import type { ColorReplacement } from './palette';
export const W = 64, H = 128, POSES = 15;
export const DIRECTIONS = ['Front', 'Front ¾', 'Side', 'Rear ¾', 'Rear'];
export const TYPES = ['weapon', 'shield', 'helmet', 'chest', 'legs', 'gloves', 'boots', 'back', 'neck', 'projectile'] as const;
export type EquipmentType = typeof TYPES[number];
export type PartKey = 'main' | 'front' | 'back' | 'trim' | 'trimFront' | 'trimBack';
export type PartSpec = { key: PartKey; label: string; atlas: string; trim?: boolean; special?: boolean };
export type Profile = { label: string; sheet: string; frames: 5 | 15; parts: PartSpec[]; hint: string };
export const PROFILES: Record<EquipmentType, Profile> = {
  weapon: { label: 'Weapon / tool', sheet: 'weapon1', frames: 15, parts: [{ key: 'main', label: 'Weapon', atlas: 'weapon1.png' }], hint: 'Drop a sprite, click its grip point, then generate all 15 poses. Each pose stays editable.' },
  shield: { label: 'Shield', sheet: 'shield1', frames: 15, parts: [
    { key: 'front', label: 'Shield front', atlas: 'shield_front1.png' }, { key: 'back', label: 'Shield rear', atlas: 'shield_back1.png' },
    { key: 'trimFront', label: 'Front trim', atlas: 'shieldtrim_front1.png', trim: true }, { key: 'trimBack', label: 'Rear trim', atlas: 'shieldtrim_back1.png', trim: true },
  ], hint: 'Start from a shield to get both layers. Its blank cells are intentional: the body hides the rear sheet.' },
  helmet: { label: 'Helmet', sheet: 'helmet1', frames: 5, parts: [{ key: 'main', label: 'Helmet', atlas: 'helmet1.png' }, { key: 'trim', label: 'Trim', atlas: 'helmettrim1.png', trim: true }, { key: 'back', label: 'Pumpkin rear (617 only)', atlas: 'helmet_back1.png', special: true }], hint: 'Five directions, repeated across the walk cycle. Use a template or supply front, angled, side and rear artwork.' },
  chest: { label: 'Chest armour', sheet: 'chest1', frames: 15, parts: [{ key: 'main', label: 'Chest', atlas: 'chest1.png' }, { key: 'trim', label: 'Trim', atlas: 'chesttrim1.png', trim: true }], hint: 'Templates preserve the changing arms and torso through the walk cycle. Hide the base shirt in item settings when needed.' },
  legs: { label: 'Leg armour', sheet: 'legs1', frames: 15, parts: [{ key: 'main', label: 'Leg armour', atlas: 'legs1.png' }, { key: 'trim', label: 'Trim', atlas: 'legstrim1.png', trim: true }], hint: 'Templates preserve walking legs. The client draws base pants underneath leg armour; boots have special overlap rules.' },
  gloves: { label: 'Gloves', sheet: 'gloves1', frames: 15, parts: [{ key: 'main', label: 'Gloves', atlas: 'gloves1.png' }], hint: 'Follow the hands in all 15 poses. Templates keep the existing hand placement.' },
  boots: { label: 'Boots', sheet: 'boots1', frames: 15, parts: [{ key: 'main', label: 'Boots', atlas: 'boots1.png' }], hint: 'Follow the feet in all 15 poses. Preview with leg armour to check overlap.' },
  back: { label: 'Cape', sheet: 'back1', frames: 15, parts: [{ key: 'back', label: 'Cape rear view', atlas: 'cape_back1.png' }, { key: 'front', label: 'Cape front view', atlas: 'cape_front1.png' }], hint: 'The front-view sheet draws behind the body; the rear-view sheet draws over it. A template loads the pair together.' },
  neck: { label: 'Neck item', sheet: 'neck1', frames: 5, parts: [{ key: 'main', label: 'Neck item', atlas: 'neck1.png' }], hint: 'Five directions. The client repeats each direction for three animation frames.' },
  projectile: { label: 'Ammunition', sheet: '', frames: 15, parts: [], hint: 'Ammunition is metadata-only when equipped; it has no character appearance sheet.' },
};
export type ItemDef = { _id: number; name: string; equipmentType?: EquipmentType; equipmentSpriteId?: number | null; equipmentSpriteSheet?: string | null; equipmentTrimSpriteId?: number | null; equipmentTrimSpriteSheet?: string | null; hidesSpritesUnderneath?: boolean; [key: string]: any };
export type Pose = { x: number; y: number; rotation: number; skewX: number; skewY: number; scaleX: number; scaleY: number; flipX: boolean; visible: boolean; behindReference?: boolean };
export const defaultPose = (): Pose => ({ x: 32, y: 64, rotation: 0, skewX: 0, skewY: 0, scaleX: 1, scaleY: 1, flipX: false, visible: true });
export type WeaponCutout = { mode: 'none' | 'hands' | 'hands-body'; hands: string; rear: string };
export type SourcePart = { fileName: string; dataUrl: string; mode: 'single' | 'strip'; anchor: { x: number; y: number }; poses?: Pose[]; atlasDataUrl?: string; tint?: string; replacements?: ColorReplacement[]; legacyFrames?: number[]; requiresDirections?: boolean; unbakedDataUrl?: string; bakedDataUrl?: string; cutout?: WeaponCutout };
export type Rig = { preset: string; baseRotation: number; skewStrength: number; sideCompression: number; xOffset: number; yOffset: number; scale: number; autoOcclusion?: boolean };
export const defaultRig = (): Rig => ({ preset: 'reference-held', baseRotation: 0, skewStrength: 8, sideCompression: 30, xOffset: 0, yOffset: 0, scale: 1 });
export type Project = { version: 3; definition: ItemDef; sourceParts: Partial<Record<PartKey, SourcePart>>; autoRig: Rig; replaceExisting: boolean; templateId?: number; };
export const activeParts = (def: ItemDef) => PROFILES[def.equipmentType || 'weapon'].parts.filter(p => !p.special || def._id === 617);
export function newDefinition(type: EquipmentType, defs: ItemDef[]): ItemDef {
  return { _id: Math.max(999, ...defs.map(d => d._id)) + 1, name: `New ${PROFILES[type].label.toLowerCase()}`, description: '', equipmentType: type, equipmentSpriteSheet: PROFILES[type].sheet || null, equipmentSpriteId: type === 'projectile' ? null : 0, cost: 1, weight: type === 'projectile' ? 0 : 1, isTradeable: true, isStackable: type === 'projectile', isNamePlural: false, isForMission: false, isMembers: false, canIOU: false, inventoryActions: ['equip'], equippableEffects: [], equippableRequirements: [], weaponSpeed: type === 'weapon' ? 4 : undefined };
}
