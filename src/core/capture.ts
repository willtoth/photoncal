import type { Analysis, Corner, Frame } from './types';
const HOLD_MS = 250;
const COOLDOWN_MS = 100;
const MIN_FRAMES = 5;
export type CaptureSteadiness = 'handheld' | 'strict';
// These are capture heuristics, not measurements of blur or sensor readout.
const MOTION_AT_640 = {
  handheld: { displacement: 4, speed: 12 },
  strict: { displacement: 1.5, speed: 2 },
};
const DETECTION_NOISE_AT_640 = 0.25;
const MAX_EXPOSURE_TRAVEL_PX = 0.5;
interface CaptureSettings {
  exposureMode?: string;
  exposureTime?: number;
  frameRate?: number;
}
function exposureDuration(settings: CaptureSettings): number {
  if (
    settings.exposureMode === 'manual' &&
    Number.isFinite(settings.exposureTime) &&
    settings.exposureTime! > 0
  )
    // MediaStream Image Capture expresses manual exposure in 100 µs units.
    return settings.exposureTime! / 10000;
  // Auto-exposure values may be stale. Use a frame period (at least 1/30 s)
  // as a fallback estimate, not a guarantee about actual exposure or readout.
  const fps =
    Number.isFinite(settings.frameRate) && settings.frameRate! > 0 ? settings.frameRate! : 30;
  return 1 / Math.min(fps, 30);
}
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
  constructor(private steadiness: CaptureSteadiness = 'handheld') {}
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
    // Start a fresh timing window, including when reconnecting the camera.
    this.lastTime = -Infinity;
  }
  setSteadiness(value: CaptureSteadiness) {
    this.steadiness = value;
    this.reset();
  }
  captured(corners: Corner[], now: number) {
    this.reset();
    this.lastCapture = corners;
    this.lastTime = now;
    this.departed = false;
  }
  update(
    a: Analysis,
    now: number,
    width: number,
    settings: CaptureSettings = {},
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
    const scale = width / 640;
    const tolerance = MOTION_AT_640[this.steadiness];
    if (
      !this.anchor ||
      commonDisplacement(this.anchor.corners, a.corners) > tolerance.displacement * scale
    ) {
      this.startWindow(a.corners, now);
      return { capture: false, progress: 0, reason: 'Pause briefly at this view' };
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
    const progress = Math.min(1, (now - this.anchor.time) / HOLD_MS, this.samples / MIN_FRAMES);
    const capture = progress === 1 && this.samples >= MIN_FRAMES;
    if (capture) {
      const exposureLimit = MAX_EXPOSURE_TRAVEL_PX / exposureDuration(settings);
      const speedLimit = Math.min(tolerance.speed * scale, exposureLimit);
      // A fitted velocity alone can average back-and-forth shake to zero.
      // Check each interval too, allowing for subpixel detector noise.
      let speed = commonSpeed(this.recent);
      for (let i = 1; i < this.recent.length; i++) {
        const previous = this.recent[i - 1]!,
          current = this.recent[i]!;
        const travel = Math.max(
          0,
          commonDisplacement(previous.corners, current.corners) - DETECTION_NOISE_AT_640 * scale,
        );
        speed = Math.max(speed, (travel * 1000) / (current.time - previous.time));
      }
      if (speed > speedLimit) {
        this.startWindow(a.corners, now);
        return {
          capture: false,
          progress: 0,
          reason:
            exposureLimit < tolerance.speed * scale
              ? 'Movement detected. Pause briefly or use a shorter exposure.'
              : 'Movement detected. Pause briefly at this view.',
        };
      }
    }
    return { capture, progress, reason: capture ? 'Capturing…' : 'Keep this view steady…' };
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
