import { test, expect, type Page } from '@playwright/test';

async function simulatedCameras(page: Page) {
  await page.addInitScript(() => {
    const state = ((window as any).cameraTest = {
      tracks: [] as MediaStreamTrack[],
      requests: [] as any[],
      adjustments: [] as any[],
      pauseCheck: false,
      releaseCheck: undefined as (() => void) | undefined,
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
        };
        const canvas = document.createElement('canvas');
        const draw = () => {
          canvas.width = settings.width;
          canvas.height = settings.height;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#888';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
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
            settings = { ...settings, ...select(constraints), ...constraints.advanced?.[0] };
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
  });
}

test('checks pairs before preview, preserves active settings until restart, and resets on device change', async ({
  page,
}, testInfo) => {
  await simulatedCameras(page);
  await page.goto('/');
  const setup = page.locator('.camera-setup');
  const selection = page.getByLabel('Resolution and frame rate');
  const brightness = page.getByRole('slider', { name: /Brightness/ });
  await expect(selection).toHaveCount(0);
  await expect(page.getByText('Custom resolution', { exact: true })).toHaveCount(0);
  await setup.getByRole('button', { name: 'Check available settings', exact: true }).click();
  await expect(selection.locator('option')).toHaveText([
    '640 × 480 · 60 fps',
    '1280 × 720 · 30 fps',
  ]);
  await expect(brightness).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as any).cameraTest.tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'),
    ),
  ).toBe(true);
  await selection.selectOption('640x480@60');
  await setup.getByRole('button', { name: 'Start preview', exact: true }).click();
  await expect(brightness).toBeEnabled();
  await expect
    .poll(() => page.locator('video').evaluate((video) => (video as HTMLVideoElement).videoWidth))
    .toBe(640);
  await brightness.evaluate((input) => {
    (input as HTMLInputElement).value = '80';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('.camera-control output')).toHaveText('80');
  expect(await page.evaluate(() => (window as any).cameraTest.adjustments.at(-1))).toMatchObject({
    width: { exact: 640 },
    height: { exact: 480 },
    frameRate: { exact: 60 },
    resizeMode: { exact: 'none' },
    advanced: [{ brightness: 80 }],
  });
  await selection.selectOption('1280x720@30');
  await expect(page.getByRole('button', { name: 'Continue to focus', exact: true })).toBeDisabled();
  await expect(page.locator('.camera-details')).toContainText('640 × 480 · 60 fps');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Capture' }).click();
  await expect(page.getByRole('heading', { name: 'Camera setup' })).toBeVisible();
  await expect(
    page.getByText('Restart preview to apply the selected camera settings.'),
  ).toBeVisible();
  await setup.getByRole('button', { name: 'Restart preview', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((video) => (video as HTMLVideoElement).videoWidth))
    .toBe(1280);
  await expect(page.getByRole('button', { name: 'Continue to focus', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('camera-settings.png'), fullPage: true });
  await setup.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('camera-b');
  await expect(selection).toHaveCount(0);
  await expect(brightness).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).cameraTest.tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'),
    ),
  ).toBe(true);
  await setup.getByRole('button', { name: 'Check available settings', exact: true }).click();
  await expect(selection.locator('option')).toHaveText(['800 × 600 · 15 fps']);
  await expect(page.getByText(/Not adjustable in this browser:/)).toContainText('brightness');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('camera-settings-mobile.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('cancelling a check releases the camera and a late result cannot replace a new check', async ({
  page,
}) => {
  await simulatedCameras(page);
  await page.goto('/');
  const setup = page.locator('.camera-setup');
  await page.evaluate(() => {
    (window as any).cameraTest.pauseCheck = true;
  });
  await setup.getByRole('button', { name: 'Check available settings', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).cameraTest.releaseCheck))
    .toBe(true);
  await page.getByRole('button', { name: 'Cancel check', exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).cameraTest.tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'),
    ),
  ).toBe(true);
  await setup.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('camera-b');
  await setup.getByRole('button', { name: 'Check available settings', exact: true }).click();
  await expect(page.getByLabel('Resolution and frame rate').locator('option')).toHaveText([
    '800 × 600 · 15 fps',
  ]);
  await page.evaluate(() => (window as any).cameraTest.releaseCheck());
  await expect(page.getByLabel('Resolution and frame rate').locator('option')).toHaveText([
    '800 × 600 · 15 fps',
  ]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
