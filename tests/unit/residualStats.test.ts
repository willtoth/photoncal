import { describe, expect, it } from 'vitest';
import { percentile, regionalResiduals } from '../../src/core/residualStats';
import type { ViewResult } from '../../src/core/types';
const view = (id: string, points: number[][]): ViewResult => ({
  id,
  mean: 0,
  rms: 0,
  inliers: 0,
  outliers: 0,
  residuals: points.map(([x, y, dx, dy, used], id) => ({
    id,
    x: x!,
    y: y!,
    dx: dx!,
    dy: dy!,
    used: !!used,
  })),
});
describe('regional residual statistics', () => {
  it('separates directional bias from spread and excludes rejected residuals', () => {
    const [cell] = regionalResiduals(
      [
        view('a', [
          [10, 10, 3, 4, 1],
          [20, 10, -3, -4, 1],
        ]),
        view('b', [[10, 10, 100, 100, 0]]),
      ],
      100,
      100,
      1,
      1,
    );
    expect(cell).toMatchObject({ count: 2, rejected: 1, frames: 2, mean: 0, spread: 5 });
    expect(cell!.rejection).toBeCloseTo(100 / 3);
  });
  it('bins by observed position and distinguishes missing data from zero', () => {
    const cells = regionalResiduals(
      [
        view('a', [
          [50, 50, 0, 0, 1],
          [100, 50, 1, 1, 1],
          [-1, 0, 1, 1, 1],
        ]),
      ],
      100,
      100,
      2,
      2,
    );
    expect(cells[0]).toMatchObject({ mean: null, spread: null, rejection: null });
    expect(cells[3]).toMatchObject({ count: 1, mean: 0, spread: null, rejection: 0 });
    expect(cells.reduce((n, c) => n + c.count, 0)).toBe(1);
  });
  it('computes spatial percentiles without mutating source samples', () => {
    const values = [3, 1, 2];
    expect(percentile(values, 0.5)).toBe(2);
    expect(percentile(values, 0.95)).toBe(3);
    expect(percentile([], 0.95)).toBeUndefined();
    expect(values).toEqual([3, 1, 2]);
  });
});
