import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const base = new URL(process.argv[2] || 'https://photoncal.pages.dev');
const local = new URL('../.build/cloudflare/', import.meta.url);
const expected = JSON.parse(await readFile(new URL('source/manifest.json', local)));
const engine = JSON.parse(await readFile(new URL('engine/manifest.json', local)));
async function get(file, options = {}) {
  const response = await fetch(new URL(file, base), {
    signal: AbortSignal.timeout(20_000),
    ...options,
  });
  assert.equal(response.status, 200, `${file}: HTTP ${response.status}`);
  return response;
}
async function verify() {
  const index = await get('/');
  assert.match(await index.text(), /PhotonCal/);
  const manifest = await (await get('/source/manifest.json')).json();
  assert.deepEqual(manifest, expected, 'Published source manifest differs from this build.');
  const wasm = await get('/engine/photoncal.wasm');
  assert.match(wasm.headers.get('content-type') ?? '', /^application\/wasm/);
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await wasm.arrayBuffer()))
      .digest('hex'),
    engine.sha256,
  );
  const sourcePage = await get('/source/photoncal-source.tar.gz');
  assert.equal(new URL(sourcePage.url).pathname, '/source/');
  assert.match(await sourcePage.text(), /PhotonCal source code/);
  for (const part of expected.parts) {
    const response = await get(`/source/${part.file}`, { method: 'HEAD' });
    assert.match(response.headers.get('content-type') ?? '', /^application\/octet-stream/);
  }
}
for (let attempt = 1; ; attempt++) {
  try {
    await verify();
    console.log(
      `Published site, WASM, and ${expected.parts.length} source parts verified at ${base.origin}`,
    );
    break;
  } catch (error) {
    if (attempt === 4) throw error;
    console.warn(`Deployment verification attempt ${attempt} failed: ${error.message}`);
    await setTimeout(5000);
  }
}
