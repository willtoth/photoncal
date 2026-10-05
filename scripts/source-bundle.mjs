import { mkdtemp, mkdir, cp, copyFile, writeFile, rm, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { sources } from './native-sources.mjs';
import './notices.mjs';
const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'photoncal-source-'));
const project = path.join(temporary, 'photoncal');
await mkdir(path.join(project, '.deps'), { recursive: true });
try {
  for (const name of [
    'src',
    'native',
    'scripts',
    'tests',
    'licenses',
    'package.json',
    'package-lock.json',
    'index.html',
    'vite.config.ts',
    'vitest.config.ts',
    'playwright.config.ts',
    'tsconfig.json',
    '.prettierrc.json',
    '.prettierignore',
    '.clang-format',
    '.gitignore',
    'README.md',
    'LICENSE',
    'THIRD_PARTY.md',
    '.github',
  ])
    await cp(path.join(root, name), path.join(project, name), { recursive: true });
  for (const [name, , revision] of sources) {
    const origin = path.join(root, '.deps', name),
      target = path.join(project, '.deps', name);
    await mkdir(target, { recursive: true });
    let archived = false;
    try {
      await access(path.join(origin, '.git'));
      archived = true;
    } catch {}
    if (archived) {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: origin,
        encoding: 'utf8',
      }).trim();
      if (head !== revision) throw new Error(`Unexpected ${name} revision ${head}`);
      const dirty = execFileSync('git', ['diff', '--name-only'], {
        cwd: origin,
        encoding: 'utf8',
      }).trim();
      // SuiteSparse's own configure_file() updates these two tracked templates
      // in its source tree. Our CMake settings reproduce these generated edits.
      const configured = new Set(
        name === 'suitesparse'
          ? ['CHOLMOD/Include/cholmod.h', 'SuiteSparse_config/SuiteSparse_config.h']
          : [],
      );
      if (
        dirty
          .split('\n')
          .filter(Boolean)
          .some((file) => !configured.has(file))
      )
        throw new Error(
          `Cannot archive modified dependency ${name}. Commit/vendor those changes explicitly first.`,
        );
      const archive = path.join(temporary, `${name}.tar`);
      execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD'], {
        cwd: origin,
        stdio: 'inherit',
      });
      execFileSync('tar', ['-xf', archive, '-C', target], { stdio: 'inherit' });
    } else {
      if ((await readFile(path.join(origin, '.photoncal-revision'), 'utf8')).trim() !== revision)
        throw new Error(`Unexpected source revision for ${name}`);
      await cp(origin, target, {
        recursive: true,
        filter: (file) => !file.endsWith('.o') && !file.endsWith('.a'),
      });
    }
    await writeFile(path.join(target, '.photoncal-revision'), revision + '\n');
  }
  await copyFile(path.join(root, '.deps/json.hpp'), path.join(project, '.deps/json.hpp'));
  await mkdir(path.join(root, 'public/source'), { recursive: true });
  execFileSync(
    'tar',
    [
      '-czf',
      path.join(root, 'public/source/photoncal-source.tar.gz'),
      '-C',
      temporary,
      'photoncal',
    ],
    { stdio: 'inherit' },
  );
  console.log('Corresponding source: public/source/photoncal-source.tar.gz');
} finally {
  // Only the unique directory created by mkdtemp above is removed.
  await rm(temporary, { recursive: true, force: true });
}
