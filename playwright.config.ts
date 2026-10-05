import { defineConfig } from '@playwright/test';
const production = process.env.PHOTONCAL_PRODUCTION === '1';
const baseURL = `http://127.0.0.1:${production ? 4173 : 5173}`;
export default defineConfig({
  testDir: './tests/browser',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: production
      ? 'npm run preview -- --host 127.0.0.1 --port 4173'
      : 'npm run dev -- --host 127.0.0.1',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
