import { extractPalette, groupPalette, validateColorReplacements, type ColorReplacement, type ColourGroup } from '../../palette';
import { canvas } from '../../artwork';
import { $, h, input, number, plural } from '../dom';
import { state, source, snapshot, status, task, on, emit } from '../state';
import { rebuild } from '../render';
import { addMaterial, reapplyTier, removeMaterial, tierById } from '../materials';

export const coloursMarkup = `
<details id="colours" open data-tabs="colours"><summary>Colour replacement <span class="badge">this layer</span></summary>
  <div id="palette"></div>
  <label class="group-strength">Group shades <input id="groupStrength" type="range" min="0" max="60" value="20"></label>
  <small>Select a group to recolour all its shades, open it (▾) for single colours, or use Pick colour on the source. ◆ marks a group as the material that tiers recolour.</small>
  <div class="two"><label>From<span id="fromGroup" class="ramp" hidden></span><input id="replaceFrom" type="color" value="#808080"></label><label>To<input id="replaceTo" type="color" value="#c76035"></label></div>
  <label>Match nearby shades <input id="colourTolerance" type="range" min="0" max="100" value="10"><span id="toleranceValue">10</span></label>
  <label><input id="keepShading" type="checkbox" checked> Keep shading</label>
  <label id="reshadeControl" hidden>Reshade <input id="reshade" type="range" min="0" max="100" value="50"><span id="reshadeValue">50</span><small>Shadows turn cooler and richer, highlights warmer and paler. 0 keeps a plain lightness ramp.</small></label>
  <button id="applyColour" class="wide">Apply replacement</button>
  <div id="colourRules"></div>
  <details><summary>Tint entire layer</summary><small>A tint overrides the tier colours of this layer.</small><div class="two tint"><label>Colour <input id="tint" type="color" value="#e85d36"></label><button id="clearTint">Clear tint</button></div></details>
</details>`;

export const ramp = (colours: readonly string[], max = 12) => {
  const el = h('span', { class: 'ramp' }), step = Math.max(1, colours.length / max);
  for (let i = 0; i < colours.length; i += step) el.append(h('span', { style: { backgroundColor: colours[Math.floor(i)] } }));
  return el;
};
const sameGroup = (a?: string[], b?: string[]) => !!a && !!b && a.length === b.length && a.every((c, i) => c.toLowerCase() === b[i].toLowerCase());

export function showSelection() {
  const group = state.colourGroup;
  $('fromGroup').hidden = !group; input('replaceFrom').hidden = !!group;
  if (group) $('fromGroup').replaceChildren(...ramp(group, 16).childNodes);
  $('reshadeControl').hidden = !group || !input('keepShading').checked; $('reshadeValue').textContent = input('reshade').value;
  $('applyColour').textContent = group ? `Recolour ${plural(group.length, 'shade')}` : 'Apply replacement';
  for (const [i, row] of Array.from(document.querySelectorAll<HTMLElement>('#palette .colour-group')).entries()) row.classList.toggle('selected', sameGroup(state.colourGroups[i]?.colours.map(c => c.hex), group));
  $('toleranceValue').textContent = input('colourTolerance').value;
}
function useRule(rule?: ColorReplacement) {
  if (rule) { input('replaceTo').value = rule.to; input('colourTolerance').value = String(rule.tolerance); input('keepShading').checked = rule.preserveShading; input('reshade').value = String(rule.reshade ?? 50); }
}
export function chooseColour(hex: string) {
  state.colourGroup = undefined; input('replaceFrom').value = hex;
  useRule(source()?.replacements?.find(r => !r.colours && r.from.toLowerCase() === hex.toLowerCase()));
  showSelection();
}
export function chooseGroup(group: ColourGroup | string[]) {
  const colours = Array.isArray(group) ? group : group.colours.map(c => c.hex), existing = source()?.replacements?.find(r => !r.tier && sameGroup(r.colours, colours));
  state.colourGroup = colours; input('replaceFrom').value = Array.isArray(group) ? existing?.from ?? colours[0] : group.hex;
  if (existing) useRule(existing); else { input('colourTolerance').value = '5'; input('keepShading').checked = true; input('reshade').value = '50'; }
  showSelection();
}
function ruleRow(rule: ColorReplacement, i: number, rules: ColorReplacement[]) {
  const enabled = h('input', { type: 'checkbox', checked: rule.enabled !== false, 'aria-label': `Enable replacement ${i + 1}`, onchange: () => { snapshot(); rule.enabled = enabled.checked; rebuild(); } });
  const tier = rule.tier ? tierById(rule.tier) : undefined;
  const edit = h('button', { class: 'rule-edit', title: rule.tier ? 'Tier colours: change the tier above' : 'Edit this replacement', onclick: () => { if (rule.tier) return; if (rule.colours) chooseGroup(rule.colours); else chooseColour(rule.from); } },
    rule.colours ? ramp(rule.colours, 6) : h('span', { class: 'rule-swatch', style: { backgroundColor: rule.from } }),
    rule.map ? ramp(rule.map, 6) : h('span', { class: 'rule-swatch', style: { backgroundColor: rule.to } }),
    h('small', { text: rule.tier ? `${tier?.label ?? rule.tier} tier · ${plural(rule.colours!.length, 'shade')}` : rule.colours ? `${rule.colours.length} shades → ${rule.to}` : `${rule.from} → ${rule.to}` }));
  const remove = h('button', { text: '×', title: 'Remove replacement', onclick: () => { snapshot(); rules.splice(i, 1); fill(); rebuild(); } });
  return h('div', { class: 'colour-rule' }, enabled, edit, remove);
}
function fill() {
  $('palette').replaceChildren(); $('colourRules').replaceChildren();
  const s = source(), img = state.images.get(state.selected); if (!s || !img) return;
  const c = canvas(img.width, img.height); c.getContext('2d')!.drawImage(img, 0, 0);
  const palette = extractPalette(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, 256), total = palette.reduce((n, p) => n + p.count, 0);
  const material = new Set(state.project.material?.colours[state.selected] ?? []);
  state.colourGroups = groupPalette(palette, number('groupStrength'));
  for (const [gi, group] of state.colourGroups.entries()) {
    const isMaterial = group.colours.some(c => material.has(c.hex));
    const pick = h('button', { class: 'group-pick', title: `Select these ${group.colours.length} shades`, 'aria-label': `Select ${group.hex} group: ${group.colours.length} shades`, onclick: () => chooseGroup(group) },
      ramp(group.colours.map(c => c.hex)), h('small', { text: `${plural(group.colours.length, 'shade')} · ${Math.round(group.count / total * 100)}%${isMaterial ? ' · material' : ''}` }));
    const inMaterial = group.colours.every(c => material.has(c.hex));
    const mark = h('button', { class: `group-material${inMaterial ? ' on' : ''}`, text: '◆', title: inMaterial ? 'Material: click to exclude these shades from tiers' : 'Mark these shades as the item’s material, so tiers recolour them', 'aria-label': `${inMaterial ? 'Unmark' : 'Mark'} ${group.hex} group as material`, 'aria-pressed': String(inMaterial),
      onclick: () => { snapshot(); const hexes = group.colours.map(c => c.hex); if (inMaterial) removeMaterial(state.selected, hexes); else addMaterial(state.selected, hexes); reapplyTier(); emit('project'); rebuild(); status(inMaterial ? 'Shades removed from the material.' : `Marked ${plural(hexes.length, 'shade')} as material. Pick a tier above.`); } });
    const more = h('button', { class: 'group-open', text: state.openGroup === gi ? '▴' : '▾', title: 'Show individual colours', 'aria-label': `Show colours in ${group.hex} group`, onclick: () => { state.openGroup = state.openGroup === gi ? -1 : gi; fill(); } });
    $('palette').append(h('div', { class: `colour-group${isMaterial ? ' material' : ''}` }, pick, mark, more));
    if (state.openGroup === gi) $('palette').append(h('div', { class: 'group-swatches' }, ...group.colours.map(colour => h('button', { class: 'swatch', style: { backgroundColor: colour.hex }, title: `${colour.hex} · ${colour.count} pixels`, 'aria-label': `Select ${colour.hex}`, onclick: () => chooseColour(colour.hex) }))));
  }
  const rules = s.replacements || [];
  $('colourRules').append(...rules.map((rule, i) => ruleRow(rule, i, rules)));
  input('tint').value = s.tint || '#e85d36';
  showSelection();
}

export function mountColours() {
  on('project', fill);
  $('colourTolerance').oninput = () => { $('toleranceValue').textContent = input('colourTolerance').value; };
  $('applyColour').onclick = () => task(async () => {
    const s = source(); if (!s) return;
    const group = state.colourGroup, rule: ColorReplacement = { from: input('replaceFrom').value, to: input('replaceTo').value, tolerance: number('colourTolerance'), preserveShading: input('keepShading').checked, enabled: true, ...(group ? { colours: group, reshade: number('reshade') } : {}) };
    const rules = [...(s.replacements || [])], i = rules.findIndex(r => !r.tier && (group ? sameGroup(r.colours, group) : !r.colours && r.from.toLowerCase() === rule.from.toLowerCase()));
    // Hand-made rules go before tier rules so an exact match of theirs wins.
    if (i >= 0) rules[i] = rule; else { const t = rules.findIndex(r => r.tier); rules.splice(t < 0 ? rules.length : t, 0, rule); }
    const valid = validateColorReplacements(rules); snapshot(); s.replacements = valid; fill(); rebuild();
    status(group ? `Recoloured ${group.length} shades, keeping their shading.` : 'Colour replacement applied to this layer.');
  });
  $('groupStrength').oninput = () => { state.colourGroup = undefined; state.openGroup = -1; fill(); };
  $('replaceFrom').oninput = () => { state.colourGroup = undefined; showSelection(); };
  $('reshade').oninput = showSelection; $('keepShading').onchange = showSelection;
  $('tint').onchange = () => { const s = source(); if (s) { snapshot(); s.tint = input('tint').value; rebuild(); } };
  $('clearTint').onclick = () => { const s = source(); if (s) { snapshot(); delete s.tint; rebuild(); } };
}
