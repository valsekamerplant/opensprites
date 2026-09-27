import { $, input, number } from '../dom';
import { state, type, snapshot, on, emit } from '../state';
import { rebuild } from '../render';

export const detailsMarkup = `
<section id="metadata" data-tabs="settings">
  <h2>Item details</h2>
  <label>Description<textarea id="description" rows="2" placeholder="Examine text"></textarea></label>
  <div class="two"><label>Item ID<input id="itemId" type="number" min="0"></label><label>Cost<input id="cost" type="number" min="0"></label><label>Weight<input id="weight" type="number" min="0" step="0.1"></label><label id="speedLabel" title="Attack delay; longswords use 5, battleaxes 6">Weapon speed<input id="weaponSpeed" type="number" min="1"></label></div>
  <small id="idNote"></small>
  <label><input id="hides" type="checkbox"> Hide clothing / hair underneath</label><small id="hideNote"></small>
  <label><input id="tradeable" type="checkbox"> Tradeable</label>
  <details><summary>Native sprite</summary><p id="nativeModeNote" class="muted"></p><label>Sprite ID<input id="spriteId" type="number" min="0"></label><small>Trims follow the trim layers.</small></details>
</section>`;

const FIELDS = [['description', 'description'], ['itemId', '_id'], ['cost', 'cost'], ['weight', 'weight'], ['spriteId', 'equipmentSpriteId'], ['weaponSpeed', 'weaponSpeed']] as const;
function fill() {
  const p = state.project, def = p.definition;
  for (const [id, key] of FIELDS) input(id).value = String(def[key] ?? '');
  input('hides').checked = !!def.hidesSpritesUnderneath; input('tradeable').checked = !!def.isTradeable;
  input('itemId').disabled = p.replaceExisting; input('spriteId').disabled = !p.replaceExisting; $('speedLabel').hidden = type() !== 'weapon';
  $('idNote').textContent = p.replaceExisting ? 'Editing an original keeps its ID.' : 'New items take the lowest free ID so the game can show their icon.';
  $('nativeModeNote').textContent = p.replaceExisting ? 'Export replaces this original item and its shared artwork.' : 'Export appends new artwork. Existing items stay unchanged.';
  $('hideNote').textContent = type() === 'legs' ? 'The current client still draws base pants; this flag is stored but not applied to legs.' : type() === 'helmet' ? 'Hides hair and beard.' : type() === 'chest' ? 'Hides the base shirt.' : 'Only chest and helmet use this flag in the current renderer.';
}
export function mountDetails() {
  on('project', fill);
  for (const [id, key] of FIELDS) $(id).onchange = () => { snapshot(); state.project.definition[key] = id === 'description' ? input(id).value : number(id); emit('project'); rebuild(); };
  $('hides').onchange = () => { snapshot(); state.project.definition.hidesSpritesUnderneath = input('hides').checked; rebuild(); };
  $('tradeable').onchange = () => { snapshot(); state.project.definition.isTradeable = input('tradeable').checked; };
}
