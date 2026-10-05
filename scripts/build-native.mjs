import { mkdir, access, readFile, writeFile, copyFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { sources } from './native-sources.mjs';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const deps = path.join(root, '.deps');
const mode = process.argv[2] ?? 'wasm';
if (!['wasm', 'native', 'sources'].includes(mode))
  throw new Error('Build mode must be wasm, native, or sources');
const jobs = process.env.BUILD_JOBS ?? String(Math.min(os.availableParallelism(), 8));
async function run(cmd, args, cwd = root, env = process.env) {
  console.log(`\n${cmd} ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
async function source(name, url, revision) {
  const dir = path.join(deps, name);
  if (await exists(path.join(dir, '.photoncal-revision'))) {
    if ((await readFile(path.join(dir, '.photoncal-revision'), 'utf8')).trim() !== revision)
      throw new Error(`Wrong source revision for ${name}`);
    return dir;
  }
  if (!(await exists(path.join(dir, '.git')))) {
    await mkdir(dir, { recursive: true });
    await run('git', ['init', '-q'], dir);
    await run('git', ['remote', 'add', 'origin', url], dir);
    await run('git', ['fetch', '--depth=1', 'origin', revision], dir);
    await run('git', ['checkout', '--detach', 'FETCH_HEAD'], dir);
  }
  if (
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim() !== revision
  )
    throw new Error(
      `Unexpected ${name} checkout. Use the pinned revision in scripts/native-sources.mjs.`,
    );
  return dir;
}
await mkdir(deps, { recursive: true });
for (const [name, url, revision] of sources) await source(name, url, revision);
if (!(await exists(path.join(deps, 'json.hpp')))) {
  const response = await fetch(
    'https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp',
  );
  if (!response.ok) throw new Error('Could not download nlohmann/json 3.11.3');
  await writeFile(path.join(deps, 'json.hpp'), await response.text());
}
if (
  createHash('sha256')
    .update(await readFile(path.join(deps, 'json.hpp')))
    .digest('hex') !== '9bea4c8066ef4a1c206b2be5a36302f8926f7fdc6087af5d20b417d0cf103ea6'
)
  throw new Error('nlohmann/json header checksum mismatch');

// CI distributes the committed WASM together with its pinned source trees.
// Fetching corresponding source does not require Emscripten or a native compiler.
if (mode === 'sources') {
  console.log('Pinned native sources and JSON header verified.');
  process.exit(0);
}

const build = path.join(root, '.build', mode);
await mkdir(build, { recursive: true });
let env = { ...process.env };
let emcmake;
if (mode === 'wasm') {
  let sdk = process.env.EMSDK;
  if (!sdk && (await exists(path.resolve(root, '../emsdk/upstream/emscripten/emcc'))))
    sdk = path.resolve(root, '../emsdk');
  if (!sdk) throw new Error('Set EMSDK to an Emscripten SDK checkout (tested with 4.0.8).');
  const emscripten = path.join(sdk, 'upstream/emscripten');
  emcmake = path.join(emscripten, 'emcmake');
  env.PATH = `${emscripten}:${env.PATH}`;
  const blas = path.join(deps, 'openblas');
  if (!(await exists(path.join(blas, 'libopenblas.a')))) {
    await run(
      'make',
      [
        '-j' + jobs,
        'TARGET=WASM128_GENERIC',
        'HOSTCC=gcc',
        'CC=emcc',
        'AR=emar',
        'RANLIB=emranlib',
        'USE_THREAD=0',
        'NUM_THREADS=1',
        'NOFORTRAN=1',
        'NO_LAPACKE=1',
        'C_LAPACK=1',
        'libs',
      ],
      blas,
      env,
    );
  }
}
const configure = [
  '-S',
  path.join(root, 'native'),
  '-B',
  build,
  '-G',
  'Ninja',
  '-DCMAKE_BUILD_TYPE=Release',
  `-DPHOTONCAL_DEPS=${deps}`,
];
if (!(await exists(path.join(build, 'build.ninja'))))
  await run(emcmake ?? 'cmake', emcmake ? ['cmake', ...configure] : configure, root, env);
await run('cmake', ['--build', build, '-j', jobs], root, env);
if (mode === 'wasm') {
  await mkdir(path.join(root, 'public/engine'), { recursive: true });
  for (const name of ['photoncal.js', 'photoncal.wasm'])
    await copyFile(path.join(build, 'bin', name), path.join(root, 'public/engine', name));
  await writeFile(
    path.join(root, 'public/engine/manifest.json'),
    JSON.stringify(
      {
        sources: sources.map(([name, url, revision]) => ({ name, url, revision })),
        sha256: createHash('sha256')
          .update(await readFile(path.join(root, 'public/engine/photoncal.wasm')))
          .digest('hex'),
        toolchain: 'Emscripten 4.0.8 (reference build)',
        lensmodel: 'LENSMODEL_OPENCV8',
      },
      null,
      2,
    ) + '\n',
  );
}
