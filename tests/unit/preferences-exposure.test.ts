import { afterEach, expect, it, vi } from 'vitest';
import {
  exposureScale,
  exposureSeconds,
  exposureMilliseconds,
  exposureLabel,
} from '../../src/core/exposure';
import {
  defaultCameraPreferences,
  readPreferences,
  writePreferences,
  preferencesKey,
} from '../../src/core/preferences';
import { previewPoint } from '../../src/core/preview';
import { defaultBoard, newSession, solveRequest } from '../../src/core/types';
import { photonVisionCalibration } from '../../src/core/export';

afterEach(() => vi.unstubAllGlobals());
it('converts browser exposure units consistently', () => {
  expect(exposureSeconds(20)).toBe(0.002);
  expect(exposureMilliseconds(20)).toBe(2);
  expect(exposureLabel(20)).toBe('2 ms · 1/500 s');
  expect(exposureLabel(undefined)).toBe('Not reported');
});
it('spreads Windows hardware stops across the slider without additive step snapping', () => {
  const scale = exposureScale({ min: 10000 / 4096, max: 10000, step: 2 }, true);
  expect(scale.stops).toHaveLength(13);
  expect(scale.fromPosition(0)).toBe(10000 / 4096);
  expect(scale.fromPosition(6)).toBe(10000 / 64);
  expect(scale.adjacent(10000 / 64, -1)).toBe(10000 / 128);
  expect(scale.snap(20)).toBe(10000 / 512);
  for (const stop of scale.stops) expect(scale.fromPosition(scale.toPosition(stop))).toBe(stop);
});
it('decodes current Chromium Windows minimum-gap exposure steps', () => {
  for (const min of [10000 / 4096, 10000 / 16384]) {
    for (const ratio of [2, 4]) {
      const scale = exposureScale({ min, max: 10000, step: min * (ratio - 1) }, true);
      expect(scale.stops.length).toBeGreaterThan(1);
      for (const stop of scale.stops) {
        expect(Number.isInteger(Math.log2(stop / 10000))).toBe(true);
        expect(scale.fromPosition(scale.toPosition(stop))).toBe(stop);
      }
      expect(scale.adjacent(min, 1)).toBe(min * ratio);
    }
  }
  const scale = exposureScale({ min: 10000 / 4096, max: 10000, step: 10000 / 4096 }, true);
  expect(scale.snap(26.85546875)).toBe(19.53125);
  expect(scale.adjacent(39.0625, -1)).toBe(19.53125);
});
it('maps linear hardware logarithmically and respects additive steps and endpoints', () => {
  const scale = exposureScale({ min: 10, max: 1000, step: 5 });
  expect(scale.fromPosition(500)).toBe(100);
  expect(scale.snap(52)).toBe(50);
  expect(scale.snap(-1)).toBe(10);
  expect(scale.snap(100000)).toBe(1000);
  expect(scale.adjacent(50, 1)).toBe(55);
  expect(exposureScale({ min: 10, max: 15, step: 3 }).snap(15)).toBe(13);
  expect(exposureScale({ min: 10, max: 1000, step: 5 }, true).stops).toHaveLength(0);
});
function memoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return values;
}
it('remembers a shared rectangular target, units, and separate camera profiles without a capture', () => {
  memoryStorage();
  const p = readPreferences();
  p.board = { ...defaultBoard, rows: 7, columns: 10 };
  p.unit = 'in';
  p.lastDevice = 'a';
  p.captureMode = 'timer';
  p.timerSeconds = 1;
  p.cameras.a = {
    ...defaultCameraPreferences(),
    controls: { exposureMode: 'manual', exposureTime: 20 },
    rotated: true,
    mode: { width: 1280, height: 720, frameRate: 30 },
  };
  p.cameras.b = {
    ...defaultCameraPreferences(),
    controls: { brightness: 42 },
    steadiness: 'strict',
  };
  expect(writePreferences(p)).toBe(true);
  expect(readPreferences()).toEqual(p);
});
it('falls back safely for invalid preferences, including blocked storage', () => {
  const values = memoryStorage();
  values.set(preferencesKey, '{broken');
  expect(readPreferences().board).toEqual(defaultBoard);
  values.set(
    preferencesKey,
    JSON.stringify({
      version: 1,
      board: { ...defaultBoard, rows: -1 },
      timerSeconds: 0,
      cameras: { a: { fov: -3, rotated: 'true', controls: { brightness: 5, injected: 10 } } },
    }),
  );
  const p = readPreferences();
  expect(p.board).toEqual(defaultBoard);
  expect(p.timerSeconds).toBe(5);
  expect(p.cameras.a).toMatchObject({ fov: 90, rotated: false, controls: { brightness: 5 } });
  expect(p.cameras.a!.controls).not.toHaveProperty('injected');
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  });
  expect(readPreferences().board).toEqual(defaultBoard);
  expect(writePreferences(p)).toBe(false);
});
it('maps displayed focus coordinates without changing calibration geometry or exports', () => {
  const session = newSession();
  session.board = { ...defaultBoard, rows: 7, columns: 10 };
  session.resultRevision = 0;
  session.result = {
    intrinsics: [800, 801, 639.5, 359.5, 0, 0, 0, 0, 0, 0, 0, 0],
    warp: [0, 0],
    poses: [],
    weights: [],
    views: [],
    mean: 0,
    rms: 0,
    solverRms: 0,
    inliers: 0,
    outliers: 0,
  };
  const request = solveRequest(session),
    exported = photonVisionCalibration(session);
  const p = previewPoint(0.15, 0.85, true);
  expect(p.x).toBeCloseTo(0.85);
  expect(p.y).toBeCloseTo(0.15);
  expect(previewPoint(p.x, p.y, true).x).toBeCloseTo(0.15);
  expect(solveRequest(session)).toEqual(request);
  expect(photonVisionCalibration(session)).toEqual(exported);
  expect(exported.calobjectSize).toEqual({ width: 9, height: 6 });
});
