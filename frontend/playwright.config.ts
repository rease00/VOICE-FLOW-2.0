import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT || 42173);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;
const REUSE_EXISTING_SERVER = process.env.PLAYWRIGHT_REUSE_SERVER !== '0';
const PLAYWRIGHT_OUTPUT_ROOT = '../tmp_dir/playwright/frontend-smoke';

export default defineConfig({
  testDir: './tests/smoke',
  globalSetup: './tests/smoke/globalSetup.ts',
  outputDir: `${PLAYWRIGHT_OUTPUT_ROOT}/test-results`,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: `${PLAYWRIGHT_OUTPUT_ROOT}/report` }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium-tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1024, height: 1366 },
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    { name: 'chromium-mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    port: PORT,
    timeout: 120_000,
    // The smoke suite uses a dedicated port, so reuse is safe across repeated local runs.
    reuseExistingServer: REUSE_EXISTING_SERVER,
  },
});
