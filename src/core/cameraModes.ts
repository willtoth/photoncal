import { Camera, matchesMode, videoConstraints, type CameraMode, type Control } from './camera';

export interface CameraDiscovery {
  deviceId: string;
  label: string;
  modes: CameraMode[];
  defaultMode: CameraMode;
  controls: Control[];
  settings: Record<string, any>;
  devices: MediaDeviceInfo[];
  unscaled: boolean;
}

// Browsers expose ranges, not a native mode table. These are probe candidates;
// only configurations confirmed by getSettings() are offered to the user.
const resolutions = [
  [320, 240],
  [640, 360],
  [640, 480],
  [800, 600],
  [848, 480],
  [960, 540],
  [960, 720],
  [1024, 768],
  [1280, 720],
  [1280, 800],
  [1280, 960],
  [1280, 1024],
  [1600, 900],
  [1600, 1200],
  [1920, 1080],
  [1920, 1200],
  [2048, 1536],
  [2560, 1440],
  [2592, 1944],
  [3840, 2160],
  [4096, 2160],
];

export function modeKey(mode: CameraMode): string {
  return `${mode.width}x${mode.height}@${mode.frameRate ?? 'default'}`;
}

function readMode(settings: Record<string, any>): CameraMode | undefined {
  const { width, height, frameRate } = settings;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 33554432
  )
    return;
  return { width, height, ...(Number.isFinite(frameRate) && frameRate > 0 ? { frameRate } : {}) };
}

function inRange(value: number, range: any): boolean {
  return (
    (!Number.isFinite(range?.min) || value >= range.min) &&
    (!Number.isFinite(range?.max) || value <= range.max)
  );
}

export async function discoverCamera(
  deviceId: string,
  options: {
    signal: AbortSignal;
    preferred?: CameraMode;
    onProgress?: (checked: number, total: number) => void;
  },
): Promise<CameraDiscovery> {
  const camera = new Camera();
  const { signal } = options;
  const abort = () => camera.stop();
  signal.throwIfAborted();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const stream = await camera.connect(deviceId);
    signal.throwIfAborted();
    const track = stream.getVideoTracks()[0]!;
    const initialSettings = { ...camera.settings };
    const defaultMode = readMode(initialSettings);
    if (!defaultMode)
      throw new Error(
        'The browser did not report a usable camera resolution. Try another camera or browser.',
      );
    const actualId = initialSettings.deviceId || deviceId;
    const requestsUnscaled = 'resizeMode' in videoConstraints(actualId);
    const capabilities = camera.capabilities;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'videoinput',
    );
    signal.throwIfAborted();
    const dimensions = new Map<string, [number, number]>();
    for (const [width, height] of [
      [defaultMode.width, defaultMode.height],
      ...(options.preferred ? [[options.preferred.width, options.preferred.height]] : []),
      ...resolutions,
      [capabilities.width?.max, capabilities.height?.max],
    ]) {
      if (
        readMode({ width, height }) &&
        inRange(width!, capabilities.width) &&
        inRange(height!, capabilities.height)
      )
        dimensions.set(`${width}x${height}`, [width!, height!]);
    }
    const rates = [
      ...new Set([
        defaultMode.frameRate,
        options.preferred?.frameRate,
        15,
        24,
        25,
        30,
        50,
        60,
        capabilities.frameRate?.max,
      ]),
    ].filter(
      (rate): rate is number =>
        Number.isFinite(rate) &&
        rate! > 0 &&
        rate! <= 240 &&
        inRange(rate!, capabilities.frameRate),
    );
    const candidates: CameraMode[] = [];
    for (const [width, height] of dimensions.values()) {
      for (const frameRate of rates) candidates.push({ width, height, frameRate });
      // If FPS is unavailable, still check dimensions without inventing a rate.
      if (!rates.length || defaultMode.frameRate === undefined) candidates.push({ width, height });
    }
    const modes = new Map<string, CameraMode>([[modeKey(defaultMode), defaultMode]]);
    options.onProgress?.(0, candidates.length);
    for (const [index, candidate] of candidates.entries()) {
      signal.throwIfAborted();
      try {
        await track.applyConstraints(videoConstraints(actualId, candidate));
        signal.throwIfAborted();
        const settings = track.getSettings() as Record<string, any>;
        const delivered = readMode(settings);
        if (
          delivered &&
          matchesMode(settings, candidate) &&
          (!requestsUnscaled || !settings.resizeMode || settings.resizeMode === 'none')
        )
          modes.set(modeKey(delivered), delivered);
      } catch (e) {
        signal.throwIfAborted();
        // Unsupported combinations are expected. Device/permission failures are not.
        if ((e as DOMException).name !== 'OverconstrainedError') throw e;
      }
      if (track.readyState === 'ended')
        throw new Error(
          'The camera disconnected while checking settings. Reconnect it and try again.',
        );
      options.onProgress?.(index + 1, candidates.length);
    }
    return {
      deviceId: actualId,
      label: track.label,
      modes: [...modes.values()].sort(
        (a, b) =>
          a.width * a.height - b.width * b.height ||
          a.width - b.width ||
          (a.frameRate ?? 0) - (b.frameRate ?? 0),
      ),
      defaultMode,
      controls: camera.controls(),
      settings: initialSettings,
      devices,
      unscaled: initialSettings.resizeMode === 'none',
    };
  } finally {
    signal.removeEventListener('abort', abort);
    camera.stop();
  }
}
