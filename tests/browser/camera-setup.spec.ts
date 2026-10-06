import { test, expect } from '@playwright/test';
import { simulatedCameras } from './camera-fixture';

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
  await page.locator('.camera-controls > summary').click();
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
  await expect(page.getByText(/The browser reported no adjustable controls/)).toBeVisible();
  await expect(page.getByText(/Not adjustable in this browser:/)).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('camera-settings-mobile.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('explains missing browser control support before access and still allows preview', async ({
  page,
}) => {
  await simulatedCameras(page, false);
  await page.goto('/');
  const setup = page.locator('.camera-setup');
  const explanation = page.getByText(/This browser does not support camera image controls/);
  await page.locator('.camera-controls > summary').click();
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText('Try Chrome or Edge');
  expect(await page.evaluate(() => (window as any).cameraTest.requests)).toHaveLength(0);
  await setup.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('camera-b');
  await setup.getByRole('button', { name: 'Check available settings', exact: true }).click();
  await setup.getByRole('button', { name: 'Start preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue to focus', exact: true })).toBeEnabled();
  await expect(explanation).toBeVisible();
  await expect(page.getByText(/Not adjustable in this browser:/)).toHaveCount(0);
  await expect(page.getByText(/The browser reported no adjustable controls/)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('manual exposure stays selected, unlocks the shutter, and reports driver rejection', async ({
  page,
}, testInfo) => {
  await simulatedCameras(page, true, true);
  await page.goto('/');
  const setup = page.locator('.camera-setup');
  await setup.getByRole('button', { name: 'Check available settings', exact: true }).click();
  await setup.getByRole('button', { name: 'Start preview', exact: true }).click();
  const exposureMode = page.getByRole('combobox', { name: 'Exposure mode', exact: true });
  const shutter = page.getByRole('slider', { name: 'Shutter / exposure', exact: true });
  const controlsToggle = page.locator('.camera-controls > summary');
  await expect(exposureMode).toBeHidden();
  await controlsToggle.click();
  await expect(exposureMode).toHaveValue('continuous');
  await expect(shutter).toBeDisabled();
  await exposureMode.selectOption('manual');
  await expect(shutter).toBeEnabled();
  await expect(exposureMode).toHaveValue('manual');
  await expect(shutter).toHaveValue('100');
  await shutter.evaluate((input) => {
    (input as HTMLInputElement).value = '50';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(
    page.locator('.camera-control').filter({ has: shutter }).locator('output'),
  ).toHaveText('50 100 µs');
  await expect(exposureMode).toHaveValue('manual');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.camera-details')).toContainText('1280 × 720 · 30 fps');
  const brightness = page.getByRole('slider', { name: 'Brightness', exact: true });
  await page.getByRole('button', { name: 'Continue to focus', exact: true }).click();
  await expect(exposureMode).toHaveValue('manual');
  await expect(shutter).toHaveValue('50');
  await expect(brightness).toBeEnabled();
  await brightness.evaluate((input) => {
    (input as HTMLInputElement).value = '65';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(
    page.locator('.camera-control').filter({ has: brightness }).locator('output'),
  ).toHaveText('65');
  await page.screenshot({ path: testInfo.outputPath('focus-camera-controls.png'), fullPage: true });
  await controlsToggle.focus();
  await controlsToggle.press('Enter');
  await page.getByRole('button', { name: 'Focus is set', exact: true }).click();
  await expect(exposureMode).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath('capture-controls-collapsed.png'),
    fullPage: true,
  });
  await controlsToggle.click();
  await expect(brightness).toHaveValue('65');
  await shutter.evaluate((input) => {
    (input as HTMLInputElement).value = '75';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(
    page.locator('.camera-control').filter({ has: shutter }).locator('output'),
  ).toHaveText('75 100 µs');
  await page.getByRole('navigation').getByRole('button', { name: 'Camera', exact: false }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Capture', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Capture images', exact: true })).toBeVisible();
  await expect(shutter).toHaveValue('75');
  await expect(exposureMode).toHaveValue('manual');
  expect(await page.evaluate(() => (window as any).cameraTest.requests)).toHaveLength(2);
  await page.getByRole('slider', { name: 'Focus distance', exact: true }).evaluate((input) => {
    (input as HTMLInputElement).value = '30';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('heading', { name: 'Adjust focus', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Focus is set', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Capture images', exact: true })).toBeVisible();
  await exposureMode.selectOption('continuous');
  await expect(shutter).toBeDisabled();
  await expect(exposureMode).toHaveValue('continuous');
  await page.evaluate(() => {
    (window as any).cameraTest.rejectExposure = true;
  });
  await exposureMode.selectOption('manual');
  await expect(page.getByRole('alert')).toContainText('did not apply exposure mode (manual)');
  await expect(exposureMode).toHaveValue('continuous');
  await expect(shutter).toBeDisabled();
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
