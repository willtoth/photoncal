import type { BoardConfig } from './types';
export type Point3 = [number, number, number];

// Same corner origin and quadratic board warp as native/engine.cpp.
export function boardPoint(board: BoardConfig, id: number, warp: number[]): Point3 {
  const col = id % (board.columns - 1),
    row = Math.floor(id / (board.columns - 1));
  const x = col / (board.columns - 2),
    y = row / (board.rows - 2);
  return [
    col * board.squareSize,
    row * board.squareSize,
    4 * (warp[0] ?? 0) * x * (1 - x) + 4 * (warp[1] ?? 0) * y * (1 - y),
  ];
}

// Solver poses map board coordinates to camera coordinates (Rodrigues + translation).
// Display conversion preserves handedness: camera +X right, +Y down, +Z forward.
export function scenePoint(point: Point3, pose: number[]): Point3 {
  const [rx, ry, rz, tx, ty, tz] = pose as [number, number, number, number, number, number];
  const angle = Math.hypot(rx, ry, rz);
  let [x, y, z] = point;
  if (angle > 1e-12) {
    const a = rx / angle,
      b = ry / angle,
      c = rz / angle;
    const cos = Math.cos(angle),
      sin = Math.sin(angle),
      dot = a * x + b * y + c * z;
    [x, y, z] = [
      x * cos + (b * z - c * y) * sin + a * dot * (1 - cos),
      y * cos + (c * x - a * z) * sin + b * dot * (1 - cos),
      z * cos + (a * y - b * x) * sin + c * dot * (1 - cos),
    ];
  }
  return [x + tx, -(y + ty), -(z + tz)];
}
export function frustumPoints(
  intrinsics: number[],
  width: number,
  height: number,
  depth: number,
): Point3[] {
  const [fx, fy, cx, cy] = intrinsics as [number, number, number, number];
  return [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([u, v]) => [((u! - cx) * depth) / fx, (-(v! - cy) * depth) / fy, -depth]);
}
