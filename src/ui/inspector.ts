import { iconFits } from '../icon';
import { $ } from './dom';
import { state, library, type, on, PANELS, type Panel } from './state';
import { iconDefinitionCount } from './render';
import { showPanel } from './actions';
import { layersMarkup, sourceMarkup, placementMarkup, layerActionsMarkup, drawSource } from './panels/artwork';
import { coloursMarkup } from './panels/colours';
import { tiersMarkup } from './panels/tiers';
import { detailsMarkup } from './panels/details';
import { iconMarkup } from './panels/icon';

const TABS: Record<Panel, string> = { artwork: 'Artwork', colours: 'Colours & tiers', settings: 'Details', icon: 'Icon' };
export const inspectorMarkup = `
<aside id="inspector" class="inspector" data-panel="artwork">
  <nav class="inspector-tabs" aria-label="Item editor">${PANELS.map((p, i) => `<button id="${p}Tab" class="${i ? '' : 'selected'}"><span class="step">${i + 1}</span>${TABS[p]}<span class="tab-status" id="${p}Status"></span></button>`).join('')}</nav>
  <div id="draftControls">
    ${tiersMarkup}
    ${layersMarkup}
    <section id="artworkControls" data-tabs="artwork colours">${sourceMarkup}${placementMarkup}${coloursMarkup}${layerActionsMarkup}</section>
    ${detailsMarkup}
    ${iconMarkup}
  </div>
</aside>`;

// ✓ done, ! needs attention, nothing when optional or not started.
function marks() {
  const d = state.project.definition, projectile = type() === 'projectile', fits = iconFits(d._id, iconDefinitionCount());
  const idTaken = !state.project.replaceExisting && library.defs.some(x => x._id === d._id);
  const coloured = !!state.project.material?.tier || Object.values(state.project.sourceParts).some(s => s?.replacements?.length || s?.tint);
  const status: Record<Panel, '' | 'ok' | 'bad'> = {
    artwork: state.renderError ? 'bad' : projectile || state.strips.size ? 'ok' : '',
    colours: coloured ? 'ok' : '',
    settings: !d.name.trim() || idTaken ? 'bad' : 'ok',
    icon: projectile ? '' : state.iconArt ? (fits ? 'ok' : 'bad') : state.strips.size ? 'bad' : '',
  };
  for (const p of PANELS) { const el = $(`${p}Status`); el.className = `tab-status ${status[p]}`; el.textContent = status[p] === 'ok' ? '✓' : status[p] === 'bad' ? '!' : ''; el.title = status[p] === 'bad' ? 'Needs attention' : ''; }
}
function panel() {
  const p = state.panel;
  $('inspector').dataset.panel = p;
  for (const other of PANELS) $(`${other}Tab`).classList.toggle('selected', other === p);
  for (const el of document.querySelectorAll<HTMLElement>('#inspector [data-tabs]')) el.classList.toggle('off-tab', !el.dataset.tabs!.split(' ').includes(p));
  $('setPivot').classList.toggle('selected', state.sourceTool === 'pivot'); $('pickColour').classList.toggle('selected', state.sourceTool === 'colour');
  $('inspector').scrollTop = 0;
  drawSource();
}
export function mountInspector() {
  on('panel', panel); on('art', marks); on('project', marks);
  for (const p of PANELS) $(`${p}Tab`).onclick = () => showPanel(p);
  $('setPivot').onclick = () => showPanel('artwork'); $('pickColour').onclick = () => showPanel('colours');
  panel();
}
