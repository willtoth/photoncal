import type { ViewResult } from './types';
export function percentile(values: number[], fraction: number) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}
export function regionalResiduals(
  views: ViewResult[],
  width: number,
  height: number,
  columns = 8,
  rows = 6,
) {
  const cells = Array.from({ length: columns * rows }, () => ({
    count: 0,
    rejected: 0,
    dx: 0,
    dy: 0,
    square: 0,
    frames: new Set<string>(),
  }));
  for (const view of views)
    for (const p of view.residuals) {
      if (
        ![p.x, p.y, p.dx, p.dy].every(Number.isFinite) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x >= width ||
        p.y >= height
      )
        continue;
      const cell =
        cells[Math.floor((p.y / height) * rows) * columns + Math.floor((p.x / width) * columns)]!;
      cell.frames.add(view.id);
      if (!p.used) {
        cell.rejected++;
        continue;
      }
      cell.count++;
      cell.dx += p.dx;
      cell.dy += p.dy;
      cell.square += p.dx * p.dx + p.dy * p.dy;
    }
  return cells.map((c) => {
    const dx = c.count ? c.dx / c.count : 0,
      dy = c.count ? c.dy / c.count : 0;
    return {
      count: c.count,
      rejected: c.rejected,
      frames: c.frames.size,
      dx,
      dy,
      mean: c.count ? Math.hypot(dx, dy) : null,
      spread: c.count >= 2 ? Math.sqrt(Math.max(0, c.square / c.count - dx * dx - dy * dy)) : null,
      rejection: c.count + c.rejected ? (100 * c.rejected) / (c.count + c.rejected) : null,
    };
  });
}
