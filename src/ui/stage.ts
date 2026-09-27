import { DIRECTIONS } from '../model';
import { canvas } from '../artwork';
import { $, h, input, fileData } from './dom';
import { state, type, profile, source, snapshot, status, task, on, emit, hasArtwork } from './state';
import { drawPose, editPose, currentPose, effectiveDefinition } from './render';
import { browse, openDraft, redo, setSource, undo } from './actions';
import { cloneSelection, editSelection } from './library-panel';

const HELP = 'Drag to move · Scroll to rotate · Ctrl+scroll to resize · Shift+scroll to skew · Arrows nudge · [ ] rotate · Space walks · Ctrl+Z undoes';
export const stageMarkup = `
<section class="workspace">
  <div class="stagebar"><span id="poseLabel"></span><div>
    <button id="undo" title="Undo (Ctrl+Z)">Undo</button><button id="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
    <label title="Show the character’s body"><input id="character" type="checkbox" checked> Body</label>
    <label title="Show the grip point / pivot guide (never exported)"><input id="guidesToggle" type="checkbox" checked> Pivot</label>
    <button id="play" title="Play the walk cycle (Space)">▶ Walk</button></div></div>
  <div id="libraryNotice" class="banner" hidden>
    <div><small>Previewing a game item: your draft is kept</small><strong id="browseName"></strong></div>
    <div class="banner-actions"><button id="bannerClone" class="primary" title="Copy it as a new item with a new ID">Clone as new</button><button id="bannerEdit" title="Change the existing item and its artwork">Edit original</button><button id="backToDraft">Back to my draft</button></div>
  </div>
  <div id="stage">
    <div class="canvas-stack"><canvas id="preview" width="64" height="128" aria-label="Equipped item preview"></canvas>
      <svg id="guides" viewBox="0 0 64 128" aria-hidden="true"><g id="pivotMarker"><circle r="1.3"/><path d="M-3 0H3M0-3V3"/><text x="3" y="-2">PIVOT</text></g></svg></div>
    <div id="start" class="start" hidden>
      <h2>Make an item</h2>
      <button id="startLibrary" class="start-card"><strong>Start from a game item</strong><span>Pick one on the left, then Clone. Best for armour and for tier variants.</span></button>
      <button id="startUpload" class="start-card"><strong>Upload a PNG</strong><span>One upright sprite (e.g. a spear) or a finished 64×128 frame strip.</span></button>
      <button id="startOpen" class="start-card"><strong>Open a saved draft</strong><span>Continue where you left off.</span></button>
      <small>Or drop a PNG or draft anywhere.</small>
    </div>
    <div id="dropHint" hidden>Drop a PNG for the selected layer, or a draft .json</div>
  </div>
  <div class="canvas-help" id="canvasHelp">${HELP}</div>
  <div id="frames"></div>
  <details class="outfit"><summary>Try with other equipment</summary><div id="outfit"></div></details>
</section>`;

function drawGuides() {
  const s = source(); $('guides').toggleAttribute('hidden', !!state.browsing || !s || !state.images.has(state.selected) || !input('guidesToggle').checked);
  const p = currentPose(), x = p.x + (s?.mode === 'strip' ? s.anchor.x : 0), y = p.y + (s?.mode === 'strip' ? s.anchor.y : 0);
  $('pivotMarker').setAttribute('transform', `translate(${x} ${y}) rotate(${p.rotation})`);
  $('pivotMarker').querySelector('text')!.textContent = type() === 'weapon' ? 'GRIP' : 'PIVOT';
}
let renderedPose = -1;
function render() {
  const b = state.browsing; renderedPose = state.pose;
  drawPose($<HTMLCanvasElement>('preview'), state.pose);
  for (let i = 0; i < 15; i++) { drawPose($<HTMLCanvasElement>(`frame-${i}`), i); document.querySelector(`[data-pose="${i}"]`)?.classList.toggle('selected', i === state.pose); }
  $('poseLabel').textContent = `${b ? 'Library · ' : ''}${DIRECTIONS[Math.floor(state.pose / 3)]} · frame ${state.pose % 3 + 1}`;
  $('start').hidden = !!b || hasArtwork() || Object.keys(state.project.sourceParts).length > 0 || type() === 'projectile';
  $('libraryNotice').hidden = !b; $('browseName').textContent = b ? `${b.name} #${b._id}` : '';
  $('inspector').toggleAttribute('inert', !!b); $('inspector').classList.toggle('dimmed', !!b);
  $('preview').classList.toggle('read-only', !!b);
  $('canvasHelp').textContent = b ? 'Library preview: clone it or edit the original to make changes.' : HELP;
  $('undo').toggleAttribute('disabled', !state.history.length); $('redo').toggleAttribute('disabled', !state.future.length);
  $('target').textContent = type() === 'projectile' ? 'Metadata only' : `${profile().frames} frames · ${profile().sheet} #${effectiveDefinition().equipmentSpriteId} · ${state.project.replaceExisting ? 'replace' : 'append'}`;
  drawGuides();
}
const editable = () => !!source() && !state.browsing;
const typing = (e: Event) => e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable);

async function dropped(files: File[]) {
  const draft = files.find(f => f.name.endsWith('.json')), png = files.find(f => f.type === 'image/png');
  if (draft) await openDraft(await draft.text());
  else if (png) { if (state.browsing) browse(undefined); await setSource(await fileData(png), png.name); }
  else status('Drop a PNG image or a draft .json file.', true);
}

export function mountStage() {
  for (let d = 0; d < 5; d++) {
    const group = h('div', { class: 'direction' }, h('small', { text: DIRECTIONS[d] }));
    for (let f = 0; f < 3; f++) {
      const index = d * 3 + f, c = canvas(64); c.id = `frame-${index}`;
      group.append(h('button', { title: `${DIRECTIONS[d]}, frame ${f + 1}`, dataset: { pose: String(index) }, onclick: () => { state.pose = index; emit('pose'); } }, c));
    }
    $('frames').append(group);
  }
  // An edit re-renders through 'art'; 'pose' only needs a render when the frame changed.
  on('art', render); on('browse', render); on('project', drawGuides); on('pose', () => { if (renderedPose !== state.pose) render(); });

  $('undo').onclick = () => task(undo); $('redo').onclick = () => task(redo);
  $('character').onchange = render; $('guidesToggle').onchange = drawGuides;
  $('play').onclick = () => { state.playing = !state.playing; $('play').textContent = state.playing ? 'Ⅱ Pause' : '▶ Walk'; };
  setInterval(() => { if (state.playing) { state.pose = Math.floor(state.pose / 3) * 3 + (state.pose + 1) % 3; emit('pose'); } }, 220);
  $('backToDraft').onclick = () => browse(undefined);
  $('bannerClone').onclick = cloneSelection; $('bannerEdit').onclick = editSelection;
  $('startLibrary').onclick = () => { $('search').focus(); status(`Pick a ${profile().label.toLowerCase()} on the left to preview it, then Clone item.`); };
  $('startUpload').onclick = () => { state.uploadTarget = state.selected; input('pngFile').click(); };
  $('startOpen').onclick = () => input('projectFile').click();
  input('pngFile').onchange = () => task(async () => { const f = input('pngFile').files?.[0]; if (f) { state.selected = state.uploadTarget ?? state.selected; await setSource(await fileData(f), f.name); } state.uploadTarget = undefined; input('pngFile').value = ''; });

  let drag: { x: number; y: number; px: number; py: number } | undefined;
  const preview = $('preview');
  preview.onpointerdown = e => { if (!editable()) return; snapshot(); const p = currentPose(); drag = { x: e.clientX, y: e.clientY, px: p.x, py: p.y }; preview.setPointerCapture(e.pointerId); };
  preview.onpointermove = e => { if (!drag) return; const r = preview.getBoundingClientRect(); editPose(p => { p.x = Math.round(drag!.px + (e.clientX - drag!.x) * 64 / r.width); p.y = Math.round(drag!.py + (e.clientY - drag!.y) * 128 / r.height); }, false); };
  preview.onpointerup = () => { drag = undefined; }; preview.onpointercancel = () => { drag = undefined; };
  preview.onwheel = e => {
    if (!editable() || !e.deltaY) return; e.preventDefault();
    editPose(p => { if (e.ctrlKey || e.metaKey) { const factor = e.deltaY > 0 ? .95 : 1.05; p.scaleX *= factor; p.scaleY *= factor; } else if (e.shiftKey) p.skewX += e.deltaY > 0 ? 1 : -1; else p.rotation += e.deltaY > 0 ? 5 : -5; });
  };

  document.addEventListener('keydown', e => {
    if (typing(e) || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); task(e.shiftKey ? redo : undo); return; }
    if (mod && key === 'y') { e.preventDefault(); task(redo); return; }
    if (mod || e.altKey) return;
    if (e.key === 'Escape' && state.browsing) { browse(undefined); return; }
    if (e.key === ' ' && !(e.target instanceof HTMLElement && e.target.closest('button, summary, a'))) { e.preventDefault(); $('play').click(); return; }
    if (!editable()) return;
    const step = e.shiftKey ? 5 : 1, nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (nudge[e.key]) { e.preventDefault(); const [dx, dy] = nudge[e.key]; editPose(p => { p.x += dx; p.y += dy; }); }
    else if (e.key === '[' || e.key === ']') { e.preventDefault(); editPose(p => { p.rotation += e.key === ']' ? 5 : -5; }); }
  });

  let depth = 0;
  const files = (e: DragEvent) => Array.from(e.dataTransfer?.items ?? []).some(i => i.kind === 'file');
  window.addEventListener('dragenter', e => { if (files(e)) { depth++; $('dropHint').hidden = false; } });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('dropHint').hidden = true; } });
  window.addEventListener('dragover', e => { if (files(e)) e.preventDefault(); });
  window.addEventListener('drop', e => { e.preventDefault(); depth = 0; $('dropHint').hidden = true; const list = Array.from(e.dataTransfer?.files ?? []); if (list.length) task(() => dropped(list)); });
  window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
}
