import type { CalibrationResult, Session } from './types';
export const OPENCV8 = 'LENSMODEL_OPENCV8';
export const DEFAULT_SPLINE = 'LENSMODEL_SPLINED_STEREOGRAPHIC_order=3_Nx=16_Ny=12_fov_x_deg=120';
export function modelConfig(name = OPENCV8) {
  if (name === OPENCV8) return { family: 'opencv8' as const, parameters: 12 };
  const match =
    /^LENSMODEL_SPLINED_STEREOGRAPHIC_order=([23])_Nx=(\d{1,2})_Ny=(\d{1,2})_fov_x_deg=(\d{1,3})$/.exec(
      name,
    );
  if (!match) throw new Error('Unsupported lens model configuration.');
  const [order, nx, ny, fov] = match.slice(1).map(Number) as [number, number, number, number];
  if (nx < 6 || ny < 6 || nx > 40 || ny > 40 || fov < 20 || fov > 220)
    throw new Error('Spline grid must be 6–40 per dimension, and FOV 20–220 degrees.');
  return { family: 'spline' as const, order, nx, ny, fov, parameters: 4 + 2 * nx * ny };
}
export const modelName = (name = OPENCV8) =>
  name === OPENCV8 ? 'OpenCV8' : 'Splined stereographic';
export function savedFits(s: Session) {
  const fits = (s.modelFits ?? []).filter((f) => f.revision === s.revision).map((f) => f.result);
  if (
    s.result &&
    s.resultRevision === s.revision &&
    !fits.some((r) => (r.lensModel ?? OPENCV8) === (s.result!.lensModel ?? OPENCV8))
  )
    fits.push(s.result);
  return fits;
}
export function retainFit(s: Session, result: CalibrationResult, revision: number) {
  s.modelFits = [
    ...(s.modelFits ?? []).filter(
      (f) =>
        f.revision === revision &&
        (f.result.lensModel ?? OPENCV8) !== (result.lensModel ?? OPENCV8),
    ),
    { revision, result },
  ].slice(-8);
}
