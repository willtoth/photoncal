import { expect, it } from 'vitest';
import { boardPoint, scenePoint, frustumPoints } from '../../src/core/sceneGeometry';
import { defaultBoard } from '../../src/core/types';
it('uses the solver corner origin, rectangular dimensions, and calibrated board warp', () => {
  const board = { ...defaultBoard, columns: 6, rows: 4, squareSize: 0.1 };
  expect(boardPoint(board, 0, [0.01, 0.02])).toEqual([0, 0, 0]);
  expect(boardPoint(board, 14, [0.01, 0.02])).toEqual([0.4, 0.2, 0]);
  expect(boardPoint(board, 7, [0.01, 0.02])).toEqual([0.2, 0.1, 0.03]);
});
it('applies board-to-camera Rodrigues rotation before translation and preserves handedness', () => {
  expect(scenePoint([0, 0, 0], [0, 0, 0, 1, 2, 3])).toEqual([1, -2, -3]);
  const p = scenePoint([1, 0, 0], [0, 0, Math.PI / 2, 1, 2, 3]);
  expect(p[0]).toBeCloseTo(1);
  expect(p[1]).toBeCloseTo(-3);
  expect(p[2]).toBeCloseTo(-3);
  const tilt = scenePoint([0, 1, 0], [Math.PI / 2, 0, 0, 0, 0, 2]);
  expect(tilt[1]).toBeCloseTo(0);
  expect(tilt[2]).toBeCloseTo(-3);
});
it('uses both focal lengths and the off-center principal point for the frustum', () => {
  expect(frustumPoints([800, 400, 300, 200], 1000, 600, 2)).toEqual([
    [-0.75, 1, -2],
    [1.75, 1, -2],
    [1.75, -2, -2],
    [-0.75, -2, -2],
  ]);
});
