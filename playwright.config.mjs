import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  timeout: 30_000,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: [
    {
      command: 'npm run dev',
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'node server.mjs',
      url: 'http://127.0.0.1:3001',
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        PORT: '3001',
      },
    },
  ],
});
