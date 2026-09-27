import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Update deliberately: the renderer and asset fixtures must come from one revision.
const revision = '50ab3edf91c1c12468ec2b3ee6d5c380a168f091';
const root = `https://raw.githubusercontent.com/Metsutan/openspell/${revision}/`;
await mkdir('public/game', { recursive: true });
await mkdir('tests/fixtures', { recursive: true });
const paths = {
  'appearance.carbon': 'apps/shared-assets/base/static/carbon/appearance.carbon',
  'itemdefs.carbon': 'apps/shared-assets/base/static/itemdefs.carbon',
  'items.carbon': 'apps/shared-assets/base/static/carbon/items.carbon',
  'LICENSE': 'LICENSE',
};
const hashes = {};
for (const [name, path] of Object.entries(paths)) {
  const response = await fetch(root + path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  const data = await response.text();
  if (name.endsWith('.carbon') && !Array.isArray(JSON.parse(data))) throw new Error(`Invalid ${name}`);
  await writeFile(`public/game/${name}`, data);
  hashes[name] = createHash('sha256').update(data).digest('hex');
}
const client = await (await fetch(root + 'apps/shared-assets/base/js/client/client.61.js')).text();
const start = client.indexOf('    function iU() {');
const end = client.indexOf('    class nU {', start);
if (start < 0 || end < 0) throw new Error('Worker boundaries changed; audit the renderer before updating.');
// Unmodified upstream worker used as an independent pixel-comparison oracle.
await writeFile('tests/fixtures/client-worker.js', `// OpenSpell ${revision}; MIT, see public/game/LICENSE\n${client.slice(start, end)}\niU();\n`);
await writeFile('public/game/provenance.json', JSON.stringify({ repository: 'Metsutan/openspell', revision, hashes }, null, 2));
console.log(`Synced OpenSpell ${revision}`);
