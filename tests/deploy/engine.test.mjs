import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photoncal-engine-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts'), { recursive: true });
  await mkdir(path.join(directory, 'public/engine'), { recursive: true });
  for (const file of [
    'scripts/verify-engine.mjs',
    'scripts/native-sources.mjs',
    'public/engine/manifest.json',
    'public/engine/photoncal.wasm',
  ])
    await cp(file, path.join(directory, file));
  const verify = () =>
    execFileSync(process.execPath, [path.join(directory, 'scripts/verify-engine.mjs')], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  return { directory, verify };
}

test('committed WASM matches its source pins and checksum', async (t) => {
  const { verify } = await fixture(t);
  assert.match(verify(), /verified/);
});

test('a modified WASM binary is rejected', async (t) => {
  const { directory, verify } = await fixture(t);
  await writeFile(path.join(directory, 'public/engine/photoncal.wasm'), 'incorrect engine');
  assert.throws(verify, /WASM checksum does not match/);
});

test('source pins that do not match the compiled engine are rejected', async (t) => {
  const { directory, verify } = await fixture(t);
  const file = path.join(directory, 'public/engine/manifest.json');
  const manifest = JSON.parse(await readFile(file));
  manifest.sources[0].revision = '0'.repeat(40);
  await writeFile(file, JSON.stringify(manifest));
  assert.throws(verify, /Native source pins differ/);
});
