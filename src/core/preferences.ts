import { defaultBoard, type BoardConfig } from './types';
import { cameraControlDefinitions, type CameraMode } from './camera';
import type { CaptureSteadiness, CaptureMode } from './capture';

export const preferencesKey = 'photoncal.preferences.v1';
export interface CameraPreferences {
  mode?: CameraMode;
  controls: Record<string, string | number>;
  fov: number;
  rotated: boolean;
  steadiness: CaptureSteadiness;
}
export interface Preferences {
  version: 1;
  board: BoardConfig;
  unit: 'mm' | 'in';
  lastDevice: string;
  cameras: Record<string, CameraPreferences>;
  captureMode: CaptureMode;
  timerSeconds: number;
}
export function validBoard(b: BoardConfig): boolean {
  return (
    !!b &&
    ['charuco', 'chessboard'].includes(b.kind) &&
    [b.rows, b.columns].every((v) => Number.isInteger(v) && v >= 3 && v <= 40) &&
    Number.isFinite(b.squareSize) &&
    b.squareSize > 0 &&
    b.squareSize <= 10 &&
    Number.isFinite(b.markerSize) &&
    b.markerSize > 0 &&
    (b.kind !== 'charuco' || b.markerSize < b.squareSize) &&
    Number.isInteger(b.dictionary) &&
    b.dictionary >= 0 &&
    b.dictionary <= 16 &&
    typeof b.legacy === 'boolean'
  );
}
export function defaultCameraPreferences(): CameraPreferences {
  return { controls: {}, fov: 90, rotated: false, steadiness: 'handheld' };
}
export function readPreferences(): Preferences {
  const defaults: Preferences = {
    version: 1,
    board: { ...defaultBoard },
    unit: 'mm',
    lastDevice: '',
    cameras: {},
    captureMode: 'auto',
    timerSeconds: 5,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? 'null');
    if (saved?.version !== 1) return defaults;
    if (validBoard(saved.board)) defaults.board = { ...saved.board };
    if (saved.unit === 'in') defaults.unit = 'in';
    if (typeof saved.lastDevice === 'string') defaults.lastDevice = saved.lastDevice;
    if (['manual', 'auto', 'timer'].includes(saved.captureMode))
      defaults.captureMode = saved.captureMode;
    if (Number.isInteger(saved.timerSeconds) && saved.timerSeconds >= 1 && saved.timerSeconds <= 30)
      defaults.timerSeconds = saved.timerSeconds;
    for (const [id, raw] of Object.entries(saved.cameras ?? {})) {
      if (
        !id ||
        ['__proto__', 'constructor', 'prototype'].includes(id) ||
        !raw ||
        typeof raw !== 'object'
      )
        continue;
      const p = raw as CameraPreferences,
        camera = defaultCameraPreferences();
      camera.rotated = p.rotated === true;
      camera.steadiness = p.steadiness === 'strict' ? 'strict' : 'handheld';
      if (Number.isFinite(p.fov) && p.fov >= 10 && p.fov <= 170) camera.fov = p.fov;
      if (
        p.mode &&
        Number.isInteger(p.mode.width) &&
        Number.isInteger(p.mode.height) &&
        p.mode.width >= 16 &&
        p.mode.height >= 16 &&
        p.mode.width * p.mode.height <= 33554432 &&
        (p.mode.frameRate === undefined ||
          (Number.isFinite(p.mode.frameRate) && p.mode.frameRate > 0))
      )
        camera.mode = { ...p.mode };
      for (const { key } of cameraControlDefinitions) {
        const value = p.controls?.[key];
        if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
          camera.controls[key] = value;
      }
      defaults.cameras[id] = camera;
    }
  } catch {
    /* Missing, blocked, or corrupt storage must not prevent camera use. */
  }
  return defaults;
}
export function writePreferences(preferences: Preferences): boolean {
  try {
    localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}
