import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { syntheticDataset } from '../tests/synthetic.mjs';
const root = path.resolve(import.meta.dirname, '..');
const { default: createEngine } = await import('../public/engine/photoncal.js');
const engine = await createEngine({
  wasmBinary: await readFile(path.join(root, 'public/engine/photoncal.wasm')),
  print: () => {},
  printErr: () => {},
});
function wasm(op, input) {
  const result = JSON.parse(engine[op](JSON.stringify(input)));
  assert(!result.error, result.error);
  return result;
}
function native(op, input) {
  const process = spawnSync(path.join(root, '.build/native/bin/photoncal'), [], {
    input: JSON.stringify({ ...input, op }),
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  });
  assert.equal(process.status, 0, process.stderr || process.stdout);
  const value = process.stdout.split('PHOTONCAL_RESULT=')[1];
  assert(value, 'Native result marker missing');
  return JSON.parse(value);
}
await mkdir(path.join(root, '.build/test'), { recursive: true });
for (const kind of ['charuco', 'chessboard'])
  for (const legacy of kind === 'charuco' ? [false, true] : [false]) {
    const size = 640,
      board = { ...syntheticDataset(6).request.board, kind, legacy },
      ptr = engine._malloc(size * size * 4);
    try {
      const rendered = JSON.parse(engine.renderBoard(ptr, size, JSON.stringify(board)));
      assert(!rendered.error, rendered.error);
      const detected = JSON.parse(
        engine.analyze(ptr, size, size, JSON.stringify({ board, detect: true })),
      );
      assert(detected.valid, detected.reason);
      assert.equal(detected.corners.length, 49);
      assert.equal(new Set(detected.corners.map((c) => c.id)).size, 49);
      assert(detected.sharpness > 10, 'Focus score should respond to a detailed board');
    } finally {
      engine._free(ptr);
    }
  }
console.log('ChArUco (modern/legacy), chessboard detection, corner IDs, and sharpness passed');
for (const partial of [false, true]) {
  const { request, truth } = syntheticDataset(40, partial),
    start = performance.now();
  const a = wasm('solve', request),
    b = native('solve', request);
  assert(a.rms < 0.3, `Unexpected synthetic RMS ${a.rms}`);
  for (let i = 0; i < 4; i++) {
    assert(
      Math.abs(a.intrinsics[i] - truth[i]) < 4,
      'Recovered intrinsics too far from ground truth',
    );
    assert(Math.abs(a.intrinsics[i] - b.intrinsics[i]) < 0.02, 'Native/WASM intrinsics diverged');
  }
  assert(Math.abs(a.rms - b.rms) < 1e-5, 'Native/WASM residuals diverged');
  const ua = wasm('uncertainty', { ...request, result: a, gridWidth: 12, gridHeight: 8 });
  const ub = native('uncertainty', { ...request, result: b, gridWidth: 12, gridHeight: 8 });
  assert(
    ua.values.every((v) => v !== null && v >= 0 && v < 5),
    'Invalid uncertainty',
  );
  for (let i = 0; i < ua.values.length; i++)
    assert(Math.abs(ua.values[i] - ub.values[i]) < 0.01, `Uncertainty mismatch at ${i}`);
  for (const distance of [0.5, 3, 1e8]) {
    const input = { ...request, result: a, distance, gridWidth: 12, gridHeight: 8 };
    const finite = wasm('uncertainty', input);
    const reference = native('uncertainty', input);
    assert.equal(finite.distance, distance);
    for (let i = 0; i < finite.values.length; i++) {
      assert(Number.isFinite(finite.values[i]) && finite.values[i] >= 0);
      assert(Math.abs(finite.values[i] - reference.values[i]) < 0.001);
      if (distance === 1e8)
        assert(
          Math.abs(finite.values[i] - ua.values[i]) < 1e-5,
          'Finite range must converge to infinity',
        );
    }
    if (distance === 0.5)
      assert(
        finite.values.some((v, i) => Math.abs(v - ua.values[i]) > 0.01),
        'Finite range must include translation uncertainty',
      );
  }
  assert(
    JSON.parse(engine.uncertainty(JSON.stringify({ ...request, result: a, distance: -1 }))).error,
  );
  const same = wasm('compare', { width: request.width, height: request.height, a, b: a });
  assert(same.mean < 1e-5, 'Identical models should match');
  await writeFile(
    path.join(root, `.build/test/synthetic-${partial ? 'partial' : 'full'}.json`),
    JSON.stringify({ request, result: a, uncertainty: ua }),
  );
  console.log(
    `${partial ? 'Partial' : 'Full'} observations: RMS ${a.rms.toFixed(4)} px; native/WASM agreement passed in ${((performance.now() - start) / 1000).toFixed(1)}s`,
  );
}
const fixture = JSON.parse(
  await readFile(path.join(root, 'tests/fixtures/lifecam-corners.json'), 'utf8'),
);
const a = wasm('solve', fixture),
  b = native('solve', fixture);
assert(a.rms < 1, `Real dataset RMS ${a.rms}`);
assert(Math.abs(a.rms - b.rms) < 0.002, 'Real native/WASM results differ');
console.log(
  `PhotonVision LifeCam fixture (${fixture.frames.length} views): RMS ${a.rms.toFixed(4)} px; native/WASM agreement passed`,
);
// Rejection survives the interface and original frame/corner IDs remain aligned.
const outliers = syntheticDataset(45, true).request;
outliers.frames[10].corners[8].x += 18;
const rejected = wasm('solve', outliers);
assert(rejected.outliers >= 1);
assert(rejected.views[10].residuals.some((p) => !p.used));
const malformed = JSON.parse(engine.solve(JSON.stringify({ ...fixture, frames: [] })));
assert(malformed.error);
console.log('Outlier rejection and invalid-input handling passed');
const independent = syntheticDataset(60, true).request;
const subsets = [0, 1].map((parity) => ({
  ...independent,
  frames: independent.frames.filter((_, i) => i % 2 === parity),
}));
const fits = subsets.map((request) => {
  const result = wasm('solve', request);
  return { ...result, uncertainty: wasm('uncertainty', { ...request, result }) };
});
const diff = wasm('compare', {
  width: independent.width,
  height: independent.height,
  a: fits[0],
  b: fits[1],
  ua: fits[0].uncertainty.values,
  ub: fits[1].uncertainty.values,
});
assert(diff.mean < 1 && diff.p95 < 3, 'Independent synthetic fits disagree');
console.log(`Independent-subset comparison passed: mean difference ${diff.mean.toFixed(3)} px`);
if (process.argv.includes('--large')) {
  const { request } = syntheticDataset(300, true),
    start = performance.now();
  const result = wasm('solve', request),
    u = wasm('uncertainty', { ...request, result, gridWidth: 60, gridHeight: 40 });
  assert(u.values.every((v) => v !== null && v >= 0));
  console.log(
    `300-view solve + 60×40 uncertainty passed in ${((performance.now() - start) / 1000).toFixed(1)}s; WASM heap ${(engine.HEAPU8.length / 1024 / 1024).toFixed(0)} MiB`,
  );
}
