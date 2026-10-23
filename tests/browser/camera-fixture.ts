import type { Page } from '@playwright/test';

export async function simulatedCameras(
  page: Page,
  imageControls = true,
  exposureControls = false,
  options: { boardImage?: string; windowsExposure?: boolean } = {},
) {
  await page.addInitScript(
    ({ imageControls, exposureControls, options }) => {
      if (options.windowsExposure)
        Object.defineProperty(navigator, 'userAgent', {
          value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
        });
      const state = ((window as any).cameraTest = {
        tracks: [] as MediaStreamTrack[],
        requests: [] as any[],
        adjustments: [] as any[],
        pauseCheck: false,
        releaseCheck: undefined as (() => void) | undefined,
        rejectExposure: false,
        offsetX: 0,
        showBoard: true,
        velocity: 0,
      });
      const devices = [
        { deviceId: 'camera-a', kind: 'videoinput', label: 'Camera A', groupId: 'a' },
        { deviceId: 'camera-b', kind: 'videoinput', label: 'Camera B', groupId: 'b' },
      ];
      Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
        value: async () => devices,
      });
      Object.defineProperty(navigator.mediaDevices, 'getSupportedConstraints', {
        value: () => ({
          width: true,
          height: true,
          frameRate: true,
          deviceId: true,
          resizeMode: true,
          ...(imageControls ? { brightness: true, contrast: true, exposureMode: true } : {}),
        }),
      });
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async ({ video }: any) => {
          state.requests.push(video);
          const deviceId = video.deviceId?.exact ?? 'camera-a';
          const modes =
            deviceId === 'camera-a'
              ? [
                  { width: 1280, height: 720, frameRate: 30 },
                  { width: 640, height: 480, frameRate: 60 },
                ]
              : [{ width: 800, height: 600, frameRate: 15 }];
          const select = (constraints: any) => {
            const mode = modes.find(
              (mode) =>
                (!constraints.width || constraints.width.exact === mode.width) &&
                (!constraints.height || constraints.height.exact === mode.height) &&
                (!constraints.frameRate || constraints.frameRate.exact === mode.frameRate),
            );
            if (!mode) throw new DOMException('Unsupported pair', 'OverconstrainedError');
            return mode;
          };
          let settings: Record<string, any> = {
            ...select(video),
            deviceId,
            resizeMode: 'none',
            ...(deviceId === 'camera-a' ? { brightness: 50 } : {}),
            ...(deviceId === 'camera-a' && exposureControls
              ? {
                  exposureMode: 'continuous',
                  exposureTime: options.windowsExposure ? 10000 / 128 : 100,
                  focusMode: 'manual',
                  focusDistance: 25,
                  zoom: 1,
                }
              : {}),
          };
          const board = options.boardImage ? new Image() : undefined;
          if (board) {
            board.src = options.boardImage!;
            await board.decode();
          }
          const started = performance.now();
          const canvas = document.createElement('canvas');
          const draw = () => {
            canvas.width = settings.width;
            canvas.height = settings.height;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#888';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (board && state.showBoard)
              ctx.drawImage(
                board,
                state.offsetX + (state.velocity * (performance.now() - started)) / 1000,
                0,
                canvas.width,
                canvas.height,
              );
          };
          draw();
          const stream = canvas.captureStream(settings.frameRate);
          const track = stream.getVideoTracks()[0]!;
          const timer = setInterval(draw, 30);
          state.tracks.push(track);
          Object.defineProperty(track, 'label', {
            value: devices.find((d) => d.deviceId === deviceId)!.label,
          });
          Object.defineProperty(track, 'getSettings', { value: () => ({ ...settings }) });
          Object.defineProperty(track, 'getCapabilities', {
            value: () => ({
              width: { min: 640, max: 1280 },
              height: { min: 480, max: 720 },
              frameRate: { min: 15, max: 60 },
              ...(deviceId === 'camera-a' ? { brightness: { min: 0, max: 100, step: 1 } } : {}),
              ...(deviceId === 'camera-a' && exposureControls
                ? {
                    exposureMode: ['continuous', 'manual'],
                    exposureTime: options.windowsExposure
                      ? { min: 10000 / 4096, max: 10000, step: 10000 / 4096 }
                      : { min: 10, max: 1000, step: 5 },
                    focusMode: ['manual', 'continuous'],
                    focusDistance: { min: 0, max: 100, step: 1 },
                    zoom: { min: 1, max: 3, step: 0.1 },
                  }
                : {}),
            }),
          });
          Object.defineProperty(track, 'applyConstraints', {
            value: async (constraints: any) => {
              if (state.pauseCheck) {
                state.pauseCheck = false;
                await new Promise<void>((resolve) => {
                  state.releaseCheck = resolve;
                });
              }
              state.adjustments.push(constraints);
              const control = { ...constraints.advanced?.[0] };
              if (exposureControls) {
                // Model Chromium's Windows backend: selecting manual requires
                // an exposure time in the same request to update the hardware.
                if (
                  control.exposureMode === 'manual' &&
                  (typeof control.exposureTime !== 'number' || state.rejectExposure)
                ) {
                  delete control.exposureMode;
                  delete control.exposureTime;
                }
              }
              if (options.windowsExposure && control.exposureTime > 0)
                control.exposureTime =
                  10000 * Math.pow(2, Math.trunc(Math.log2(control.exposureTime / 10000)));
              settings = { ...settings, ...select(constraints), ...control };
              draw();
            },
          });
          const stop = track.stop.bind(track);
          track.stop = () => {
            clearInterval(timer);
            stop();
          };
          return stream;
        },
      });
    },
    { imageControls, exposureControls, options },
  );
}
