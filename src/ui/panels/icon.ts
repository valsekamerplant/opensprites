import { defaultIcon, lowestFreeId } from '../../model';
import { ICON_ATLAS, ICON_COLUMNS, iconFits, iconRows, outlineIcon } from '../../icon';
import { canvasDataUrl, dataUrlToBytes, loadImage } from '../../carbon';
import { $, input, number, select, fileData, downloadBytes } from '../dom';
import { state, library, type, snapshot, status, task, on } from '../state';
import { rebuild, gameIcon, iconDefinitionCount } from '../render';

export const iconMarkup = `
<section id="iconPanel" data-tabs="icon">
  <h2>Inventory icon</h2>
  <div class="icon-previews"><figure><canvas id="iconPreview" width="48" height="48"></canvas><figcaption>Inventory</figcaption></figure><figure><canvas id="iconHover" width="48" height="48"></canvas><figcaption>Selected</figcaption></figure></div>
  <small id="iconNote"></small>
  <label>Source<select id="iconSource"><option value="auto">Generated from artwork</option><option value="image">Image</option></select></label>
  <div class="two"><button id="iconUpload">Upload icon PNG</button><button id="iconGame">Use game icon</button></div>
  <div class="two"><label>Rotation<input id="iconRotation" type="number" step="15"></label><label>Size<input id="iconScale" type="number" step="0.1" min="0.1"></label><label>X offset<input id="iconX" type="number"></label><label>Y offset<input id="iconY" type="number"></label></div>
  <label id="iconRecolourLabel"><input id="iconRecolour" type="checkbox"> Apply this item’s colour changes and tier</label>
  <button id="iconSave" class="wide">Save icon PNG</button>
</section>`;

function fill() {
  const icon = state.project.icon!, id = state.project.definition._id, count = iconDefinitionCount();
  select('iconSource').value = icon.source; input('iconRecolour').checked = icon.recolour; $('iconRecolourLabel').hidden = icon.source !== 'image';
  for (const [el, key] of [['iconRotation', 'rotation'], ['iconScale', 'scale'], ['iconX', 'x'], ['iconY', 'y']] as const) input(el).value = String(icon[key]);
  $('iconGame').hidden = state.project.templateId == null || !library.icons.has(ICON_ATLAS);
  for (const [el, outline] of [['iconPreview', false], ['iconHover', true]] as const) {
    const ctx = $<HTMLCanvasElement>(el).getContext('2d')!; ctx.clearRect(0, 0, 48, 48);
    if (state.iconArt) { ctx.drawImage(state.iconArt, 0, 0); if (outline) ctx.drawImage(outlineIcon(state.iconArt), 0, 0); }
  }
  const fits = iconFits(id, count);
  $('iconNote').textContent = !state.iconArt ? (icon.source === 'image' ? 'Upload a 48 × 48 PNG, or switch to Generated from artwork.' : 'Add artwork first, or upload an icon.')
    : fits ? `Cell ${id - 1} of items.png: shown in the inventory, shops and on the ground.`
    : `Item ID ${id} can’t show an icon. The game has icon cells for IDs 1–${iconRows(count) * ICON_COLUMNS} only. Use ID ${lowestFreeId(library.defs)} in Details.`;
  $('iconNote').classList.toggle('error', !!state.iconArt && !fits);
}
export function mountIcon() {
  on('art', fill); on('project', fill);
  $('iconSource').onchange = () => {
    snapshot(); const icon = state.project.icon!; icon.source = select('iconSource').value === 'image' ? 'image' : 'auto';
    if (icon.source === 'auto') Object.assign(icon, { rotation: defaultIcon(type()).rotation, scale: 1, x: 0, y: 0 }); else if (!icon.dataUrl) input('iconFile').click();
    rebuild();
  };
  $('iconUpload').onclick = () => input('iconFile').click();
  input('iconFile').onchange = () => task(async () => {
    const f = input('iconFile').files?.[0]; input('iconFile').value = ''; if (!f) return;
    const dataUrl = await fileData(f), image = await loadImage(dataUrl); snapshot();
    state.project.icon = { ...defaultIcon(type()), source: 'image', dataUrl, fileName: f.name, rotation: 0, recolour: false }; state.iconImage = image; rebuild();
    status(image.width === 48 && image.height === 48 ? 'Icon uploaded.' : `Icon uploaded and fitted into 48 × 48 (source is ${image.width} × ${image.height}).`);
  });
  $('iconGame').onclick = () => task(async () => {
    const url = state.project.templateId != null && gameIcon(state.project.templateId); if (!url) return;
    snapshot(); state.project.icon = { ...defaultIcon(type()), source: 'image', dataUrl: url, fileName: `#${state.project.templateId} icon`, rotation: 0 }; state.iconImage = await loadImage(url); rebuild();
  });
  for (const [el, key] of [['iconRotation', 'rotation'], ['iconScale', 'scale'], ['iconX', 'x'], ['iconY', 'y']] as const) $(el).onchange = () => {
    const v = number(el); if (!Number.isFinite(v) || key === 'scale' && v <= 0) { fill(); return; }
    snapshot(); state.project.icon![key] = v; rebuild();
  };
  $('iconRecolour').onchange = () => { snapshot(); state.project.icon!.recolour = input('iconRecolour').checked; rebuild(); };
  $('iconSave').onclick = () => { if (state.iconArt) downloadBytes('icon.png', dataUrlToBytes(canvasDataUrl(state.iconArt))); else status('This item has no icon yet.', true); };
}
