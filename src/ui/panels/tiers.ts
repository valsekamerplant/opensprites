import { activeParts } from '../../model';
import { isNativeTier, validateCustomTiers, customTier, type Tier } from '../../tiers';
import { $, h, input, select, download, plural } from '../dom';
import { state, snapshot, status, task, on, emit } from '../state';
import { rebuild } from '../render';
import { restore } from '../actions';
import { applyTier, clearMaterial, customTiers, freeIds, hasMaterial, material, removeCustomTier, saveCustomTier, tierById, tierDraft, tierPreviews, tierZip, tiers } from '../materials';
import { ramp } from './colours';

export const tiersMarkup = `
<section id="tierSection" data-tabs="colours">
  <h2>Material tier</h2>
  <p id="tierNote" class="muted"></p>
  <div id="tierGrid" class="tier-grid"></div>
  <button id="clearMaterial" class="wide" title="Forget the material and remove tier colours">Clear material</button>
  <div class="tier-actions"><label>Make a variant<select id="duplicateTier" aria-label="Tier for the new variant"></select></label><button id="duplicate" title="New draft of this item in the chosen tier, with the next free item ID">Duplicate as tier</button></div>
  <button id="tierZip" class="wide" title="Layer PNGs, icon and an editable draft for every tier">Download every tier (PNGs + drafts)</button>
  <details id="customTiers"><summary>Custom tiers</summary>
    <small>Your own tier colour. Its ramp is shaded like the game’s tiers and saved in this browser and in drafts that use it.</small>
    <div class="two"><label>Name<input id="customName" placeholder="Mithril" maxlength="40"></label><label>Colour<input id="customBase" type="color" value="#5a8fd0"></label></div>
    <label>Reshade <input id="customReshade" type="range" min="0" max="100" value="40"><span id="customReshadeValue">40</span></label>
    <button id="addCustomTier" class="wide">Add tier</button>
    <div id="customList"></div>
    <div class="two"><button id="exportTiers">Export tiers</button><button id="importTiers">Import tiers</button></div>
    <input id="tierFile" type="file" accept=".json,application/json" hidden>
  </details>
</section>`;

function note() {
  const m = material();
  if (!hasMaterial()) return 'Choose the material first: under Colour replacement below, press ◆ beside each colour group of the metal (or cloth…). Clones of the game’s tier items are detected for you.';
  const parts = activeParts(state.project.definition).filter(p => m!.colours[p.key]?.length).map(p => `${plural(m!.colours[p.key]!.length, 'shade')} on ${p.label.toLowerCase()}`);
  const from = m!.from && tierById(m!.from);
  return `Material: ${parts.join(', ')}${from ? ` · drawn as ${from.label}` : ''}. Click a tier to recolour the item, its icon included.`;
}
let pending = 0;
/** Tier cards with a live preview of the current frame (redrawn once per animation frame). */
function grid() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    if (state.panel !== 'colours') return;
    const current = material()?.tier ?? material()?.from, previews = new Map(tierPreviews(state.pose).map(p => [p.tier.id, p.canvas]));
    $('tierGrid').replaceChildren(...tiers().map(tier => {
      const preview = previews.get(tier.id);
      return h('button', { class: `tier-card${tier.id === current ? ' selected' : ''}`, dataset: { tier: tier.id }, title: `Show this item in ${tier.label}`, 'aria-pressed': String(tier.id === current), onclick: () => choose(tier) },
        preview ?? h('span', { class: 'tier-empty' }), h('strong', { text: tier.label }), ramp(tier.ramp, 8));
    }));
    $('tierNote').textContent = note();
    $('clearMaterial').toggleAttribute('disabled', !hasMaterial());
    for (const id of ['duplicate', 'tierZip', 'duplicateTier']) $(id).toggleAttribute('disabled', !hasMaterial());
    const options = tiers().filter(t => t.id !== current);
    const keep = select('duplicateTier').value;
    select('duplicateTier').replaceChildren(...options.map(t => new Option(t.label, t.id)));
    if (options.some(t => t.id === keep)) select('duplicateTier').value = keep;
  });
}
function choose(tier: Tier) {
  if (!hasMaterial()) { status('Choose the material first: press ◆ beside its colour groups below.', true); return; }
  snapshot(); applyTier(tier); emit('project'); rebuild();
  status(`${state.project.definition.name}: ${tier.label} colours applied. Undo to go back.`);
}
function customList() {
  $('customList').replaceChildren(...customTiers().map(t => h('div', { class: 'custom-tier' }, ramp(customTier(t).ramp, 8), h('span', { text: t.label }),
    h('button', { text: '×', title: `Remove ${t.label}`, 'aria-label': `Remove ${t.label}`, onclick: () => { removeCustomTier(t.id); customList(); grid(); } }))));
}
function slug(label: string) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'tier', taken = new Set(tiers().map(t => t.id));
  let id = isNativeTier(base) ? `${base}-2` : base, n = 2;
  while (taken.has(id) && !customTiers().some(t => t.id === id && t.label === label)) id = `${base}-${++n}`;
  return id;
}

export function mountTiers() {
  on('project', () => { customList(); grid(); }); on('art', grid); on('pose', grid); on('panel', grid);
  $('clearMaterial').onclick = () => { snapshot(); clearMaterial(); emit('project'); rebuild(); status('Material cleared; tier colours removed.'); };
  $('duplicate').onclick = () => task(async () => {
    const tier = tierById(select('duplicateTier').value); if (!tier) return;
    const [id] = freeIds(1), was = state.project.definition.name;
    snapshot(); await restore(tierDraft(tier, id));
    status(`Created ${state.project.definition.name} (#${id}). “${was}” is one Undo away: save or export it too.`);
  });
  $('tierZip').onclick = () => task(() => { download(`${state.project.definition.name.replace(/[^a-z0-9_-]/gi, '-')}-tiers.zip`, tierZip()); status(`Downloaded ${plural(tiers().length, 'tier')} with layer PNGs, icons and drafts.`); });
  $('customReshade').oninput = () => { $('customReshadeValue').textContent = input('customReshade').value; };
  $('addCustomTier').onclick = () => task(() => {
    const label = input('customName').value.trim(); if (!label) { status('Name the tier first.', true); return; }
    const [tier] = validateCustomTiers([{ id: slug(label), label, base: input('customBase').value, reshade: Number(input('customReshade').value) }]);
    saveCustomTier(tier); input('customName').value = ''; customList(); grid(); status(`Added the ${tier.label} tier.`);
  });
  $('exportTiers').onclick = () => download('openspell-tiers.json', JSON.stringify(customTiers(), null, 2));
  $('importTiers').onclick = () => input('tierFile').click();
  input('tierFile').onchange = () => task(async () => {
    const f = input('tierFile').files?.[0]; input('tierFile').value = ''; if (!f) return;
    const list = validateCustomTiers(JSON.parse(await f.text())); for (const t of list) saveCustomTier(t);
    customList(); grid(); status(`Imported ${plural(list.length, 'custom tier')}.`);
  });
}
