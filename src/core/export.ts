import { OPENCV8, modelConfig } from './lensModel';
import { currentResult, type Session } from './types';
export function photonVisionCalibration(session: Session) {
  const result = currentResult(session);
  if (!result) throw new Error('Calibrate the current set of images before exporting.');
  if ((result.lensModel ?? OPENCV8) !== OPENCV8)
    throw new Error(
      'PhotonVision JSON requires an OpenCV8 fit. Export this model as an mrcal camera model.',
    );
  const p = result.intrinsics;
  if (
    p.length !== 12 ||
    !p.every(Number.isFinite) ||
    p[0]! <= 0 ||
    p[1]! <= 0 ||
    !Number.isFinite(result.rms) ||
    result.warp.length !== 2 ||
    !result.warp.every(Number.isFinite)
  )
    throw new Error('The calibration contains invalid coefficients.');
  return {
    resolution: { width: session.width, height: session.height },
    cameraIntrinsics: { rows: 3, cols: 3, type: 6, data: [p[0], 0, p[2], 0, p[1], p[3], 0, 0, 1] },
    distCoeffs: { rows: 1, cols: 8, type: 6, data: p.slice(4) },
    lensmodel: 'LENSMODEL_OPENCV',
    calobjectWarp: result.warp,
    calobjectSize: { width: session.board.columns - 1, height: session.board.rows - 1 },
    calobjectSpacing: session.board.squareSize,
    observations: [],
    optimizationInputs: null,
  };
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function filename(session: Session) {
  return (
    (session.cameraLabel || session.name).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) +
    `_${session.width}x${session.height}`
  );
}

export function mrcalCameraModel(session: Session) {
  const r = currentResult(session);
  if (!r) throw new Error('Calibrate the selected model before exporting.');
  if (
    r.intrinsics.length !== modelConfig(r.lensModel).parameters ||
    !r.intrinsics.every(Number.isFinite)
  )
    throw new Error('Invalid model coefficients.');
  // JSON numeric arrays and strings are also valid Python literals for mrcal's reader.
  return (
    '# PhotonCal camera model. Optimization inputs and images are in the session archive.\n' +
    JSON.stringify(
      {
        lensmodel: r.lensModel ?? OPENCV8,
        intrinsics: r.intrinsics,
        imagersize: [session.width, session.height],
        rt_cam_ref: [0, 0, 0, 0, 0, 0],
        extrinsics: [0, 0, 0, 0, 0, 0],
      },
      null,
      2,
    ) +
    '\n'
  );
}
