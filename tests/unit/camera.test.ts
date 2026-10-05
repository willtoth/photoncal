import { it, expect, vi, afterEach } from 'vitest';
import { Camera } from '../../src/core/camera';
afterEach(() => vi.unstubAllGlobals());
function media(settings: Record<string, any> = { width: 1280, height: 720 }) {
  const track = {
    getSettings: () => settings,
    getCapabilities: () => ({ brightness: { min: 0, max: 255, step: 1 } }),
    stop: vi.fn(),
    onended: null,
    applyConstraints: vi.fn(async () => {}),
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia, getSupportedConstraints: () => ({ resizeMode: true }) },
  });
  return { track, getUserMedia };
}
it('requests the exact sensor mode, disables resizing, and exposes only real controls', async () => {
  const m = media(),
    camera = new Camera();
  await camera.connect('usb1', 1280, 720);
  expect(m.getUserMedia).toHaveBeenCalledWith({
    audio: false,
    video: {
      width: { exact: 1280 },
      height: { exact: 720 },
      frameRate: { ideal: 30 },
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
  await expect(new Camera().connect('', 1280, 720)).rejects.toThrow('different resolution');
  expect(m.track.stop).toHaveBeenCalled();
});
it('surfaces permission denial and ignored camera controls', async () => {
  const m = media({ width: 1280, height: 720, brightness: 10 });
  const c = new Camera();
  await c.connect('', 1280, 720);
  await expect(c.set('brightness', 100)).rejects.toThrow('did not apply');
  m.getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
  await expect(c.connect('', 1280, 720)).rejects.toThrow('permission was denied');
});
