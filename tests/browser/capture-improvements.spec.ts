import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { simulatedCameras } from './camera-fixture';

async function startPreview(page: Page) {
  const setup = page.locator('.camera-setup');
  await setup.getByRole('button', { name: 'Check available settings', exact: true }).click();
  await setup.getByRole('button', { name: 'Start preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue to focus', exact: true })).toBeEnabled();
}
async function captureScreen(page: Page) {
  await page.getByRole('button', { name: 'Continue to focus', exact: true }).click();
  await page.getByRole('button', { name: 'Focus is set', exact: true }).click();
}
async function savedFrames(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('photoncal');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const sessions = await new Promise<any[]>((resolve, reject) => {
      const r = db.transaction('sessions').objectStore('sessions').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const session = sessions[0];
    if (!session) {
      db.close();
      return { session: undefined, pixels: [] };
    }
    const blobs = await Promise.all(
      session.frames.map(
        (f: any) =>
          new Promise<Blob>((resolve, reject) => {
            const r = db.transaction('images').objectStore('images').get(`${session.id}/${f.id}`);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          }),
      ),
    );
    db.close();
    const pixels = await Promise.all(
      blobs.map(async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob),
          canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const digest = await crypto.subtle.digest(
          'SHA-256',
          ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        );
        return {
          width: canvas.width,
          height: canvas.height,
          hash: Array.from(new Uint8Array(digest)).join(','),
        };
      }),
    );
    return { session, pixels };
  });
}

test('remembers target and per-camera controls before the first capture', async ({ page }) => {
  await simulatedCameras(page, true, true);
  await page.goto('/');
  await startPreview(page);
  await captureScreen(page);
  const rows = page.getByRole('spinbutton', { name: 'Rows · squares', exact: true });
  const columns = page.getByRole('spinbutton', { name: 'Columns · squares', exact: true });
  await rows.fill('7');
  await rows.press('Tab');
  await columns.fill('10');
  await columns.press('Tab');
  expect(
    await page.locator('.board-settings .field-pair').first().locator('label').allTextContents(),
  ).toEqual(
    expect.arrayContaining([expect.stringContaining('Rows'), expect.stringContaining('Columns')]),
  );
  expect((await rows.boundingBox())!.x).toBeLessThan((await columns.boundingBox())!.x);
  await page.getByRole('combobox', { name: 'Units', exact: true }).selectOption('in');
  await page.getByRole('combobox', { name: 'Exposure mode', exact: true }).selectOption('manual');
  const entry = page.getByRole('spinbutton', { name: 'Exposure in milliseconds' });
  await entry.fill('2');
  await entry.press('Tab');
  await page.getByRole('button', { name: 'Rotate preview 180°' }).click();
  await page.getByRole('combobox', { name: 'Capture mode', exact: true }).selectOption('timer');
  await page.getByRole('spinbutton', { name: 'Interval · seconds' }).fill('1');
  await page.waitForTimeout(200); // Live analysis renders must not overwrite an unfinished edit.
  await page.getByRole('spinbutton', { name: 'Interval · seconds' }).press('Tab');
  await expect(
    page.getByRole('button', { name: 'Browse saved sessions (0)', exact: true }),
  ).toBeVisible();
  await page.reload();
  await startPreview(page);
  await expect(entry).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Rotate preview 180°' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await captureScreen(page);
  await expect(rows).toHaveValue('7');
  await expect(columns).toHaveValue('10');
  await expect(page.getByRole('combobox', { name: 'Units', exact: true })).toHaveValue('in');
  await expect(page.getByRole('combobox', { name: 'Capture mode', exact: true })).toHaveValue(
    'timer',
  );
  await expect(page.getByRole('spinbutton', { name: 'Interval · seconds' })).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New calibration', exact: true }).click();
  await page
    .locator('.camera-setup')
    .getByRole('combobox', { name: 'Camera', exact: true })
    .selectOption('camera-b');
  await startPreview(page);
  await expect(page.getByRole('button', { name: 'Rotate preview 180°' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await captureScreen(page);
  await expect(rows).toHaveValue('7');
  await expect(columns).toHaveValue('10');
  await page.getByRole('button', { name: 'New calibration', exact: true }).click();
  await page
    .locator('.camera-setup')
    .getByRole('combobox', { name: 'Camera', exact: true })
    .selectOption('camera-a');
  await startPreview(page);
  await expect(entry).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Rotate preview 180°' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Windows exposure uses reachable stops and coalesces adjustments while retaining sensor mode', async ({
  page,
}) => {
  await simulatedCameras(page, true, true, { windowsExposure: true });
  await page.goto('/');
  await startPreview(page);
  await page.getByRole('combobox', { name: 'Exposure mode', exact: true }).selectOption('manual');
  const slider = page.getByRole('slider', { name: 'Shutter / exposure', exact: true });
  await expect(slider).toHaveAttribute('max', '12');
  await expect(slider).toHaveValue('5');
  await slider.focus();
  await slider.press('ArrowLeft');
  await expect(page.locator('.exposure-control output')).toHaveText('3.906 ms · 1/256 s');
  const entry = page.getByRole('combobox', { name: 'Exposure time', exact: true });
  await entry.selectOption(String(10000 / 512));
  await expect(entry).toHaveValue(String(10000 / 512));
  await expect(page.getByText(/Camera exposure:.*requested/)).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).cameraTest.pauseCheck = true;
    (window as any).cameraTest.adjustments = [];
  });
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '1';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(() => page.evaluate(() => !!(window as any).cameraTest.releaseCheck))
    .toBe(true);
  await slider.evaluate((el: HTMLInputElement) => {
    for (const value of ['2', '3', '4']) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.evaluate(() => (window as any).cameraTest.releaseCheck());
  await expect(slider).toHaveValue('4');
  const requests = await page.evaluate(() => (window as any).cameraTest.adjustments);
  expect(requests).toHaveLength(2);
  expect(requests.map((r: any) => r.advanced[0].exposureTime)).toEqual([10000 / 2048, 10000 / 256]);
  for (const request of requests)
    expect(request).toMatchObject({
      width: { exact: 1280 },
      height: { exact: 720 },
      frameRate: { exact: 30 },
      resizeMode: { exact: 'none' },
    });
});

test('all camera controls can be adjusted while the preview remains visible', async ({
  page,
}, testInfo) => {
  await simulatedCameras(page, true, true);
  await page.goto('/');
  await startPreview(page);
  await page.getByRole('combobox', { name: 'Exposure mode', exact: true }).selectOption('manual');
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width >= 1100) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.getByRole('button', { name: 'Continue to focus' })).toBeInViewport({
        ratio: 1,
      });
      await expect(page.getByRole('button', { name: 'Restart preview' })).toBeInViewport({
        ratio: 1,
      });
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        viewport.height,
      );
    }
    for (const name of ['Shutter / exposure', 'Brightness', 'Focus distance', 'Zoom']) {
      const slider = page.getByRole('slider', { name, exact: true });
      await slider.scrollIntoViewIfNeeded();
      await expect(slider).toBeInViewport({ ratio: 1 });
      await expect(page.locator('video')).toBeInViewport({ ratio: 0.5 });
      const box = (await slider.boundingBox())!;
      expect(
        await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        }),
      ).toBe('INPUT');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`controls-${viewport.width}.png`) });
  }
});

test('desktop stages keep settings and navigation visible without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await simulatedCameras(page, true, true);
  await page.goto('/');
  await startPreview(page);
  async function fits() {
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      768,
    );
    for (const selector of ['.camera-controls', '.workspace-side']) {
      expect(
        await page.locator(selector).evaluate((el) => el.scrollHeight - el.clientHeight),
      ).toBeLessThanOrEqual(1);
    }
    await expect(page.locator('.workflow-footer')).toBeInViewport({ ratio: 1 });
  }
  await fits();
  await page.getByRole('button', { name: 'Continue to focus', exact: true }).click();
  await fits();
  await expect(page.getByRole('button', { name: 'Bottom right', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(page.locator('.focus-magnifier canvas')).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Focus is set', exact: true }).click();
  await fits();
  await expect(
    page.getByRole('spinbutton', { name: 'Measured marker size', exact: false }),
  ).toBeInViewport({ ratio: 1 });
});

test('disabled capture explains missing corners on hover and keyboard focus', async ({ page }) => {
  await simulatedCameras(page, true, true);
  await page.goto('/');
  await startPreview(page);
  await captureScreen(page);
  const capture = page.getByRole('button', { name: 'Capture now' });
  await expect(capture).toBeDisabled();
  const action = page.locator('.capture-action');
  await action.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(page.getByRole('tooltip')).not.toBeEmpty();
  await page.mouse.move(0, 0);
  await action.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(capture).toHaveAttribute('aria-describedby', 'capture-disabled-reason');
});

test('capture gallery shows complete images and follows new captures without disrupting review', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/board.png', (route) =>
    route.fulfill({ path: path.resolve('.build/fixtures/img0.png'), contentType: 'image/png' }),
  );
  await simulatedCameras(page, true, true, { boardImage: '/board.png' });
  await page.goto('/');
  await startPreview(page);
  await captureScreen(page);
  await page.getByRole('combobox', { name: 'Capture mode', exact: true }).selectOption('manual');
  const capture = page.getByRole('button', { name: 'Capture now' });
  const gallery = page.locator('.live-gallery');
  for (let i = 1; i <= 13; i++) {
    await capture.click();
    await expect(page.locator('.gallery .count')).toHaveText(String(i));
    if (i === 1) {
      await expect(page.locator('.target-disclosure')).toHaveAttribute('open');
      await page.locator('.target-disclosure > summary').click();
      await expect(page.locator('.target-disclosure')).not.toHaveAttribute('open');
      await expect(gallery.locator('.thumbnail-image img')).toBeInViewport({ ratio: 1 });
      await expect(
        gallery.getByRole('button', { name: 'Delete Capture 1', exact: true }),
      ).toBeInViewport({ ratio: 1 });
      expect((await gallery.boundingBox())!.height).toBeGreaterThan(300);
      await expect(page.locator('video')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.workflow-footer')).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(768);
    }
  }
  await expect(
    gallery.getByRole('button', { name: 'Inspect Capture 13', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(gallery.locator('.pagination')).toContainText('Page 2 of 2');
  await gallery.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(gallery.getByRole('checkbox', { name: 'Follow new captures' })).not.toBeChecked();
  await capture.click();
  await expect(gallery.locator('.count')).toHaveText('14');
  await expect(gallery.locator('.pagination')).toContainText('Page 1 of 2');
  await gallery.getByRole('checkbox', { name: 'Follow new captures' }).check();
  const latest = gallery.getByRole('button', { name: 'Inspect Capture 14', exact: true });
  await expect(latest).toBeInViewport({ ratio: 1 });
  await latest.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close image' }).click();
  await gallery.locator('.frame-thumb').last().getByRole('checkbox', { name: 'Use' }).uncheck();
  await expect(gallery).toContainText('13 included');
  await gallery.getByRole('button', { name: 'Delete Capture 14', exact: true }).click();
  await expect(gallery.locator('.count')).toHaveText('13');
  await page.screenshot({ path: testInfo.outputPath('capture-gallery-1366.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('rotation preserves raw pixels and timer skips duplicates and cancels in-flight captures', async ({
  page,
}) => {
  await page.route('**/board.png', (route) =>
    route.fulfill({ path: path.resolve('.build/fixtures/img0.png'), contentType: 'image/png' }),
  );
  await simulatedCameras(page, true, true, { boardImage: '/board.png' });
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, options?: any) {
      if (message.op === 'analyze') (window as any).lastRoi = message.args.roi;
      if (message.op === 'capture' && (window as any).holdNextCapture) {
        (window as any).holdNextCapture = false;
        (window as any).releaseCapture = () => send.call(this, message, options);
      } else if (message.op === 'capture' && (window as any).rejectNextCapture) {
        (window as any).rejectNextCapture = false;
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent('message', {
              data: {
                id: message.id,
                result: {
                  accepted: false,
                  analysis: { valid: false, reason: 'Full-resolution target lost', corners: [] },
                },
              },
            }),
          ),
        );
      } else send.call(this, message, options);
    };
  });
  await page.goto('/');
  await startPreview(page);
  await page.getByRole('button', { name: 'Continue to focus', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate preview 180°' }).click();
  await page.getByRole('button', { name: 'Top left', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).lastRoi))
    .toMatchObject({ x: 0.7, y: 0.7 });
  await page.getByRole('button', { name: 'Rotate preview 180°' }).click();
  await page.getByRole('button', { name: 'Focus is set', exact: true }).click();
  const capture = page.getByRole('button', { name: 'Capture now', exact: false });
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(page.locator('.gallery .count')).toHaveText('1');
  const before = await savedFrames(page);
  await page.getByRole('button', { name: 'Rotate preview 180°' }).click();
  expect((await savedFrames(page)).session).toEqual(before.session);
  await expect(page.locator('video')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
  await capture.click();
  await expect(page.locator('.gallery .count')).toHaveText('2');
  const after = await savedFrames(page);
  expect(after.pixels[0]).toEqual(after.pixels[1]);
  expect(after.pixels[0]).toMatchObject({ width: 1280, height: 720 });
  expect(after.session.frames[0].corners).toEqual(after.session.frames[1].corners);
  await page.getByRole('combobox', { name: 'Capture mode', exact: true }).selectOption('timer');
  const interval = page.getByRole('spinbutton', { name: 'Interval · seconds' });
  await interval.fill('1');
  await interval.press('Tab');
  await expect(interval).toHaveValue('1');
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  await expect(page.locator('.timer-countdown')).toBeVisible();
  await expect(page.locator('.capture-hud')).toContainText('Skipped: move or tilt');
  await expect(page.locator('.gallery .count')).toHaveText('2');
  await page.evaluate(() => {
    (window as any).cameraTest.offsetX = 60;
  });
  await expect(page.locator('.gallery .count')).toHaveText('3');
  await page.evaluate(() => {
    (window as any).cameraTest.showBoard = false;
  });
  await expect(page.locator('.capture-hud')).toContainText(
    /Skipped: (No board detected|More board corners need to be visible)/,
  );
  await page.evaluate(() => {
    (window as any).cameraTest.showBoard = true;
  });
  await expect(page.locator('.capture-hud')).toContainText('Skipped: move or tilt');
  await expect(page.locator('.gallery .count')).toHaveText('3');
  await page.evaluate(() => {
    (window as any).cameraTest.offsetX = 120;
    (window as any).holdNextCapture = true;
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).releaseCapture)).toBe(true);
  await page.getByRole('button', { name: 'Stop timer', exact: true }).click();
  await page.evaluate(() => (window as any).releaseCapture());
  await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.locator('.gallery .count')).toHaveText('3');
  await page.evaluate(() => {
    (window as any).rejectNextCapture = true;
  });
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  await expect(page.locator('.capture-hud')).toContainText('Skipped: Full-resolution target lost');
  await expect(page.getByRole('button', { name: 'Stop timer', exact: true })).toBeVisible();
  await expect(page.locator('.gallery .count')).toHaveText('4');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // A failed image transaction stops the timer without losing accepted images.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === 'images')
        throw new DOMException('Test storage quota exceeded', 'QuotaExceededError');
      return put.apply(this, args as [any, IDBValidKey?]);
    };
    (window as any).cameraTest.offsetX = 180;
  });
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Test storage quota exceeded');
  await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
  expect((await savedFrames(page)).session.frames).toHaveLength(4);
});
