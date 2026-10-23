export interface BoardConfig {
  kind: 'charuco' | 'chessboard';
  columns: number;
  rows: number;
  squareSize: number;
  markerSize: number;
  dictionary: number;
  legacy: boolean;
}
export interface Corner {
  id: number;
  x: number;
  y: number;
}
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Analysis {
  sharpness: number;
  brightness: number;
  contrast: number;
  clipped: number;
  corners: Corner[];
  valid: boolean;
  reason: string;
}
export type CaptureResult =
  | { accepted: true; analysis: Analysis; blob: Blob }
  | { accepted: false; analysis: Analysis };
export interface Frame {
  id: string;
  name: string;
  capturedAt: number;
  corners: Corner[];
  included: boolean;
  source: 'camera' | 'import';
  sharpness: number;
}
export interface Residual extends Corner {
  dx: number;
  dy: number;
  used: boolean;
}
export interface ViewResult {
  id: string;
  mean: number;
  rms: number;
  inliers: number;
  outliers: number;
  residuals: Residual[];
}
export interface Grid {
  width: number;
  height: number;
  values: (number | null)[];
}
export interface CalibrationResult {
  intrinsics: number[];
  warp: number[];
  poses: number[][];
  weights: number[];
  views: ViewResult[];
  mean: number;
  rms: number;
  solverRms: number;
  inliers: number;
  outliers: number;
  uncertainty?: Grid;
  uncertaintyError?: string;
  consistency?: Grid & { mean: number; p95: number };
  consistencyError?: string;
}
export interface Session {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  cameraLabel: string;
  settings: Record<string, unknown>;
  board: BoardConfig;
  fov: number;
  focusConfirmed: boolean;
  source: 'camera' | 'import';
  frames: Frame[];
  revision: number;
  resultRevision?: number;
  result?: CalibrationResult;
}
export interface SolveRequest {
  board: BoardConfig;
  width: number;
  height: number;
  fov: number;
  frames: { id: string; corners: Corner[] }[];
}
export const defaultBoard: BoardConfig = {
  kind: 'charuco',
  columns: 8,
  rows: 8,
  squareSize: 0.0254,
  markerSize: 0.01905,
  dictionary: 3,
  legacy: false,
};
export function newSession(): Session {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: 'Camera calibration',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    width: 1280,
    height: 720,
    cameraLabel: '',
    settings: {},
    board: { ...defaultBoard },
    fov: 90,
    focusConfirmed: false,
    source: 'camera',
    frames: [],
    revision: 0,
  };
}
export function solveRequest(session: Session): SolveRequest {
  return {
    board: { ...session.board },
    width: session.width,
    height: session.height,
    fov: session.fov,
    frames: session.frames
      .filter((f) => f.included)
      .map((f) => ({ id: f.id, corners: f.corners.map((c) => ({ ...c })) })),
  };
}
export function currentResult(s: Session) {
  return s.result && s.revision === s.resultRevision ? s.result : undefined;
}
