import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const nativeFiles = [
  'LICENSE',
  'THIRD_PARTY.md',
  'licenses/LGPL-2.1.txt',
  'licenses/LGPL-3.txt',
  'licenses/EMSCRIPTEN.txt',
  'licenses/JSON-MIT.txt',
  '.deps/mrcal/LICENSE',
  '.deps/mrcal/minimath/LICENSE',
  '.deps/libdogleg/LICENSE',
  '.deps/mrcal-java/LICENSE',
  '.deps/opencv/LICENSE',
  '.deps/opencv/doc/LICENSE_BSD.txt',
  '.deps/opencv/modules/core/3rdparty/SoftFloat/COPYING.txt',
  '.deps/opencv/3rdparty/zlib/LICENSE',
  '.deps/suitesparse/LICENSE.txt',
  '.deps/suitesparse/CHOLMOD/Doc/License.txt',
  '.deps/suitesparse/AMD/Doc/License.txt',
  '.deps/suitesparse/COLAMD/Doc/License.txt',
  '.deps/openblas/LICENSE',
  '.deps/openblas/lapack-netlib/LICENSE',
  '.deps/eigen/COPYING.MPL2',
  '.deps/eigen/COPYING.BSD',
  '.deps/eigen/COPYING.LGPL',
  '.deps/eigen/COPYING.MINPACK',
];
let output =
  'PhotonCal — third-party notices. See the accompanying source archive for original per-file notices.\n';
async function append(file) {
  output += `\n\n========== ${file} ==========\n\n${await readFile(path.join(root, file), 'utf8')}`;
}
for (const file of nativeFiles) await append(file);
for (const file of ['.deps/mrcal/opencv.c', '.deps/json.hpp']) {
  // Preserve the embedded legacy OpenCV BSD and nlohmann MIT header notices.
  const source = await readFile(path.join(root, file), 'utf8');
  output += `\n\n========== ${file}: header ==========\n\n${source
    .split('\n')
    .slice(0, file.endsWith('json.hpp') ? 30 : 60)
    .join('\n')}`;
}
const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }),
);
const names = new Set();
function walk(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    names.add(name);
    walk(child);
  }
}
walk(tree);
for (const name of [...names].sort()) {
  const directory = `node_modules/${name}`,
    files = await readdir(path.join(root, directory));
  for (const file of files.filter((f) => /^(license|copying)(\.|$)/i.test(f)))
    await append(`${directory}/${file}`);
}
await mkdir(path.join(root, 'public'), { recursive: true });
await writeFile(path.join(root, 'public/THIRD_PARTY_NOTICES.txt'), output);
await writeFile(path.join(root, 'public/LICENSE.txt'), await readFile(path.join(root, 'LICENSE')));
console.log('Distribution license notices updated.');
