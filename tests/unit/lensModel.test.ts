import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  newSession,
  currentResult,
  solveRequest,
  type CalibrationResult,
} from '../../src/core/types';
import {
  OPENCV8,
  DEFAULT_SPLINE,
  modelConfig,
  savedFits,
  retainFit,
} from '../../src/core/lensModel';
import { photonVisionCalibration, mrcalCameraModel } from '../../src/core/export';
import { validateSession, addFrame, archiveSession, importArchive } from '../../src/core/storage';
function fit(lensModel?: string): CalibrationResult {
  return {
    lensModel,
    intrinsics: [800, 801, 639.5, 359.5, ...Array(modelConfig(lensModel).parameters - 4).fill(0)],
    warp: [0, 0],
    poses: [],
    weights: [],
    views: [],
    rms: 0.2,
    mean: 0.1,
    solverRms: 0.2,
    inliers: 100,
    outliers: 0,
  };
}
describe('lens models', () => {
  it('treats legacy sessions as OpenCV8 and makes different model results stale', () => {
    const s = newSession();
    s.result = fit();
    s.resultRevision = 0;
    expect(currentResult(s)).toBe(s.result);
    expect(solveRequest(s).lensModel).toBe(OPENCV8);
    s.lensModel = DEFAULT_SPLINE;
    expect(currentResult(s)).toBeUndefined();
    expect(solveRequest(s).lensModel).toBe(DEFAULT_SPLINE);
  });
  it('validates configuration and variable parameter counts', () => {
    expect(modelConfig(DEFAULT_SPLINE).parameters).toBe(388);
    expect(() =>
      modelConfig('LENSMODEL_SPLINED_STEREOGRAPHIC_order=3_Nx=99_Ny=12_fov_x_deg=120'),
    ).toThrow();
    const s = newSession();
    s.lensModel = DEFAULT_SPLINE;
    s.result = fit(DEFAULT_SPLINE);
    s.resultRevision = 0;
    expect(validateSession(s)).toBe(s);
    s.result.intrinsics.pop();
    expect(() => validateSession(s)).toThrow();
  });
  it('retains both fits but excludes them after image/settings changes', () => {
    const s = newSession();
    retainFit(s, fit(), 0);
    retainFit(s, fit(DEFAULT_SPLINE), 0);
    expect(savedFits(s)).toHaveLength(2);
    s.revision++;
    expect(savedFits(s)).toHaveLength(0);
  });
  it('exports exact mrcal coefficients and blocks incompatible PhotonVision export', () => {
    const s = newSession();
    s.lensModel = DEFAULT_SPLINE;
    s.result = fit(DEFAULT_SPLINE);
    s.resultRevision = 0;
    const model = JSON.parse(mrcalCameraModel(s).split('\n').slice(1).join('\n'));
    expect(model.lensmodel).toBe(DEFAULT_SPLINE);
    expect(model.intrinsics).toEqual(s.result.intrinsics);
    expect(model.imagersize).toEqual([1280, 720]);
    expect(() => photonVisionCalibration(s)).toThrow(/OpenCV8/);
  });
  it('round-trips both model fits through a session archive', async () => {
    const s = newSession();
    await addFrame(
      s,
      {
        id: 'frame',
        name: 'frame',
        capturedAt: 0,
        corners: [],
        included: true,
        source: 'import',
        sharpness: 0,
      },
      new Blob(['image']),
    );
    s.lensModel = DEFAULT_SPLINE;
    s.splineModel = DEFAULT_SPLINE;
    s.result = fit(DEFAULT_SPLINE);
    s.resultRevision = s.revision;
    retainFit(s, fit(), s.revision);
    retainFit(s, s.result, s.revision);
    const archive = await archiveSession(s, () => {}),
      restored = await importArchive(new File([archive], 'session.zip'), () => {});
    expect(restored.lensModel).toBe(DEFAULT_SPLINE);
    expect(savedFits(restored)).toHaveLength(2);
    expect(currentResult(restored)?.intrinsics).toEqual(s.result.intrinsics);
  });
});
