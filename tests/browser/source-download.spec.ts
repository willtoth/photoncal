import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from('the full source archive, reconstructed without omitting any bytes');
const chunks = [bytes.subarray(0, 20), bytes.subarray(20)];
const manifest = {
  filename: 'photoncal-source.tar.gz',
  size: bytes.length,
  sha256: hash(bytes),
  parts: chunks.map((chunk, index) => ({
    file: `photoncal-source.tar.gz.${String(index).padStart(3, '0')}.${hash(chunk)}.part`,
    size: chunk.length,
    sha256: hash(chunk),
  })),
};

async function serveSource(
  page: Page,
  badPart: () => boolean = () => false,
  scriptReady: Promise<void> = Promise.resolve(),
) {
  const html = (await readFile('scripts/templates/source-download.html', 'utf8'))
    .replaceAll('{{SIZE}}', '0.1')
    .replaceAll('{{SHA256}}', manifest.sha256)
    .replace('{{LINKS}}', '');
  const script = await readFile('scripts/templates/source-download.js', 'utf8');
  await page.route('**/source/**', async (route) => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    if (!file) return route.fulfill({ contentType: 'text/html', body: html });
    if (file === 'download.js') {
      await scriptReady;
      return route.fulfill({ contentType: 'text/javascript', body: script });
    }
    if (file === 'manifest.json') return route.fulfill({ json: manifest });
    const index = manifest.parts.findIndex((part) => part.file === file);
    if (index >= 0)
      return route.fulfill({
        contentType: 'application/octet-stream',
        body: badPart() ? Buffer.from('corrupt') : chunks[index],
      });
    return route.fulfill({ status: 404 });
  });
  await page.goto('/source/', { waitUntil: 'commit' });
}

test('source download stays disabled until its script is ready', async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await serveSource(page, () => false, ready);
    const button = page.getByRole('button', { name: /Download complete source/ });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    release();
    await expect(button).toBeEnabled();
  } finally {
    release();
  }
});

test('source downloader verifies and rejoins all parts into one archive', async ({
  page,
}, testInfo) => {
  await serveSource(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download complete source/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(manifest.filename);
  const file = testInfo.outputPath(manifest.filename);
  await download.saveAs(file);
  expect(await readFile(file)).toEqual(bytes);
  await expect(page.getByRole('status')).toContainText('Source archive verified');
});

test('corrupt source parts fail visibly and the download can be retried', async ({ page }) => {
  let corrupt = true;
  await serveSource(page, () => corrupt);
  const button = page.getByRole('button', { name: /Download complete source/ });
  await button.click();
  await expect(page.getByRole('status')).toContainText('failed its checksum');
  await expect(button).toBeEnabled();
  corrupt = false;
  const download = page.waitForEvent('download');
  await button.click();
  await download;
  await expect(page.getByRole('status')).toContainText('Source archive verified');
});
