export interface Control {
  key: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: string[];
  unit?: string;
}
export interface CameraMode {
  width: number;
  height: number;
  frameRate?: number;
}

export function modeLabel(mode: CameraMode): string {
  return `${mode.width} × ${mode.height} · ${mode.frameRate === undefined ? 'FPS not reported' : `${Number(mode.frameRate.toFixed(2))} fps`}`;
}

export function videoConstraints(deviceId: string, mode?: CameraMode): MediaTrackConstraints {
  const video: MediaTrackConstraints & { resizeMode?: { exact: string } } = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    ...(mode ? { width: { exact: mode.width }, height: { exact: mode.height } } : {}),
    ...(mode?.frameRate !== undefined ? { frameRate: { exact: mode.frameRate } } : {}),
  };
  const supported = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean>;
  if (supported.resizeMode) video.resizeMode = { exact: 'none' };
  return video;
}

export function matchesMode(settings: Record<string, any>, mode: CameraMode): boolean {
  return (
    settings.width === mode.width &&
    settings.height === mode.height &&
    (mode.frameRate === undefined ||
      (typeof settings.frameRate === 'number' &&
        Math.abs(settings.frameRate - mode.frameRate) < 0.01))
  );
}
export const cameraControlDefinitions: Control[] = [
  { key: 'exposureMode', label: 'Exposure mode' },
  { key: 'exposureTime', label: 'Shutter / exposure', unit: '100 µs' },
  { key: 'exposureCompensation', label: 'Exposure compensation' },
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'sharpness', label: 'Sharpening' },
  { key: 'whiteBalanceMode', label: 'White balance' },
  { key: 'colorTemperature', label: 'Color temperature', unit: 'K' },
  { key: 'focusMode', label: 'Focus mode' },
  { key: 'focusDistance', label: 'Focus distance' },
  { key: 'zoom', label: 'Zoom' },
];
export class Camera {
  stream?: MediaStream;
  capabilities: Record<string, any> = {};
  settings: Record<string, any> = {};
  onEnded?: () => void;
  private generation = 0;
  private constraints: MediaTrackConstraints = {};
  async connect(deviceId: string, mode?: CameraMode) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera access needs HTTPS or localhost in a supported browser.');
    this.stop();
    const generation = this.generation;
    const video = videoConstraints(deviceId, mode);
    this.constraints = video;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException('Camera request cancelled.', 'AbortError');
      }
      this.stream = stream;
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'AbortError') throw e;
      const messages: Record<string, string> = {
        NotAllowedError:
          'Camera permission was denied. Allow camera access in your browser settings, then try again.',
        NotReadableError:
          'The camera is busy or unavailable. Close other camera apps and reconnect.',
        NotFoundError: 'No camera was found. Connect a USB camera and try again.',
        OverconstrainedError: mode
          ? `The camera cannot deliver ${modeLabel(mode)}. Check available settings again.`
          : 'The camera could not open without resizing. Try another camera or browser.',
      };
      throw new Error(messages[name] ?? (e as Error).message);
    }
    const track = this.stream.getVideoTracks()[0];
    if (!track) {
      this.stop();
      throw new Error('The camera returned no video. Try another camera.');
    }
    this.capabilities = track.getCapabilities?.() ?? {};
    this.settings = track.getSettings();
    if (
      (mode && !matchesMode(this.settings, mode)) ||
      ('resizeMode' in video && this.settings.resizeMode && this.settings.resizeMode !== 'none')
    ) {
      this.stop();
      throw new Error(
        'The camera returned different settings. Check available settings again before starting preview.',
      );
    }
    track.onended = () => {
      this.stop();
      this.onEnded?.();
    };
    return this.stream;
  }
  controls(): Control[] {
    return cameraControlDefinitions.flatMap<Control>((def) => {
      const cap = this.capabilities[def.key];
      if (cap === undefined) return [];
      if (Array.isArray(cap) && cap.length > 1) return [{ ...def, choices: cap }];
      if (cap && Number.isFinite(cap.min) && Number.isFinite(cap.max) && cap.max > cap.min)
        return [{ ...def, min: cap.min, max: cap.max, step: cap.step || 1 }];
      return [];
    });
  }
  async set(key: string, value: string | number) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) throw new Error('Connect a camera first.');
    const requested: Record<string, string | number> = { [key]: value };
    if (key === 'exposureMode' && value === 'manual') {
      // Chromium's Windows backend commits manual exposure only when a shutter
      // value accompanies it. Freeze the latest reported value, not the value
      // cached when the stream was opened while auto exposure was still running.
      const current = (track.getSettings() as Record<string, any>).exposureTime;
      const range = (track.getCapabilities?.() as Record<string, any> | undefined)?.exposureTime;
      if (typeof current === 'number' && Number.isFinite(current)) {
        requested.exposureTime =
          Number.isFinite(range?.min) && Number.isFinite(range?.max)
            ? Math.max(range.min, Math.min(range.max, current))
            : current;
      }
    } else if (key === 'exposureTime') {
      requested.exposureMode = 'manual';
    }
    // Keep the selected resolution/FPS and no-resizing constraint when adjusting controls.
    await track.applyConstraints({ ...this.constraints, advanced: [requested] });
    this.settings = track.getSettings();
    this.capabilities = track.getCapabilities?.() ?? {};
    const actual = this.settings[key];
    if (
      actual !== undefined &&
      (typeof value === 'string'
        ? actual !== value
        : Math.abs(actual - value) > (this.capabilities[key]?.step || 0.001))
    )
      throw new Error(
        `The camera did not apply ${cameraControlDefinitions.find((c) => c.key === key)?.label.toLowerCase() ?? key} (${value}). Its current value is ${actual}.`,
      );
    if (key === 'exposureTime' && this.settings.exposureMode !== 'manual')
      throw new Error(
        'The camera did not enable manual exposure. Try changing exposure mode again.',
      );
  }
  stop() {
    this.generation++;
    if (this.stream)
      for (const track of this.stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
    this.stream = undefined;
  }
}
