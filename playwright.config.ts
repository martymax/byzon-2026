import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'pnpm --filter @byzon/conference dev',
    url: 'http://127.0.0.1:3000/health/ready',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
