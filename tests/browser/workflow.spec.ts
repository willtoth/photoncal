import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { simulatedCameras } from './camera-fixture';
const images = Array.from({ length: 12 }, (_, i) =>
  path.resolve(`.build/fixtures/img${i * 10}.png`),
);
test('missing WASM assets produce a recoverable engine error', async ({ page }) => {
  await page.route('**/engine/photoncal.wasm', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('The calibration engine couldn’t load.');
  await page.unroute('**/engine/photoncal.wasm');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('mrcal ready', { exact: true })).toBeVisible();
});
test('real board images → native WASM solve → diagnostics → PhotonVision export → archive recovery', async ({
  page,
  baseURL,
}, testInfo) => {
  await simulatedCameras(page, true, true);
  await page.addInitScript(() => {
    // Hold one real solve request long enough to exercise controls during calibration.
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, options?: any) {
      if (message.op === 'solve' && (window as any).holdNextSolve) {
        (window as any).holdNextSolve = false;
        (window as any).releaseSolve = () => send.call(this, message, options);
      } else send.call(this, message, options);
    };
  });
  const errors: string[] = [],
    remote: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== new URL(baseURL!).origin)
      remote.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByText('mrcal ready', { exact: true })).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles(images);
  await expect(page.getByText('12 images ready to analyze')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Browse saved sessions (0)', exact: true }),
  ).toBeVisible();
  await page.getByLabel('All images use the same camera, resolution, focus, and zoom.').check();
  await page.getByRole('button', { name: 'Analyze images', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Calibrate 12 images', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  await expect(
    page.getByRole('button', { name: 'Browse saved sessions (1)', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Calibrate 12 images', exact: true }).click();
  const downloadButton = page.getByRole('button', {
    name: 'Download PhotonVision JSON',
    exact: true,
  });
  await expect(downloadButton).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText('Projection uncertainty', { exact: true })).toBeVisible();
  const scene = page.locator('.calibration-scene');
  await expect(scene.getByText('12 solved poses', { exact: true })).toBeVisible();
  await expect(scene.getByRole('button', { name: 'Reset 3D view' })).toBeEnabled();
  await expect(scene.locator('.scene-error')).toHaveCount(0);
  const surface = scene.locator('canvas');
  const beforeOrbit = await surface.screenshot();
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  expect(beforeOrbit.equals(await surface.screenshot())).toBe(false);
  await scene.getByRole('combobox', { name: '3D capture' }).selectOption({ index: 1 });
  await expect(scene).toContainText('accepted /');
  await scene.getByRole('button', { name: 'Inspect selected image' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close image', exact: true }).click();
  await scene.getByRole('button', { name: 'Camera view', exact: true }).click();
  await scene.getByRole('button', { name: 'Zoom in 3D' }).click();
  await scene.getByRole('checkbox', { name: 'Camera frustum' }).uncheck();
  await scene.getByRole('button', { name: 'Reset 3D view' }).click();
  await scene.getByRole('checkbox', { name: 'Camera frustum' }).check();
  await scene.getByRole('combobox', { name: '3D capture' }).selectOption('');
  await scene.screenshot({ path: testInfo.outputPath('calibration-3d.png') });
  expect(await page.locator('.metric').first().textContent()).not.toContain('NaN');
  await page.screenshot({ path: testInfo.outputPath('results.png'), fullPage: true });
  const filePromise = page.waitForEvent('download');
  await downloadButton.click();
  const file = await filePromise;
  const jsonPath = testInfo.outputPath('photonvision.json');
  await file.saveAs(jsonPath);
  const json = JSON.parse(await readFile(jsonPath, 'utf8'));
  expect(json.resolution).toEqual({ width: 1280, height: 720 });
  expect(json.cameraIntrinsics.data).toHaveLength(9);
  expect(json.distCoeffs.data).toHaveLength(8);
  expect(json.lensmodel).toBe('LENSMODEL_OPENCV');
  expect(json.observations).toEqual([]);
  expect(json.cameraIntrinsics.data[0]).toBeGreaterThan(700);
  expect(json.cameraIntrinsics.data[0]).toBeLessThan(1600);
  await page.locator('.frame-thumb button').first().click();
  await page.getByRole('button', { name: 'Show undistorted', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show original', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close image', exact: true }).click();
  const archivePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save session archive', exact: true }).click();
  const archive = await archivePromise,
    archivePath = testInfo.outputPath('session.zip');
  await archive.saveAs(archivePath);
  await page.reload();
  await page.getByRole('button', { name: /Browse saved sessions/ }).click();
  await page
    .locator('.saved-sessions button')
    .filter({ hasText: 'Imported camera' })
    .first()
    .click();
  await expect(downloadButton).toBeEnabled();
  await page.locator('input[type=file][accept=".zip,application/zip"]').setInputFiles(archivePath);
  await expect(page.getByText('Session restored.', { exact: false })).toBeVisible();
  await expect(downloadButton).toBeEnabled();
  await page.locator('.frame-thumb input[type=checkbox]').first().uncheck();
  await expect(downloadButton).toBeDisabled();
  await expect(page.getByText('Results need updating', { exact: true })).toBeVisible();
  await expect(scene).toContainText('Recalibrate to show poses');
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
  // Reuse the solved, real-image dataset as a saved camera session fixture.
  // This checks Results controls without replacing the actual WASM solver.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('photoncal');
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('sessions', 'readwrite');
    const request = tx.objectStore('sessions').getAll();
    request.onsuccess = () => {
      const session = request.result.find((s: any) => s.result);
      session.source = 'camera';
      session.name = session.cameraLabel = 'Camera A';
      session.settings = { deviceId: 'camera-a', frameRate: 30 };
      session.frames.forEach((frame: any) => {
        frame.included = true;
      });
      session.revision++;
      tx.objectStore('sessions').put(session);
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole('button', { name: /Browse saved sessions/ }).click();
  await page.locator('.saved-sessions button').filter({ hasText: 'Camera A' }).first().click();
  await page.getByRole('navigation').getByRole('button', { name: 'Capture' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reconnect camera', exact: true }).click();
  const brightness = page.getByRole('slider', { name: 'Brightness', exact: true });
  await expect(brightness).toBeEnabled();
  await page.getByRole('navigation').getByRole('button', { name: 'Results' }).click();
  await expect(brightness).toBeEnabled();
  await page.evaluate(() => {
    (window as any).holdNextSolve = true;
  });
  await page.getByRole('button', { name: 'Recalibrate selected images', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel calculation' })).toBeVisible();
  await expect(brightness).toBeEnabled();
  await brightness.evaluate((input) => {
    (input as HTMLInputElement).value = '70';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(
    page.locator('.camera-control').filter({ has: brightness }).locator('output'),
  ).toHaveText('70');
  await page.evaluate(() => (window as any).releaseSolve());
  await expect(downloadButton).toBeEnabled({ timeout: 60_000 });
  await expect(brightness).toHaveValue('70');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const exported = async () => {
    const pending = page.waitForEvent('download');
    await downloadButton.click();
    const download = await pending;
    return JSON.parse(await readFile((await download.path())!, 'utf8'));
  };
  const beforeRotation = await exported();
  await page.getByRole('button', { name: 'Rotate preview 180°' }).click();
  expect(await exported()).toEqual(beforeRotation);

  await page.screenshot({
    path: testInfo.outputPath('results-camera-controls.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  // Missing graphics support must not break calibration exports.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: any[]
    ) {
      if (type.includes('webgl')) return null;
      return (original as Function).apply(this, [type, ...args]);
    } as typeof original;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.getByRole('button', { name: /Browse saved sessions/ }).click();
  await page.locator('.saved-sessions button').filter({ hasText: 'Camera A' }).first().click();
  await expect(scene).toContainText('3D rendering is unavailable');
  expect(await exported()).toEqual(beforeRotation);
  expect(errors).toEqual([]);
});

test('live capture handles zero media timestamps, handheld movement, and duplicate suppression', async ({
  page,
}, testInfo) => {
  await page.route('**/test-board.png', (route) =>
    route.fulfill({ path: images[0], contentType: 'image/png' }),
  );
  await page.addInitScript(() => {
    // Live streams may report mediaTime = 0 for every newly presented frame.
    // Keep the real callback cadence, frame counter, image, and WASM detector.
    (window as any).cameraMediaTimeOverride = 0;
    const requestFrame = HTMLVideoElement.prototype.requestVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
      return requestFrame.call(this, (now, metadata) =>
        callback(now, {
          ...metadata,
          mediaTime: (window as any).cameraMediaTimeOverride ?? metadata.mediaTime,
        }),
      );
    };
    // Real browser MediaStream/canvas + real WASM detector; only camera hardware is replaced.
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async (constraints: MediaStreamConstraints) => {
        (window as any).lastCameraRequest = constraints;
        const image = new Image();
        image.src = '/test-board.png';
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d')!;
        let offset = 0,
          motionStarted: number | undefined;
        const drift = () =>
          motionStarted === undefined ? 0 : (performance.now() - motionStarted) * 0.008;
        (window as any).startTestMotion = () => {
          motionStarted = performance.now();
        };
        (window as any).stopTestMotion = () => {
          offset += drift();
          motionStarted = undefined;
        };
        (window as any).moveTestBoard = () => {
          offset += 55;
        };
        const draw = () => {
          ctx.fillStyle = '#888';
          ctx.fillRect(0, 0, 1280, 720);
          ctx.drawImage(image, offset + drift(), 0);
        };
        draw();
        const interval = setInterval(draw, 50),
          stream = canvas.captureStream(20),
          track = stream.getVideoTracks()[0]!;
        const cameraSettings = {
          brightness: 50,
          exposureMode: 'manual',
          exposureTime: 100,
          focusMode: 'manual',
          focusDistance: 25,
          zoom: 1,
        };
        Object.defineProperty(track, 'getSettings', {
          value: () => ({
            width: 1280,
            height: 720,
            frameRate: 20,
            deviceId: 'test-camera',
            resizeMode: 'none',
            ...cameraSettings,
          }),
        });
        Object.defineProperty(track, 'getCapabilities', {
          value: () => ({
            brightness: { min: 0, max: 100, step: 1 },
            focusMode: ['manual', 'continuous'],
            focusDistance: { min: 0, max: 100, step: 1 },
            zoom: { min: 1, max: 3, step: 0.1 },
          }),
        });
        Object.defineProperty(track, 'applyConstraints', {
          value: async (constraints: any) => {
            Object.assign(cameraSettings, constraints.advanced?.[0]);
          },
        });
        const stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(interval);
          stop();
        };
        return stream;
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('mrcal ready', { exact: true })).toBeVisible();
  await page
    .locator('.camera-setup')
    .getByRole('button', { name: 'Check available settings', exact: true })
    .click();
  await page
    .locator('.camera-setup')
    .getByRole('button', { name: 'Start preview', exact: true })
    .click();
  await page.getByRole('button', { name: 'Continue to focus', exact: true }).click();
  await expect(page.getByText('Sharpness', { exact: true })).toBeVisible();
  await expect
    .poll(async () =>
      Number((await page.locator('.focus-number').textContent())?.replace('relative', '')),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Focus is set', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Focus distance', exact: true })).toBeEnabled();
  await expect(page.getByRole('slider', { name: 'Zoom', exact: true })).toBeEnabled();
  const steadiness = page.getByRole('combobox', { name: 'Capture steadiness', exact: true });
  await expect(steadiness).toHaveValue('handheld');
  await steadiness.selectOption('strict');
  await expect(
    page.getByRole('button', { name: 'Browse saved sessions (0)', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).startTestMotion());
  await page.getByRole('switch', { name: 'Automatic capture' }).click();
  await page.waitForTimeout(1000);
  await expect(page.locator('.gallery .count')).toHaveText('0');
  await steadiness.selectOption('handheld');
  await expect(page.locator('.gallery .count')).toHaveText('1', { timeout: 30_000 });
  await expect(
    page.getByRole('button', { name: 'Browse saved sessions (1)', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).stopTestMotion());
  await expect(page.getByRole('slider', { name: 'Focus distance', exact: true })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Zoom', exact: true })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Brightness', exact: true })).toBeEnabled();
  await expect(
    page.getByText('Move or tilt the board for a different view', { exact: true }),
  ).toBeVisible();
  // The gate must not repeatedly save a stationary board.
  await page.waitForTimeout(1800);
  await expect(page.locator('.gallery .count')).toHaveText('1');
  await page.evaluate(() => {
    // Switching back to ordinary media timestamps must not affect capture.
    (window as any).cameraMediaTimeOverride = undefined;
    (window as any).moveTestBoard();
  });
  await expect(page.locator('.gallery .count')).toHaveText('2', { timeout: 30_000 });
  await page.getByRole('switch', { name: 'Automatic capture' }).click();
  await page.screenshot({ path: testInfo.outputPath('handheld-capture.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('photoncal');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const blobs = await new Promise<Blob[]>((resolve, reject) => {
      const r = db.transaction('images').objectStore('images').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return Promise.all(
      blobs.map(async (b) => {
        const image = await createImageBitmap(b);
        const size = [image.width, image.height];
        image.close();
        return size;
      }),
    );
  });
  expect(saved).toEqual([
    [1280, 720],
    [1280, 720],
  ]);
  await page.locator('.sidebar nav button').first().click();
  await expect(page.getByLabel('Resolution and frame rate')).toHaveCount(0);
  await expect(page.locator('.camera-setup')).toContainText('Session resolution: 1280 × 720');
  await page.getByRole('button', { name: 'New calibration', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Browse saved sessions (1)', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Browse saved sessions/ }).click();
  await page.locator('.saved-sessions button').first().click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reconnect camera', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Automatic capture' })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).lastCameraRequest.video)).toMatchObject({
    width: { exact: 1280 },
    height: { exact: 720 },
    frameRate: { exact: 20 },
  });
  await page.getByRole('button', { name: 'Delete Capture 1', exact: true }).click();
  await expect(page.locator('.gallery .count')).toHaveText('1');
  await expect(
    page.getByRole('button', { name: 'Browse saved sessions (1)', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete Capture 2', exact: true }).click();
  await expect(page.locator('.gallery .count')).toHaveText('0');
  await expect(
    page.getByRole('button', { name: 'Browse saved sessions (0)', exact: true }),
  ).toBeVisible();
});

test('permission failures remain actionable and narrow screens do not overflow', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .locator('.camera-setup')
    .getByRole('button', { name: 'Check available settings', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Camera permission was denied');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
