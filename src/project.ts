import { TYPES, PROFILES, activeParts, defaultRig, defaultPose, defaultIcon, type Project, type ItemDef, type Pose, type SourcePart, type IconSettings } from './model';
import { validateColorReplacements } from './palette';
import { weaponPreset } from './artwork';

export function parseProject(text: string): Project {
  const raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (![1, 2, 3].includes(raw.version)) throw new Error('Unsupported project version.');
  const item = raw.definition || raw.item;
  if (!item || !TYPES.includes(item.equipmentType)) throw new Error('Project has no valid equipment type.');
  const definition: ItemDef = raw.definition || {
    ...(raw.templateDefinition || {}), ...item, _id: item.id ?? item._id, isTradeable: item.tradeable ?? item.isTradeable ?? true,
    equipmentSpriteSheet: item.equipmentSpriteSheet || PROFILES[item.equipmentType as keyof typeof PROFILES].sheet,
  };
  if (!Number.isInteger(definition._id) || definition._id < 0) throw new Error('Project has an invalid item ID.');
  const sourceParts = raw.sourceParts || {};
  if (!raw.sourceParts) {
    const dataUrl = raw.sourceDataUrl || raw.source?.dataUrl || '';
    sourceParts.main = { fileName: raw.sourceFileName || 'Legacy artwork', dataUrl, mode: raw.sourceMode || 'single', anchor: raw.sourceAnchor || { x: 0, y: 0 } };
  }
  const validKeys = new Set(activeParts(definition).map(p => p.key));
  if (sourceParts.main && !validKeys.has('main')) {
    const primary = activeParts(definition)[0]?.key;
    if (primary && !sourceParts[primary]) sourceParts[primary] = sourceParts.main;
  }
  for (const [key, part] of Object.entries(sourceParts) as [string, SourcePart][]) {
    if (!validKeys.has(key as any)) { delete sourceParts[key]; continue; }
    if (!part || !['single', 'strip'].includes(part.mode) || typeof part.dataUrl !== 'string' || !Number.isFinite(part.anchor?.x) || !Number.isFinite(part.anchor?.y)) throw new Error(`Invalid ${key} artwork.`);
    if (part.mode === 'single' && !part.poses) part.poses = raw.poses || Array.from({ length: 15 }, defaultPose);
    if (raw.version < 3 && PROFILES[definition.equipmentType!].frames === 5 && part.mode === 'single') part.requiresDirections = true;
    if (part.poses) {
      if (part.poses.length !== 15) throw new Error('Every pose sequence must contain 15 frames.');
      part.poses = part.poses.map((p: Pose) => {
        const pose = { ...defaultPose(), ...p };
        for (const name of ['x', 'y', 'rotation', 'skewX', 'skewY', 'scaleX', 'scaleY'] as const) if (!Number.isFinite(pose[name])) throw new Error(`Invalid pose ${name}.`);
        return pose;
      });
    }
    if (part.legacyFrames && (part.legacyFrames.length !== 5 || part.legacyFrames.some(x => !Number.isInteger(x) || x < 0 || x >= 15))) throw new Error('Invalid legacy directional frame selection.');
    if (part.cutout && (definition.equipmentType !== 'weapon' || !['none','hands','hands-body'].includes(part.cutout.mode) || typeof part.cutout.hands !== 'string' || typeof part.cutout.rear !== 'string' || !part.cutout.hands.startsWith('data:image/png;base64,') || !part.cutout.rear.startsWith('data:image/png;base64,'))) throw new Error('Invalid weapon cutout settings or embedded masks.');
    if (part.rotationQuality !== undefined && !['rotsprite', 'nearest'].includes(part.rotationQuality)) throw new Error(`Invalid ${key} rotation quality.`);
    if (part.replacements !== undefined) part.replacements = validateColorReplacements(part.replacements);
    if (part.tint !== undefined && !/^#[0-9a-f]{6}$/i.test(part.tint)) throw new Error(`Invalid ${key} tint.`);
  }
  const autoRig = { ...defaultRig(), ...raw.autoRig };
  autoRig.preset = weaponPreset(autoRig.preset); // retired 'reference-held' becomes the sword measurement
  for (const k of ['baseRotation','skewStrength','sideCompression','xOffset','yOffset','scale']) if (!Number.isFinite(autoRig[k])) throw new Error(`Invalid generation setting: ${k}.`);
  const icon: IconSettings = { ...defaultIcon(definition.equipmentType!), ...raw.icon };
  if (!['auto', 'image'].includes(icon.source) || typeof icon.recolour !== 'boolean' || (icon.dataUrl !== undefined && (typeof icon.dataUrl !== 'string' || !icon.dataUrl.startsWith('data:image/png;base64,')))) throw new Error('Invalid inventory icon settings.');
  for (const k of ['rotation', 'scale', 'x', 'y'] as const) if (!Number.isFinite(icon[k])) throw new Error(`Invalid icon setting: ${k}.`);
  if (icon.scale <= 0) throw new Error('Icon size must be positive.');
  return { version: 3, definition, sourceParts, autoRig, replaceExisting: !!raw.replaceExisting, templateId: raw.templateId, icon };
}
