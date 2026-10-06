import { it, expect, vi, afterEach } from 'vitest';
import { discoverCamera, modeKey } from '../../src/core/cameraModes';
import { type CameraMode } from '../../src/core/camera';

afterEach(() => vi.unstubAllGlobals());

function fixture(
  modes: CameraMode[] = [
    { width: 1280, height: 720, frameRate: 30 },
    { width: 1280, height: 720, frameRate: 15 },
    { width: 640, height: 480, frameRate: 60 },
    { width: 1920, height: 1080, frameRate: 15 },
  ],
) {
  let settings: Record<string, any> = {
    ...modes[0],
    deviceId: 'usb1',
    resizeMode: 'none',
    brightness: 10,
  };
  const caps: Record<string, any> = {
    width: { min: 320, max: 1920 },
    height: { min: 240, max: 1080 },
    frameRate: { min: 15, max: 60 },
    brightness: { min: 0, max: 255, step: 1 },
    contrast: { min: 0, max: 0 },
    focusMode: [],
  };
  const track = {
    label: 'USB test camera',
    readyState: 'live',
    onended: null as (() => void) | null,
    getCapabilities: () => caps,
    getSettings: () => ({ ...settings }),
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
    applyConstraints: vi.fn(async (constraints: any) => {
      const requested = {
        width: constraints.width.exact,
        height: constraints.height.exact,
        frameRate: constraints.frameRate?.exact,
      };
      // Some drivers ignore requests instead of rejecting them.
      if (requested.width === 800) return;
      const mode = modes.find((mode) => modeKey(mode) === modeKey(requested));
      if (!mode) throw new DOMException('Unsupported combination', 'OverconstrainedError');
      settings = { ...settings, ...mode };
    }),
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const devices = [{ deviceId: 'usb1', kind: 'videoinput', label: track.label }];
  const getUserMedia = vi.fn(async (_constraints: any) => stream);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia,
      getSupportedConstraints: () => ({ resizeMode: true }),
      enumerateDevices: vi.fn(async () => devices),
    },
  });
  return { track, stream, caps, getUserMedia, devices, modes };
}

it('returns verified pairs, not the cross product of capability ranges, and closes the probe', async () => {
  const f = fixture();
  const progress = vi.fn();
  const result = await discoverCamera('', {
    signal: new AbortController().signal,
    onProgress: progress,
  });
  expect(result.modes.map(modeKey).sort()).toEqual(f.modes.map(modeKey).sort());
  expect(result.defaultMode).toEqual(f.modes[0]);
  expect(result.deviceId).toBe('usb1');
  expect(result.devices).toEqual(f.devices);
  expect(result.controls.map((control) => control.key)).toEqual(['brightness']);
  expect(result.unscaled).toBe(true);
  expect(f.getUserMedia).toHaveBeenCalledTimes(1);
  expect(f.track.stop).toHaveBeenCalledTimes(1);
  expect(f.track.onended).toBeNull();
  const [checked, total] = progress.mock.lastCall!;
  expect(checked).toBe(total);
  expect(total).toBeGreaterThan(f.modes.length);
});

it('keeps an unusual default resolution and fractional FPS', async () => {
  const mode = { width: 1232, height: 800, frameRate: 29.97 };
  fixture([mode]);
  const result = await discoverCamera('usb1', { signal: new AbortController().signal });
  expect(result.modes).toEqual([mode]);
});

it('does not invent FPS when the browser does not report it', async () => {
  const mode = { width: 1280, height: 720 };
  fixture([mode]);
  const result = await discoverCamera('usb1', { signal: new AbortController().signal });
  expect(result.modes).toEqual([mode]);
});

it('releases the probe on a driver failure rather than calling it an unsupported mode', async () => {
  const f = fixture();
  f.track.applyConstraints.mockRejectedValueOnce(
    new DOMException('Camera unplugged', 'NotReadableError'),
  );
  await expect(discoverCamera('usb1', { signal: new AbortController().signal })).rejects.toThrow(
    'Camera unplugged',
  );
  expect(f.track.stop).toHaveBeenCalled();
});

it('cancels between probes and releases the device', async () => {
  const f = fixture();
  const controller = new AbortController();
  await expect(
    discoverCamera('usb1', {
      signal: controller.signal,
      onProgress: (checked) => {
        if (checked === 1) controller.abort();
      },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.track.applyConstraints).toHaveBeenCalledTimes(1);
  expect(f.track.stop).toHaveBeenCalled();
});

it('releases a stream returned after the user cancels the permission request', async () => {
  const f = fixture();
  let resolve!: (stream: typeof f.stream) => void;
  f.getUserMedia.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const controller = new AbortController();
  const discovery = discoverCamera('usb1', { signal: controller.signal });
  controller.abort();
  resolve(f.stream);
  await expect(discovery).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.track.stop).toHaveBeenCalled();
  expect(f.track.applyConstraints).not.toHaveBeenCalled();
});

it('does not open a device if the check was already cancelled', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(discoverCamera('usb1', { signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(f.getUserMedia).not.toHaveBeenCalled();
});
