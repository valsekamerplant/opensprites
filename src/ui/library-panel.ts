import { TYPES, PROFILES } from '../model';
import { canvas } from '../artwork';
import { clientLayers, renderClientPose } from '../compositor';
import { readProjectFiles } from '../library';
import { $, h, input } from './dom';
import { state, library, type, status, task, on, emit } from './state';
import { rebuild } from './render';
import { browse, useTemplate } from './actions';

export const libraryMarkup = `
<aside class="library">
  <div class="section-title"><h2>Game items</h2><span id="count"></span></div>
  <input id="search" type="search" placeholder="Search name or ID" aria-label="Find an item">
  <div id="catalog"></div>
  <div class="library-actions"><strong id="selectedItem">Select an item to preview</strong><small id="selectedInfo">Clone makes a new item. Edit original replaces it.</small>
    <div class="two"><button id="clone" class="primary" disabled>Clone item</button><button id="editExisting" disabled>Edit original</button></div></div>
  <details id="connection"><summary>Project library <span class="badge">optional</span></summary>
    <p id="librarySource">Bundled OpenSpell assets</p><p class="muted">Connect your checkout to include your custom items. PNG uploads work without it.</p>
    <button id="folderButton">Connect project folder</button><button id="carbonButton">Load asset files</button></details>
</aside>`;

export function catalog() {
  const q = input('search').value.toLowerCase(), t = type();
  const defs = library.items().filter(d => d.equipmentType === t && `${d.name} ${d._id}`.toLowerCase().includes(q));
  $('count').textContent = String(defs.length);
  $('catalog').replaceChildren(...defs.map(def => {
    const c = canvas(64); renderClientPose(c.getContext('2d')!, t === 'back' ? 12 : 0, clientLayers({ [t]: def }), library.images);
    return h('button', { class: `item ${state.librarySelection?._id === def._id ? 'selected' : ''}`, title: `Preview ${def.name} (#${def._id})`, onclick: () => { browse(def); status(`Previewing ${def.name}. Clone it as a new item, or edit the original.`); } },
      c, h('span', { text: def.name }, h('small', { text: `#${def._id}` })));
  }));
  const available = state.librarySelection?.equipmentType === t, sel = state.librarySelection;
  $('clone').toggleAttribute('disabled', !available); $('editExisting').toggleAttribute('disabled', !available);
  $('selectedItem').textContent = available ? sel!.name : 'Select an item to preview';
  $('selectedInfo').textContent = available ? `#${sel!._id} · ${sel!.equipmentSpriteSheet || 'metadata'} · sprite ${sel!.equipmentSpriteId ?? '—'}` : 'Clone makes a new item. Edit original replaces it.';
}
function outfitControls() {
  $('outfit').replaceChildren(...TYPES.filter(t => t !== type() && t !== 'projectile').map(t => {
    const select = h('select', { onchange: () => { state.outfit[t] = library.defs.find(d => String(d._id) === select.value); rebuild(); } }, new Option('None', ''));
    for (const d of library.items().filter(d => d.equipmentType === t)) select.add(new Option(d.name, String(d._id)));
    select.value = String(state.outfit[t]?._id ?? '');
    return h('label', {}, PROFILES[t].label, select);
  }));
}
export const cloneSelection = () => task(async () => { if (state.librarySelection) await useTemplate(state.librarySelection); });
export const editSelection = () => task(async () => { if (state.librarySelection) await useTemplate(state.librarySelection, true); });

export function mountLibrary() {
  on('library', () => { catalog(); outfitControls(); }); on('browse', catalog);
  $('search').oninput = catalog;
  $('clone').onclick = cloneSelection; $('editExisting').onclick = editSelection;
  $('folderButton').onclick = () => input('folder').click(); $('carbonButton').onclick = () => input('carbonFiles').click();
  for (const id of ['folder', 'carbonFiles']) $(id).onchange = () => task(async () => {
    const files = Array.from(input(id).files || []); if (!files.length) return;
    const result = await readProjectFiles(files, library); await library.setAppearance(result.entries); if (result.iconEntries.length) await library.setIcons(result.iconEntries); library.defs = result.defs;
    library.label = id === 'folder' ? files[0].webkitRelativePath.split('/')[0] : 'Imported assets'; $('librarySource').textContent = library.label;
    emit('library'); rebuild(); status(`Connected ${library.label}. Existing draft artwork is preserved.`); input(id).value = '';
  });
}
