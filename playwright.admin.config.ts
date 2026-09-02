import { defineConfig } from '@playwright/test';

const adminQaViewports = [
  { name: 'admin-320', width: 320, height: 720 },
  { name: 'admin-375', width: 375, height: 667 },
  { name: 'admin-414', width: 414, height: 896 },
  { name: 'admin-768', width: 768, height: 1024 },
  { name: 'admin-1024', width: 1024, height: 768 },
  { name: 'admin-1280', width: 1280, height: 800 },
  { name: 'admin-1440', width: 1440, height: 900 },
] as const;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'admin-ux-qa.spec.ts',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  projects: adminQaViewports.map(({ name, width, height }) => ({
    name,
    use: { viewport: { width, height } },
  })),
  webServer: {
    command: 'pnpm dev:mock',
    url: 'http://127.0.0.1:3000/health/live',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
