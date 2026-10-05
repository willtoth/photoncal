import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { newSession, type CalibrationResult } from '../../src/core/types';
import {
  addFrame,
  archiveSession,
  importArchive,
  getImage,
  validateSession,
  removeFrame,
  listSessions,
} from '../../src/core/storage';
import { photonVisionCalibration } from '../../src/core/export';
function calibrated() {
  const s = newSession();
  s.resultRevision = 0;
  s.result = {
    intrinsics: [800, 801, 639.5, 359.5, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    warp: [0.001, -0.002],
    rms: 0.3,
    mean: 0.2,
    solverRms: 0.2,
    views: [],
    weights: [],
    poses: [],
    inliers: 100,
    outliers: 0,
  };
  return s;
}
describe('PhotonVision export', () => {
  it('uses the exact calibration schema, matrix shape, units, and distortion order', () => {
    const s = calibrated(),
      j = photonVisionCalibration(s);
    expect(j).toEqual({
      resolution: { width: 1280, height: 720 },
      cameraIntrinsics: {
        rows: 3,
        cols: 3,
        type: 6,
        data: [800, 0, 639.5, 0, 801, 359.5, 0, 0, 1],
      },
      distCoeffs: { rows: 1, cols: 8, type: 6, data: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] },
      lensmodel: 'LENSMODEL_OPENCV',
      calobjectWarp: [0.001, -0.002],
      calobjectSize: { width: 7, height: 7 },
      calobjectSpacing: 0.0254,
      observations: [],
      optimizationInputs: null,
    });
  });
  it('refuses missing, stale, or non-finite results', () => {
    expect(() => photonVisionCalibration(newSession())).toThrow();
    const s = calibrated();
    s.revision++;
    expect(() => photonVisionCalibration(s)).toThrow();
    s.revision--;
    s.result!.intrinsics[4] = NaN;
    expect(() => photonVisionCalibration(s)).toThrow();
    s.result!.intrinsics[4] = 0;
    s.result!.warp[0] = Infinity;
    expect(() => photonVisionCalibration(s)).toThrow();
  });
});
describe('session archives', () => {
  it('round-trips original pixels, corner IDs, board metadata, and results losslessly', async () => {
    const s = calibrated();
    const blob = new Blob([new Uint8Array([0, 23, 255, 7, 9])], { type: 'image/png' });
    await addFrame(
      s,
      {
        id: 'frame1',
        name: 'test.png',
        corners: [{ id: 13, x: 100, y: 200 }],
        capturedAt: 1,
        included: true,
        source: 'import',
        sharpness: 20,
      },
      blob,
    );
    s.resultRevision = s.revision;
    const archive = await archiveSession(s, () => {});
    const restored = await importArchive(new File([archive], 'session.zip'), () => {});
    expect(restored.id).not.toBe(s.id);
    expect(restored.frames).toEqual(s.frames);
    expect(restored.result).toEqual(s.result);
    expect(restored.board).toEqual(s.board);
    expect(await (await getImage(restored.id, 'frame1'))!.arrayBuffer()).toEqual(
      await blob.arrayBuffer(),
    );
    expect(photonVisionCalibration(restored)).toEqual(photonVisionCalibration(s));
    await removeFrame(restored, 'frame1');
    expect(await getImage(restored.id, 'frame1')).toBeUndefined();
    expect(restored.frames).toHaveLength(0);
    expect(() => photonVisionCalibration(restored)).toThrow();
  });
  it('does not save archives with missing images', async () => {
    const s = newSession();
    s.frames = [
      {
        id: 'missing',
        name: 'missing.png',
        corners: [],
        capturedAt: 1,
        included: true,
        source: 'camera',
        sharpness: 0,
      },
    ];
    const count = (await listSessions()).length;
    const bytes = zipSync({ 'session.json': strToU8(JSON.stringify(s)) });
    await expect(
      importArchive(new File([new Uint8Array(bytes).buffer], 'bad.zip'), () => {}),
    ).rejects.toThrow('missing');
    expect((await listSessions()).length).toBe(count);
  });
  it('rejects malformed board dimensions, corner IDs, coordinates, and diagnostic grids', () => {
    const s = calibrated();
    s.board.markerSize = 1;
    expect(() => validateSession(s)).toThrow();
    s.board.markerSize = 0.01905;
    s.frames = [
      {
        id: 'test',
        name: 'test',
        corners: [{ id: 49, x: 0, y: 0 }],
        included: true,
        source: 'camera',
        sharpness: 0,
        capturedAt: 1,
      },
    ];
    expect(() => validateSession(s)).toThrow();
    s.frames[0]!.corners = [{ id: 0, x: 1280, y: 0 }];
    expect(() => validateSession(s)).toThrow();
    s.frames = [];
    s.result!.uncertainty = { width: 3, height: 3, values: [1] };
    expect(() => validateSession(s)).toThrow();
  });
});
