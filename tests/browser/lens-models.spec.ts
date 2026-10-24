import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

test('fits both lens models, compares diagnostics and preserves exports across switching and recovery', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('mrcal ready', { exact: true })).toBeVisible();
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles(
      Array.from({ length: 12 }, (_, i) => path.resolve(`.build/fixtures/img${i * 10}.png`)),
    );
  await page.getByLabel('All images use the same camera, resolution, focus, and zoom.').check();
  await page.getByRole('button', { name: 'Analyze images', exact: true }).click();
  const calibrate = page.getByRole('button', { name: 'Calibrate 12 images', exact: true });
  await expect(calibrate).toBeEnabled({ timeout: 60_000 });
  await calibrate.click();
  const jsonButton = page.getByRole('button', { name: 'Download PhotonVision JSON', exact: true });
  await expect(jsonButton).toBeEnabled({ timeout: 60_000 });
  async function download(button: ReturnType<typeof page.getByRole>) {
    const pending = page.waitForEvent('download');
    await button.click();
    return readFile((await (await pending).path())!, 'utf8');
  }
  const opencv = JSON.parse(await download(jsonButton));
  await page.getByRole('button', { name: 'Fit both models', exact: true }).click();
  const modelDownload = page.getByRole('button', {
    name: 'Download mrcal camera model',
    exact: true,
  });
  await expect(page.locator('.spline-correction')).toBeVisible({ timeout: 60_000 });
  await expect(modelDownload).toBeEnabled({ timeout: 60_000 });
  await expect(jsonButton).toHaveCount(0);
  const exported = await download(modelDownload);
  expect(exported).toContain('LENSMODEL_SPLINED_STEREOGRAPHIC_order=3_Nx=16_Ny=12_fov_x_deg=120');
  const model = JSON.parse(exported.split('\n').slice(1).join('\n'));
  expect(model.intrinsics).toHaveLength(388);
  await expect(page.locator('.model-selector')).toContainText('2 saved fits');
  await page.getByRole('button', { name: 'Inspect residual image', exact: true }).click();
  await page.getByRole('button', { name: 'Show undistorted', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('90° pinhole preview', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Close image', exact: true }).click();
  await page.getByLabel('Evaluation distance').selectOption('finite');
  await page.getByRole('button', { name: 'Compute distance map', exact: true }).click();
  await expect(page.locator('.working-distance')).toContainText('Showing 3 m', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Compute uncertainty curve', exact: true }).click();
  await expect(page.locator('.distance-curve')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  const compare = page.locator('.model-comparison');
  await expect(compare.locator('.comparison-image img')).toHaveCount(2);
  await compare.getByLabel('Shared arrow magnification').selectOption('50');
  await compare.getByLabel('Shared regional metric').selectOption('spread');
  await compare.getByRole('button', { name: 'Compare model projections', exact: true }).click();
  await expect(compare.getByText(/Mean .*spatial p95/)).toBeVisible({ timeout: 60_000 });
  await compare
    .getByLabel('Shared evaluation distance')
    .selectOption({ label: 'Working distance' });
  await compare.getByRole('button', { name: 'Compute both distance maps', exact: true }).click();
  await expect(compare).toContainText('Showing 3 m', { timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath('model-comparison.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'OpenCV8', exact: true }).click();
  expect(JSON.parse(await download(jsonButton))).toEqual(opencv);
  await page.getByRole('button', { name: 'Splined', exact: true }).click();
  expect(await download(modelDownload)).toBe(exported);
  await page.reload();
  await page.getByRole('button', { name: /Browse saved sessions/ }).click();
  await page.locator('.saved-sessions button').first().click();
  await expect(page.locator('.spline-correction')).toBeVisible();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(compare.locator('table')).toContainText('388');
  expect(errors).toEqual([]);
});
