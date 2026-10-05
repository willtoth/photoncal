export interface Control {
  key: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: string[];
  unit?: string;
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
  async connect(deviceId: string, width: number, height: number) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera access needs HTTPS or localhost in a supported browser.');
    this.stop();
    const supported =
      navigator.mediaDevices.getSupportedConstraints() as MediaTrackSupportedConstraints & {
        resizeMode?: boolean;
      };
    const video: MediaTrackConstraints & { resizeMode?: { exact: string } } = {
      width: { exact: width },
      height: { exact: height },
      frameRate: { ideal: 30 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    };
    if (supported.resizeMode) video.resizeMode = { exact: 'none' };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      const name = (e as DOMException).name;
      const messages: Record<string, string> = {
        NotAllowedError:
          'Camera permission was denied. Allow camera access in your browser settings, then try again.',
        NotReadableError:
          'The camera is busy or unavailable. Close other camera apps and reconnect.',
        NotFoundError: 'No camera was found. Connect a USB camera and try again.',
        OverconstrainedError: `The camera cannot deliver ${width} × ${height} without resizing. Choose another resolution.`,
      };
      throw new Error(messages[name] ?? (e as Error).message);
    }
    const track = this.stream.getVideoTracks()[0]!;
    this.capabilities = track.getCapabilities?.() ?? {};
    this.settings = track.getSettings();
    if (this.settings.width !== width || this.settings.height !== height) {
      this.stop();
      throw new Error(
        'The camera returned a different resolution. Choose its delivered mode and reconnect.',
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
      if (Array.isArray(cap)) return [{ ...def, choices: cap }];
      if (cap && typeof cap.min === 'number')
        return [{ ...def, min: cap.min, max: cap.max, step: cap.step || 1 }];
      return [];
    });
  }
  async set(key: string, value: string | number) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) throw new Error('Connect a camera first.');
    await track.applyConstraints({ advanced: [{ [key]: value }] });
    this.settings = track.getSettings();
    const actual = this.settings[key];
    if (
      actual !== undefined &&
      (typeof value === 'string'
        ? actual !== value
        : Math.abs(actual - value) > (this.capabilities[key]?.step || 0.001))
    )
      throw new Error(`The camera did not apply ${key}. Its current value is ${actual}.`);
  }
  stop() {
    if (this.stream)
      for (const track of this.stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
    this.stream = undefined;
  }
}
