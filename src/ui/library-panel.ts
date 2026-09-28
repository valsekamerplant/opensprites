import { TYPES, PROFILES, lowestFreeId } from '../model';
import { canvas } from '../artwork';
import { clientLayers, renderClientPose } from '../compositor';
import { readProjectFiles, type FileLike } from '../library';
import { canPickFolder, forgetFolder, libraryFiles, permitted, pickFolder, rememberFolder, rememberedFolder } from './folder';
import { $, h, input, plural } from './dom';
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
  <details id="connection"><summary>Project library <span id="libraryBadge" class="badge">bundled</span></summary>
    <p id="librarySource">Bundled OpenSpell assets</p>
    <p id="libraryReport" class="muted"></p>
    <p id="libraryError" class="error" role="alert" hidden></p>
    <p id="libraryHelp" class="muted">Connect your OpenSpell checkout (or its <code>apps/shared-assets</code> folder) so exports know your custom items and use free IDs and sprites after them.</p>
    <button id="reconnectButton" class="primary" hidden></button>
    <button id="folderButton">Connect project folder</button><button id="carbonButton">Load asset files</button>
    <button id="bundledButton" hidden>Use the bundled library</button></details>
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
  $('folderButton').onclick = () => task(async () => {
    if (!canPickFolder()) { input('folder').click(); return; }
    let handle: FileSystemDirectoryHandle;
    try { handle = await pickFolder(); } catch { return; } // cancelled
    if (await connect(await libraryFiles(handle), handle.name, 'folder')) await rememberFolder(handle);
  });
  $('carbonButton').onclick = () => input('carbonFiles').click();
  for (const id of ['folder', 'carbonFiles']) $(id).onchange = () => task(async () => {
    const files = Array.from(input(id).files || []); input(id).value = ''; if (!files.length) return;
    await connect(files, id === 'folder' ? files[0].webkitRelativePath.split('/')[0] : 'Imported assets', id === 'folder' ? 'folder' : 'files');
  });
  $('bundledButton').onclick = () => task(async () => {
    await library.bundled(); await forgetFolder(); showLibrary(); emit('library'); rebuild();
    status('Using the bundled game library again.');
  });
  // A folder picked on an earlier visit comes back with one click (the browser asks again).
  rememberedFolder().then(handle => {
    if (!handle) return;
    const button = $('reconnectButton'); button.textContent = `Reconnect ${handle.name}`; button.hidden = false;
    button.onclick = () => task(async () => {
      if (!await permitted(handle, true)) { libraryError(`Read access to ${handle.name} was not granted.`); return; }
      await connect(await libraryFiles(handle), handle.name, 'folder');
    });
  });
  on('library', showLibrary);
}

function libraryError(message?: string) {
  $('libraryError').textContent = message ?? ''; $('libraryError').hidden = !message;
  if (message) { $<HTMLDetailsElement>('connection').open = true; status(message, true); }
}
/** Load a picked folder or files as the library. Failures leave the current library in place and say why, in the panel. */
async function connect(files: FileLike[], label: string, source: 'folder' | 'files') {
  try {
    const result = await readProjectFiles(files, library);
    await library.setAppearance(result.entries); if (result.iconEntries.length) await library.setIcons(result.iconEntries);
    library.defs = result.defs; library.label = label; library.source = source; library.report = result.report;
  } catch (error) { libraryError(`Couldn’t connect ${label}: ${(error as Error).message}`); return false; }
  libraryError(); $('reconnectButton').hidden = true;
  // A new item must not reuse an ID the connected library already has.
  const def = state.project.definition, taken = !state.project.replaceExisting && library.defs.some(d => d._id === def._id), was = def._id;
  if (taken) def._id = lowestFreeId(library.defs);
  emit('library'); emit('project'); rebuild();
  status(`Connected ${label}: ${plural(library.report!.customItems, 'custom item')}.${taken ? ` Your new item moved from ID ${was} to ${def._id}.` : ''} Existing draft artwork is preserved.`);
  return true;
}
function showLibrary() {
  const r = library.report, bundled = library.source === 'bundled';
  $('librarySource').textContent = bundled ? 'Bundled OpenSpell assets' : library.label;
  $('libraryBadge').textContent = bundled ? 'bundled' : 'connected';
  $('libraryBadge').classList.toggle('connected', !bundled);
  $('bundledButton').hidden = bundled;
  const from = (name: string) => r?.used.filter(u => u.name === name).map(u => u.layer).join(' + ');
  $('libraryReport').textContent = !r ? `${plural(library.items().length, 'equipment item')} from the game. Your custom items aren’t included.`
    : `${plural(r.baseItems, 'game item')} + ${plural(r.customItems, 'custom item')} · appearance: ${from('appearance.carbon') || 'kept'} · icons: ${from('items.carbon') || 'kept'}${r.skipped.length ? ` · ignored ${r.skipped.length} cop${r.skipped.length === 1 ? 'y' : 'ies'}` : ''}`;
  $('libraryReport').title = r ? [...r.used.map(u => `used ${u.path}`), ...r.skipped.map(s => `skipped ${s.path} (${s.reason})`)].join('\n') : '';
  const chip = document.getElementById('libraryChip');
  if (chip) { chip.textContent = `Library: ${bundled ? 'bundled' : library.label}`; chip.classList.toggle('connected', !bundled); }
}
