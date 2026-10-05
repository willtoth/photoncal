import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
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
  await page.getByLabel('All images use the same camera, resolution, focus, and zoom.').check();
  await page.getByRole('button', { name: 'Analyze images', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Calibrate 12 images', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Calibrate 12 images', exact: true }).click();
  const downloadButton = page.getByRole('button', {
    name: 'Download PhotonVision JSON',
    exact: true,
  });
  await expect(downloadButton).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText('Projection uncertainty', { exact: true })).toBeVisible();
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
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});

test('live camera focus, stillness capture, duplicate suppression, and full-resolution snapshots', async ({
  page,
}) => {
  await page.route('**/test-board.png', (route) =>
    route.fulfill({ path: images[0], contentType: 'image/png' }),
  );
  await page.addInitScript(() => {
    // Real browser MediaStream/canvas + real WASM detector; only camera hardware is replaced.
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const image = new Image();
        image.src = '/test-board.png';
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d')!;
        let offset = 0;
        (window as any).moveTestBoard = () => {
          offset = 55;
        };
        const draw = () => {
          ctx.fillStyle = '#888';
          ctx.fillRect(0, 0, 1280, 720);
          ctx.drawImage(image, offset, 0);
        };
        draw();
        const interval = setInterval(draw, 50),
          stream = canvas.captureStream(20),
          track = stream.getVideoTracks()[0]!;
        Object.defineProperty(track, 'getSettings', {
          value: () => ({
            width: 1280,
            height: 720,
            frameRate: 20,
            deviceId: 'test-camera',
            resizeMode: 'none',
          }),
        });
        Object.defineProperty(track, 'getCapabilities', { value: () => ({}) });
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
    .getByRole('button', { name: 'Connect camera', exact: true })
    .click();
  await page.getByRole('button', { name: 'Continue to focus', exact: true }).click();
  await expect(page.getByText('Sharpness', { exact: true })).toBeVisible();
  await expect
    .poll(async () =>
      Number((await page.locator('.focus-number').textContent())?.replace('relative', '')),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Focus is set', exact: true }).click();
  await page.getByRole('switch', { name: 'Automatic capture' }).click();
  await expect(page.locator('.gallery .count')).toHaveText('1', { timeout: 30_000 });
  await expect(
    page.getByText('Move or tilt the board for a different view', { exact: true }),
  ).toBeVisible();
  // The gate must not repeatedly save a stationary board.
  await page.waitForTimeout(1800);
  await expect(page.locator('.gallery .count')).toHaveText('1');
  await page.evaluate(() => (window as any).moveTestBoard());
  await expect(page.locator('.gallery .count')).toHaveText('2', { timeout: 30_000 });
  await page.getByRole('switch', { name: 'Automatic capture' }).click();
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
    .getByRole('button', { name: 'Connect camera', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Camera permission was denied');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
