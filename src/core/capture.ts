import type { Analysis, Corner, Frame } from './types';
import { exposureSeconds } from './exposure';
export type CaptureMode = 'manual' | 'auto' | 'timer';
export class CaptureTimer {
  deadline = Infinity;
  restart(now: number, seconds: number) {
    this.deadline = now + seconds * 1000;
  }
  stop() {
    this.deadline = Infinity;
  }
  due(frameTime: number) {
    return frameTime >= this.deadline;
  }
  remaining(now: number) {
    return Math.max(0, Math.ceil((this.deadline - now) / 1000));
  }
}
export function duplicateView(previous: Corner[], corners: Corner[], width: number) {
  return previous.length > 0 && commonDisplacement(previous, corners) < width * 0.025;
}
const HOLD_MS = 250;
const COOLDOWN_MS = 750;
const MIN_FRAMES = 5;
export type CaptureSteadiness = 'handheld' | 'strict';
// These are capture heuristics, not measurements of blur or sensor readout.
const STRICT_MOTION_AT_640 = { displacement: 1.5, speed: 2 };
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
    return exposureSeconds(settings.exposureTime!);
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
  reset(all = false) {
    if (all) {
      this.lastCapture = [];
      this.lastTime = -Infinity;
    }
    this.clearWindow();
    this.previousFrameTime = -Infinity;
    // Settings changes restart motion qualification, but retain the save cooldown.
  }
  setSteadiness(value: CaptureSteadiness) {
    this.steadiness = value;
    this.reset();
  }
  captured(corners: Corner[], now: number) {
    this.reset();
    this.lastCapture = corners;
    this.lastTime = now;
  }
  update(
    a: Analysis,
    now: number,
    width: number,
    settings: CaptureSettings = {},
  ): { capture: boolean; progress: number; reason: string } {
    if (this.previousFrameTime === -Infinity && now < this.lastTime) this.lastTime = -Infinity;
    if (now <= this.previousFrameTime)
      return { capture: false, progress: 0, reason: 'Waiting for a new video frame' };
    if (now - this.previousFrameTime > (this.steadiness === 'handheld' ? 1000 : 500)) {
      this.clearWindow();
    }
    this.previousFrameTime = now;
    if (!a.valid) {
      this.clearWindow();

      return { capture: false, progress: 0, reason: a.reason };
    }
    if (now - this.lastTime < COOLDOWN_MS) {
      this.clearWindow();
      return { capture: false, progress: 0, reason: 'Captured. Move to a new view.' };
    }
    if (duplicateView(this.lastCapture, a.corners, width)) {
      this.clearWindow();
      return { capture: false, progress: 0, reason: 'Move or tilt the board for a different view' };
    }
    const handheld = this.steadiness === 'handheld';
    const holdMs = handheld ? 100 : HOLD_MS;
    const minFrames = handheld ? 3 : MIN_FRAMES;
    const scale = width / 640;
    const tolerance = STRICT_MOTION_AT_640;
    if (
      !this.anchor ||
      (!handheld &&
        commonDisplacement(this.anchor.corners, a.corners) > tolerance.displacement * scale)
    ) {
      this.startWindow(a.corners, now);
      return {
        capture: false,
        progress: 0,
        reason: handheld ? 'Estimating motion…' : 'Pause briefly at this view',
      };
    }
    this.samples++;
    this.recent.push({ corners: a.corners, time: now });
    // Retain the recent window and the profile’s minimum sample count at low analysis FPS.
    // Bounding history matters when auto capture is off but analysis continues.
    while (
      this.recent.length > minFrames &&
      (this.recent.length > 64 || this.recent[1]!.time <= now - holdMs)
    )
      this.recent.shift();
    const progress = Math.min(1, (now - this.anchor.time) / holdMs, this.samples / minFrames);
    const capture = progress === 1 && this.samples >= minFrames;
    if (capture) {
      const exposureLimit = MAX_EXPOSURE_TRAVEL_PX / exposureDuration(settings);
      const speedLimit = handheld
        ? exposureLimit
        : Math.min(tolerance.speed * scale, exposureLimit);
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
            handheld || exposureLimit < tolerance.speed * scale
              ? settings.exposureMode === 'manual' && settings.exposureTime! > 0
                ? 'Movement during exposure is too high. Use a shorter exposure.'
                : 'Exposure is unknown. Set a short manual exposure or use Timer.'
              : 'Movement detected. Pause briefly at this view.',
        };
      }
    }
    return {
      capture,
      progress,
      reason: capture ? 'Capturing…' : handheld ? 'Estimating motion…' : 'Keep this view steady…',
    };
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
export function coveragePrompt(frames: Frame[], width: number, height: number, rotated = false) {
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
    return `Add views near the ${names[rotated ? 8 - grid.cells.indexOf(min) : grid.cells.indexOf(min)]}. Use a varied distance and tilt.`;
  return 'Vary the distance and tilt left/right and forward/back. Include large close-up views.';
}
