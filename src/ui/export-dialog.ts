import { activeParts, lowestFreeId } from '../model';
import { ICON_COLUMNS, iconFits, iconRows, outlineIcon } from '../icon';
import { buildZip, canvasDataUrl, dataUrlToBytes } from '../carbon';
import { nativeBundle, validateExport, iconBundle } from '../export';
import { $, h, download } from './dom';
import { state, library, profile, type, status, task, on } from './state';
import { effectiveDefinition, iconDefinitionCount } from './render';

export const exportMarkup = `
<dialog id="exportDialog" aria-labelledby="exportTitle"><h2 id="exportTitle">Export your item</h2>
  <ul id="exportChecks" class="checks-list"></ul>
  <button id="pack" class="export-choice"><strong>Sprite pack</strong><span>PNG layers, icon and item definition. No game files needed.</span></button>
  <button id="native" class="export-choice"><strong>OpenSpell patch</strong><span>Full appearance and icon bundles plus the item definition, allocated against your current library.</span></button>
  <p class="muted">Both include your editable draft. Exporting several new items? Connect the updated library before the next one so their IDs and sprites don’t collide.</p>
  <button id="closeExport">Cancel</button>
</dialog>`;

export type Check = { ok: boolean; text: string; blocking?: boolean };
/** What export needs, in plain words, so problems show before clicking. */
export function exportChecks(): Check[] {
  const d = state.project.definition, projectile = type() === 'projectile', count = iconDefinitionCount();
  const nameOk = !!d.name.trim(), idOk = Number.isInteger(d._id) && d._id >= 0 && (state.project.replaceExisting || !library.defs.some(x => x._id === d._id));
  const art = activeParts(d).some(s => !s.trim && !s.special && state.strips.has(s.key));
  const checks: Check[] = [
    { ok: nameOk, text: nameOk ? `Named “${d.name}”` : 'Give the item a name', blocking: true },
    { ok: idOk, text: idOk ? `Item ID ${d._id}` : `Item ID ${d._id} is taken; use ${lowestFreeId(library.defs)}`, blocking: true },
  ];
  if (!projectile) {
    checks.push({ ok: art && !state.renderError, text: state.renderError || (art ? 'Artwork renders in every frame' : 'Add artwork or start from a game item'), blocking: true });
    const fits = iconFits(d._id, count);
    checks.push({ ok: !!state.iconArt && fits, text: !state.iconArt ? 'No inventory icon yet (needed for a patch)' : fits ? 'Inventory icon ready' : `Item ID ${d._id} has no icon cell; use ${lowestFreeId(library.defs)}`, blocking: !state.project.replaceExisting && !!state.iconArt && !fits });
  }
  return checks;
}
export const blockingIssues = () => exportChecks().filter(c => !c.ok && c.blocking).length;

async function exportFiles(native: boolean) {
  const { project, strips, iconArt } = state;
  if (state.renderError) throw new Error(state.renderError);
  validateExport(project, strips, library.defs);
  let def = effectiveDefinition();
  const files: { name: string; data: string | Uint8Array }[] = [{ name: 'project-v3.json', data: JSON.stringify(project, null, 2) }];
  for (const [key, c] of strips) files.push({ name: `layers/${key}.png`, data: dataUrlToBytes(canvasDataUrl(c)) });
  if (iconArt) files.push({ name: 'icon/icon.png', data: dataUrlToBytes(canvasDataUrl(iconArt)) }, { name: 'icon/icon_outline.png', data: dataUrlToBytes(canvasDataUrl(outlineIcon(iconArt))) });
  if (native) {
    if (!library.entries.length) throw new Error('Native export needs an appearance library. Sprite packs work without it.');
    const result = await nativeBundle(project, strips, library.entries, library.images, library.defs); def = result.definition;
    files.push({ name: 'carbon/appearance.carbon', data: JSON.stringify(result.entries) });
    const count = iconDefinitionCount();
    if (iconArt && library.iconEntries.length) {
      if (!iconFits(def._id, count)) throw new Error(`Item ID ${def._id} can’t show an inventory icon: the game has icon cells for IDs 1–${iconRows(count) * ICON_COLUMNS}. Use ID ${lowestFreeId(library.defs)}, or export a sprite pack.`);
      files.push({ name: 'carbon/items.carbon', data: JSON.stringify(await iconBundle(iconArt, def._id, library.iconEntries, library.icons, count)) });
    } else if (!project.replaceExisting) throw new Error('New items need an inventory icon. Add artwork or upload one in the Icon tab.');
  }
  files.push({ name: 'itemdefs.carbon', data: JSON.stringify([def], null, 2) });
  files.push({ name: 'manifest.json', data: JSON.stringify({ frames: profile().frames, cell: [64, 128], native, layers: activeParts(def).filter(p => strips.has(p.key)), icon: iconArt ? { atlas: 'items.png', outline: 'items_outline.png', size: 48, cell: def._id - 1 } : null, library: library.label }, null, 2) });
  files.push({ name: 'README.txt', data: native ? `OpenSpell equipment patch\n\nLibrary: ${library.label}\n1. Copy carbon/appearance.carbon to apps/shared-assets/custom/static/carbon/appearance.carbon. This is a FULL bundle; it replaces the appearance bundle. Connect your current project before exporting to retain its custom artwork.\n2. Copy carbon/items.carbon (if present) to apps/shared-assets/custom/static/carbon/items.carbon. This is also a FULL bundle: every item's inventory icon, sized for the new definition count.\n3. Merge the records in itemdefs.carbon BY _id into apps/shared-assets/custom/static/itemdefs.carbon (an array). Retain all other existing custom definitions.\n4. Rebuild/restart OpenSpell assets as appropriate for your checkout.\n\nItem ${def._id}: ${def.name}; ${def.equipmentSpriteSheet} #${def.equipmentSpriteId}; icon cell ${def._id - 1}.\nThe game finds icons by item ID and sizes the icon sheet from the number of item definitions, so custom items need the lowest free IDs.\n` : `OpenSpell sprite pack\n\nPNG layers use 64x128 cells, ${profile().frames} consecutive frames per item. The manifest maps layers to native sheets.\nitemdefs.carbon contains a proposed definition. Sprite IDs are provisional until merged into your target project's atlas. Use OpenSpell patch export to allocate and merge native artwork automatically.\nOpen project-v3.json in the studio to continue editing. No carbon import is needed.\nicon/icon.png and icon/icon_outline.png are 48x48; the game draws them from items.png / items_outline.png cell (item ID - 1), 20 cells per row.\n` });
  download(`${def.name.replace(/[^a-z0-9_-]/gi, '-')}-${native ? 'openspell-patch' : 'sprites'}.zip`, buildZip(files));
  $<HTMLDialogElement>('exportDialog').close(); state.dirty = false;
  status(native ? `Exported full appearance patch. Item ${def._id} → sprite ${def.equipmentSpriteId}.` : 'Exported sprite pack and editable draft.');
}

function checklist() {
  $('exportChecks').replaceChildren(...exportChecks().map(c => h('li', { class: c.ok ? 'ok' : c.blocking ? 'bad' : 'warn' }, h('span', { text: c.ok ? '✓' : '!', 'aria-hidden': 'true' }), c.text)));
}
export function mountExport() {
  on('art', () => { if ($<HTMLDialogElement>('exportDialog').open) checklist(); });
  $('export').onclick = () => { checklist(); $<HTMLDialogElement>('exportDialog').showModal(); };
  $('closeExport').onclick = () => $<HTMLDialogElement>('exportDialog').close();
  $('pack').onclick = () => task(() => exportFiles(false));
  $('native').onclick = () => task(() => exportFiles(true));
}
