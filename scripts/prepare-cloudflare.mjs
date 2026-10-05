import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const assetLimit = 25 * 1024 * 1024;
const archiveName = 'photoncal-source.tar.gz';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function packageSource(archive, output, partSize = 20 * 1024 * 1024) {
  if (!Number.isSafeInteger(partSize) || partSize < 1 || partSize > assetLimit)
    throw new Error('Source parts must fit the Cloudflare asset limit.');
  await mkdir(output, { recursive: true });
  const hash = createHash('sha256');
  const parts = [];
  let size = 0;
  for await (const bytes of createReadStream(archive, { highWaterMark: partSize })) {
    const digest = sha256(bytes);
    const file = `${archiveName}.${String(parts.length).padStart(3, '0')}.${digest}.part`;
    await writeFile(path.join(output, file), bytes);
    parts.push({ file, size: bytes.length, sha256: digest });
    size += bytes.length;
    hash.update(bytes);
  }
  if (!size) throw new Error('The corresponding-source archive is empty.');
  const manifest = { filename: archiveName, size, sha256: hash.digest('hex'), parts };
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(output, 'SHA256SUMS'), `${manifest.sha256}  ${archiveName}\n`);
  const links = parts
    .map(({ file, size }) => `<li><a href="${file}" download>${file}</a> (${size} bytes)</li>`)
    .join('\n');
  const template = await readFile(
    path.join(root, 'scripts/templates/source-download.html'),
    'utf8',
  );
  await writeFile(
    path.join(output, 'index.html'),
    template
      .replaceAll('{{SIZE}}', (size / 1024 / 1024).toFixed(1))
      .replaceAll('{{SHA256}}', manifest.sha256)
      .replace('{{LINKS}}', links),
  );
  await cp(
    path.join(root, 'scripts/templates/source-download.js'),
    path.join(output, 'download.js'),
  );
  return manifest;
}

export async function verifyAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await verifyAssets(file);
    else if ((await stat(file)).size > assetLimit)
      throw new Error(`Cloudflare asset exceeds 25 MiB: ${file}`);
  }
}

async function main() {
  const dist = path.join(root, 'dist');
  const archive = path.join(dist, 'source', archiveName);
  // Fail before touching the previous generated deployment if the archive is missing.
  await stat(archive);
  const output = path.join(root, '.build/cloudflare');
  // This is exclusively the generated staging directory, never public/ or the source archive.
  await rm(output, { recursive: true, force: true });
  await cp(dist, output, { recursive: true, filter: (file) => file !== archive });
  const manifest = await packageSource(archive, path.join(output, 'source'));
  // Keep the application's source link valid; no source content is omitted.
  const redirects = path.join(output, '_redirects');
  let existing = '';
  try {
    existing = await readFile(redirects, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(redirects, existing + '\n/source/photoncal-source.tar.gz /source/ 302\n');
  await verifyAssets(output);
  console.log(`Cloudflare assets ready: ${output}`);
  console.log(
    `Complete corresponding source: ${manifest.parts.length} parts, SHA-256 ${manifest.sha256}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  await main();
