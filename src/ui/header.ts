import { TYPES, PROFILES, type EquipmentType } from '../model';
import { $, input, select } from './dom';
import { state, type, snapshot, status, task, on } from './state';
import { changeType, newDraft, openDraft, saveDraft } from './actions';
import { blockingIssues } from './export-dialog';

export const headerMarkup = `
<header>
  <div class="brand"><strong>OpenSpell <span>Item studio</span></strong><small id="operationLabel">New item</small></div>
  <input id="name" aria-label="Item name" placeholder="Item name">
  <select id="type" aria-label="Equipment type"></select>
  <div class="header-actions">
    <button id="new" title="Start a blank item of this type">New item</button>
    <button id="open" title="Open a saved draft (.json)">Open draft</button>
    <button id="save" title="Download an editable draft with its source images">Save draft</button>
    <button id="export" class="primary">Export…<span id="exportBadge" class="count-badge" hidden></span></button>
  </div>
</header>`;

function fill() {
  const p = state.project;
  input('name').value = p.definition.name; select('type').value = type();
  $('operationLabel').textContent = p.replaceExisting ? `Editing original #${p.definition._id}` : p.templateId != null ? `Clone of #${p.templateId} · new #${p.definition._id}` : `New item #${p.definition._id}`;
}
function browse() {
  input('name').disabled = !!state.browsing; $('save').toggleAttribute('disabled', !!state.browsing); $('export').toggleAttribute('disabled', !!state.browsing);
}
function badge() {
  const n = blockingIssues(), el = $('exportBadge');
  el.hidden = !n || !state.ready; el.textContent = String(n); el.title = `${n} thing${n === 1 ? '' : 's'} to fix before exporting`;
}
export function mountHeader() {
  for (const t of TYPES) select('type').add(new Option(PROFILES[t].label, t));
  on('project', fill); on('browse', browse); on('art', badge);
  $('new').onclick = () => task(() => newDraft());
  $('open').onclick = () => input('projectFile').click();
  input('projectFile').onchange = () => task(async () => { const f = input('projectFile').files?.[0]; input('projectFile').value = ''; if (f) await openDraft(await f.text()); });
  $('save').onclick = saveDraft;
  $('type').onchange = () => task(() => changeType(select('type').value as EquipmentType));
  $('name').onchange = () => { snapshot(); state.project.definition.name = input('name').value; badge(); status(`Renamed to “${state.project.definition.name}”.`); };
}
