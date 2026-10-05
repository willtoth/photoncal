import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sources } from './native-sources.mjs';

const manifest = JSON.parse(
  await readFile(new URL('../public/engine/manifest.json', import.meta.url)),
);
assert.deepEqual(
  manifest.sources,
  sources.map(([name, url, revision]) => ({ name, url, revision })),
  'Native source pins differ from the committed engine. Rebuild WASM and commit its manifest.',
);
const wasm = await readFile(new URL('../public/engine/photoncal.wasm', import.meta.url));
assert.equal(
  createHash('sha256').update(wasm).digest('hex'),
  manifest.sha256,
  'WASM checksum does not match the committed engine manifest.',
);
console.log('Committed WASM checksum and native source pins verified.');
