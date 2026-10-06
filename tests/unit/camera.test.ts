import { it, expect, vi, afterEach } from 'vitest';
import { Camera } from '../../src/core/camera';
afterEach(() => vi.unstubAllGlobals());
const mode = { width: 1280, height: 720, frameRate: 30 };
function media(
  settings: Record<string, any> = { ...mode },
  capabilities: Record<string, any> = { brightness: { min: 0, max: 255, step: 1 } },
) {
  const track = {
    getSettings: () => ({ ...settings }),
    getCapabilities: () => capabilities,
    stop: vi.fn(),
    onended: null,
    applyConstraints: vi.fn(async (_constraints: any) => {}),
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const getUserMedia = vi.fn(async (_constraints: any) => stream);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia, getSupportedConstraints: () => ({ resizeMode: true }) },
  });
  return { track, getUserMedia };
}
it('requests the exact sensor mode, disables resizing, and exposes only real controls', async () => {
  const m = media(),
    camera = new Camera();
  await camera.connect('usb1', mode);
  expect(m.getUserMedia).toHaveBeenCalledWith({
    audio: false,
    video: {
      width: { exact: 1280 },
      height: { exact: 720 },
      frameRate: { exact: 30 },
      deviceId: { exact: 'usb1' },
      resizeMode: { exact: 'none' },
    },
  });
  expect(camera.controls()).toEqual([
    { key: 'brightness', label: 'Brightness', min: 0, max: 255, step: 1 },
  ]);
  camera.stop();
  expect(m.track.stop).toHaveBeenCalled();
});
it('rejects an unexpected delivered resolution and stops its stream', async () => {
  const m = media({ width: 640, height: 480 });
  await expect(new Camera().connect('', mode)).rejects.toThrow('different settings');
  expect(m.track.stop).toHaveBeenCalled();
});
it('surfaces permission denial and ignored camera controls', async () => {
  const m = media({ ...mode, brightness: 10 });
  const c = new Camera();
  await c.connect('', mode);
  await expect(c.set('brightness', 100)).rejects.toThrow('did not apply');
  m.getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
  await expect(c.connect('', mode)).rejects.toThrow('permission was denied');
});

it('rejects an ignored frame-rate constraint and releases the camera', async () => {
  const m = media({ ...mode, frameRate: 15 });
  await expect(new Camera().connect('', mode)).rejects.toThrow('different settings');
  expect(m.track.stop).toHaveBeenCalled();
});

it('retains capture constraints when a brightness control changes', async () => {
  const settings = { ...mode, brightness: 10 };
  const m = media(settings);
  const camera = new Camera();
  await camera.connect('usb1', mode);
  m.track.applyConstraints.mockImplementation(async () => {
    settings.brightness = 50;
  });
  await camera.set('brightness', 50);
  expect(m.track.applyConstraints).toHaveBeenCalledWith({
    deviceId: { exact: 'usb1' },
    width: { exact: 1280 },
    height: { exact: 720 },
    frameRate: { exact: 30 },
    resizeMode: { exact: 'none' },
    advanced: [{ brightness: 50 }],
  });
  expect(camera.settings.brightness).toBe(50);
});

it('opens legacy sessions without inventing an unreported frame rate', async () => {
  const m = media({ width: 1280, height: 720 });
  await new Camera().connect('usb1', { width: 1280, height: 720 });
  expect(m.getUserMedia.mock.calls[0]?.[0]).not.toHaveProperty('video.frameRate');
});

it('switches to manual exposure on cameras that require a shutter value with the mode', async () => {
  const settings = { ...mode, exposureMode: 'continuous', exposureTime: 100 };
  const m = media(settings, {
    exposureMode: ['manual', 'continuous'],
    exposureTime: { min: 10, max: 1000, step: 5 },
  });
  // Chromium's Windows backend only commits manual mode to the device when
  // an exposure time is supplied. A mode-only request resolves without changing it.
  m.track.applyConstraints.mockImplementation(async ({ advanced }) => {
    const control = advanced[0];
    if (control.exposureMode === 'continuous') settings.exposureMode = 'continuous';
    if (control.exposureMode === 'manual' && typeof control.exposureTime === 'number') {
      settings.exposureMode = 'manual';
      settings.exposureTime = control.exposureTime;
    }
  });
  const camera = new Camera();
  await camera.connect('usb1', mode);
  // Auto exposure may have changed since the camera was opened.
  settings.exposureTime = 200;
  await camera.set('exposureMode', 'manual');
  expect(camera.settings.exposureMode).toBe('manual');
  expect(camera.settings.exposureTime).toBe(200);
  await camera.set('exposureTime', 50);
  expect(camera.settings.exposureMode).toBe('manual');
  expect(camera.settings.exposureTime).toBe(50);
  await camera.set('exposureMode', 'continuous');
  expect(camera.settings.exposureMode).toBe('continuous');
});
