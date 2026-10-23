export interface ExposureRange {
  min: number;
  max: number;
  step?: number;
}

export const exposureSeconds = (value: number) => value / 10000;
export const exposureMilliseconds = (value: number) => value / 10;
export function exposureLabel(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'Not reported';
  const seconds = exposureSeconds(value);
  return `${Number((seconds * 1000).toPrecision(4))} ms${seconds < 1 ? ` · 1/${Number((1 / seconds).toPrecision(4))} s` : ''}`;
}

// Chromium Windows reports the smallest absolute gap: (2^nativeStep - 1) * min.
// Older versions reported the ratio directly. Neither describes additive stops.
// See chromium/media/capture/video/win/video_capture_device_utils_win.cc.
export function exposureScale(range: ExposureRange, windows = false) {
  const { min, max } = range;
  const step = Number.isFinite(range.step) && range.step! > 0 ? range.step! : 1;
  const powerOfTwo = (v: number) =>
    v > 0 && Math.abs(Math.log2(v) - Math.round(Math.log2(v))) < 1e-6;
  const ratio = powerOfTwo(1 + step / min) ? 1 + step / min : step;
  const discrete =
    windows && powerOfTwo(min / 10000) && powerOfTwo(max / 10000) && ratio > 1 && powerOfTwo(ratio);
  const stops: number[] = [];
  if (discrete)
    for (let v = min; v <= max * (1 + 1e-9) && stops.length < 128; v *= ratio)
      stops.push(Math.min(v, max));
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const snap = (v: number) => {
    v = clamp(Number.isFinite(v) ? v : min);
    if (stops.length)
      return stops.reduce((best, stop) =>
        Math.abs(Math.log(stop / v)) < Math.abs(Math.log(best / v)) ? stop : best,
      );
    return clamp(
      Number(
        (
          min +
          Math.min(Math.floor((max - min) / step + 1e-9), Math.round((v - min) / step)) * step
        ).toPrecision(12),
      ),
    );
  };
  const logarithmic = min > 0 && max > min;
  const maximum = stops.length ? stops.length - 1 : 1000;
  return {
    stops,
    maximum,
    snap,
    fromPosition(position: number) {
      if (stops.length) return stops[Math.max(0, Math.min(maximum, Math.round(position)))]!;
      return snap(
        logarithmic
          ? min * Math.pow(max / min, position / maximum)
          : min + ((max - min) * position) / maximum,
      );
    },
    toPosition(value: number) {
      if (stops.length) return stops.indexOf(snap(value));
      return logarithmic
        ? (Math.log(clamp(value) / min) / Math.log(max / min)) * maximum
        : ((clamp(value) - min) / (max - min)) * maximum;
    },
    adjacent(value: number, direction: number) {
      return stops.length
        ? stops[Math.max(0, Math.min(maximum, stops.indexOf(snap(value)) + direction))]!
        : snap(value + direction * step);
    },
  };
}
