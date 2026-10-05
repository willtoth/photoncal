import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { packageSource, verifyAssets } from '../../scripts/prepare-cloudflare.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(
  t,
  bytes = Buffer.from('complete source archive including all dependencies'),
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photoncal-package-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'input.tar.gz');
  await writeFile(archive, bytes);
  return { archive, output: path.join(directory, 'output'), bytes };
}

test('source parts reassemble byte-for-byte and every hash and link matches', async (t) => {
  const { archive, output, bytes } = await fixture(t);
  const manifest = await packageSource(archive, output, 9);
  assert.equal(manifest.size, bytes.length);
  assert.equal(manifest.sha256, hash(bytes));
  assert.equal(manifest.parts.length, Math.ceil(bytes.length / 9));
  const chunks = [];
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  for (const part of manifest.parts) {
    const chunk = await readFile(path.join(output, part.file));
    assert.equal(chunk.length, part.size);
    assert.ok(chunk.length <= 9);
    assert.equal(hash(chunk), part.sha256);
    assert.ok(html.includes(`href="${part.file}"`));
    chunks.push(chunk);
  }
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, 'manifest.json'))), manifest);
  assert.equal(
    await readFile(path.join(output, 'SHA256SUMS'), 'utf8'),
    `${hash(bytes)}  photoncal-source.tar.gz\n`,
  );
  assert.ok(html.includes(hash(bytes)));
  assert.ok(!html.includes('{{'));
  assert.ok((await readFile(path.join(output, 'download.js'), 'utf8')).includes('crypto.subtle'));
  await verifyAssets(output);
});

test('empty archives and invalid or oversized parts fail before deployment', async (t) => {
  const { archive, output } = await fixture(t, Buffer.alloc(0));
  await assert.rejects(packageSource(archive, output), /empty/);
  for (const size of [0, -1, 0.5, 25 * 1024 * 1024 + 1])
    await assert.rejects(packageSource(archive, output, size), /asset limit/);
});

test('the full asset tree is checked against the host limit', async (t) => {
  const { archive, output } = await fixture(t);
  await packageSource(archive, output);
  await writeFile(path.join(output, 'oversized.bin'), Buffer.alloc(25 * 1024 * 1024 + 1));
  await assert.rejects(verifyAssets(output), /exceeds 25 MiB/);
});
