import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// The studio is hosted in a sub-folder (e.g. /opensprites/): bundled files must load relative
// to the page, never from the site root.
test('bundled assets load relative to where the studio is hosted', async () => {
  assert.match(await readFile('vite.config.ts', 'utf8'), /base:\s*'\.\/'/);
  const sources = (await readdir('src', { recursive: true })).filter(f => /\.ts$/.test(f));
  for (const f of sources) {
    const text = await readFile(`src/${f}`, 'utf8');
    assert.doesNotMatch(text, /(fetch|loadImage)\(\s*[`'"]\//, `${f} loads a root-absolute URL`);
  }
});
