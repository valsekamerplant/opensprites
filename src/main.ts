import './style.css';
import { lowestFreeId } from './model';
import { $ } from './ui/dom';
import { state, library, status, task, emit } from './ui/state';
import { refresh, maskReady } from './ui/actions';
import { headerMarkup, mountHeader } from './ui/header';
import { libraryMarkup, mountLibrary } from './ui/library-panel';
import { stageMarkup, mountStage } from './ui/stage';
import { inspectorMarkup, mountInspector } from './ui/inspector';
import { mountArtwork } from './ui/panels/artwork';
import { mountColours } from './ui/panels/colours';
import { mountTiers } from './ui/panels/tiers';
import { mountDetails } from './ui/panels/details';
import { mountIcon } from './ui/panels/icon';
import { exportMarkup, mountExport } from './ui/export-dialog';

$('app').innerHTML = `${headerMarkup}<main>${libraryMarkup}${stageMarkup}${inspectorMarkup}</main>
<footer><span id="status" role="status">Loading the bundled game library…</span><span id="target"></span></footer>
${exportMarkup}
<input id="pngFile" type="file" accept="image/png" hidden><input id="iconFile" type="file" accept="image/png" hidden><input id="projectFile" type="file" accept=".json" hidden><input id="carbonFiles" type="file" accept=".carbon,.json" multiple hidden><input id="folder" type="file" webkitdirectory multiple hidden>`;

for (const mount of [mountHeader, mountLibrary, mountStage, mountInspector, mountArtwork, mountColours, mountTiers, mountDetails, mountIcon, mountExport]) mount();
refresh();

task(async () => {
  await Promise.all([library.bundled(), maskReady]);
  // The first draft was created before the definitions loaded; give it a real free ID.
  if (!state.project.replaceExisting && library.defs.some(d => d._id === state.project.definition._id)) state.project.definition._id = lowestFreeId(library.defs);
  state.ready = true; emit('library'); refresh();
  status('Ready. Start from a game item, or upload your own PNG. Carbon imports are optional.');
});
