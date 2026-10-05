import type { Analysis, Corner, Frame } from './types';
const HOLD_MS = 250;
const COOLDOWN_MS = 100;
const MIN_FRAMES = 5;
// Resolution-normalized, heuristic speed cap. The old 1.5 px / 700 ms
// displacement window allowed about 2.14 px/s of sustained drift at 640px.
const MAX_SPEED_AT_640 = 2;
interface MotionSample {
  corners: Corner[];
  time: number;
}
const distance = (a: Corner, b: Corner) => Math.hypot(a.x - b.x, a.y - b.y);
export function commonDisplacement(a: Corner[], b: Corner[]): number {
  const byId = new Map(a.map((p) => [p.id, p]));
  const distances = b.flatMap((p) => (byId.has(p.id) ? [distance(byId.get(p.id)!, p)] : []));
  if (distances.length < Math.min(10, a.length, b.length) || distances.length < 4) return Infinity;
  distances.sort((x, y) => x - y);
  return distances[Math.floor(distances.length * 0.8)]!;
}
function commonSpeed(samples: MotionSample[]): number {
  // Fit each corner's x/y velocity instead of differencing consecutive noisy
  // detections. Per-corner speeds also catch rotation about a stationary center.
  const origin = samples[0]!;
  const times = samples.map((s) => (s.time - origin.time) / 1000);
  const meanTime = times.reduce((sum, t) => sum + t, 0) / times.length;
  const centered = times.map((t) => t - meanTime);
  const denominator = centered.reduce((sum, t) => sum + t * t, 0);
  if (denominator <= 0) return Infinity;
  const maps = samples.map((s) => new Map(s.corners.map((p) => [p.id, p])));
  const speeds: number[] = [];
  for (const p of origin.corners) {
    let vx = 0,
      vy = 0,
      shared = true;
    for (let i = 0; i < maps.length; i++) {
      const q = maps[i]!.get(p.id);
      if (!q) {
        shared = false;
        break;
      }
      vx += centered[i]! * (q.x - p.x);
      vy += centered[i]! * (q.y - p.y);
    }
    if (shared) speeds.push(Math.hypot(vx, vy) / denominator);
  }
  const minimum = Math.max(4, Math.min(10, ...samples.map((s) => s.corners.length)));
  if (speeds.length < minimum) return Infinity;
  speeds.sort((a, b) => a - b);
  return speeds[Math.floor(speeds.length * 0.8)]!;
}
export class AutoCapture {
  private anchor?: MotionSample;
  private recent: MotionSample[] = [];
  private samples = 0;
  private lastTime = -Infinity;
  private previousFrameTime = -Infinity;
  private lastCapture: Corner[] = [];
  private departed = false;
  private clearWindow() {
    this.anchor = undefined;
    this.recent = [];
    this.samples = 0;
  }
  private startWindow(corners: Corner[], time: number) {
    this.anchor = { corners, time };
    this.recent = [this.anchor];
    this.samples = 1;
  }
  reset() {
    this.clearWindow();
    this.previousFrameTime = -Infinity;
  }
  captured(corners: Corner[], now: number) {
    this.lastCapture = corners;
    this.lastTime = now;
    this.departed = false;
    this.reset();
  }
  update(
    a: Analysis,
    now: number,
    width: number,
  ): { capture: boolean; progress: number; reason: string } {
    if (now <= this.previousFrameTime)
      return { capture: false, progress: 0, reason: 'Waiting for a new video frame' };
    if (now - this.previousFrameTime > 500) {
      this.clearWindow();
    }
    this.previousFrameTime = now;
    if (!a.valid) {
      this.clearWindow();
      this.departed = true;
      return { capture: false, progress: 0, reason: a.reason };
    }
    if (now - this.lastTime < COOLDOWN_MS) {
      this.clearWindow();
      return { capture: false, progress: 0, reason: 'Captured. Move to a new view.' };
    }
    if (
      !this.departed &&
      this.lastCapture.length &&
      commonDisplacement(this.lastCapture, a.corners) < width * 0.025
    ) {
      this.clearWindow();
      return { capture: false, progress: 0, reason: 'Move or tilt the board for a different view' };
    }
    if (!this.anchor || commonDisplacement(this.anchor.corners, a.corners) > (1.5 * width) / 640) {
      this.startWindow(a.corners, now);
      return { capture: false, progress: 0, reason: 'Hold the board still' };
    }
    this.samples++;
    this.recent.push({ corners: a.corners, time: now });
    // Retain the recent window (and at least five frames at low analysis FPS).
    // Bounding history matters when auto capture is off but analysis continues.
    while (
      this.recent.length > MIN_FRAMES &&
      (this.recent.length > 64 || this.recent[1]!.time <= now - HOLD_MS)
    )
      this.recent.shift();
    const progress = Math.min(1, (now - this.anchor.time) / HOLD_MS);
    const capture = progress === 1 && this.samples >= MIN_FRAMES;
    if (capture && commonSpeed(this.recent) > (MAX_SPEED_AT_640 * width) / 640) {
      this.startWindow(a.corners, now);
      return { capture: false, progress: 0, reason: 'Movement detected. Hold the board still.' };
    }
    return { capture, progress, reason: capture ? 'Capturing…' : 'Hold still…' };
  }
}
export function coverage(
  frames: Pick<Frame, 'corners' | 'included'>[],
  width: number,
  height: number,
  columns = 16,
  rows = 12,
) {
  const cells = new Array<number>(columns * rows).fill(0);
  for (const frame of frames.filter((f) => f.included)) {
    const seen = new Set<number>();
    for (const p of frame.corners)
      if (p.x >= 0 && p.y >= 0 && p.x < width && p.y < height)
        seen.add(Math.floor((p.y / height) * rows) * columns + Math.floor((p.x / width) * columns));
    for (const index of seen) cells[index]!++;
  }
  return {
    columns,
    rows,
    cells,
    percent: (100 * cells.filter((c) => c > 0).length) / cells.length,
    strongPercent: (100 * cells.filter((c) => c >= 3).length) / cells.length,
  };
}
export function coveragePrompt(frames: Frame[], width: number, height: number) {
  if (frames.filter((f) => f.included).length < 3)
    return 'Start with a large, tilted view of the board.';
  const grid = coverage(frames, width, height, 3, 3);
  const names = [
    'top left',
    'top edge',
    'top right',
    'left edge',
    'center',
    'right edge',
    'bottom left',
    'bottom edge',
    'bottom right',
  ];
  const min = Math.min(...grid.cells);
  if (min < 3)
    return `Add views near the ${names[grid.cells.indexOf(min)]}. Keep the board still for each capture.`;
  return 'Vary the distance and tilt left/right and forward/back. Include large close-up views.';
}
