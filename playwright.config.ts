import { targetViewports } from '@byzon/test-support/viewports';
import { defineConfig } from '@playwright/test';

const webServerHealthPath =
  process.env.PLAYWRIGHT_ALLOW_LIVE_START === '1'
    ? '/health/live'
    : '/health/ready';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  // Keep cold route compilation responsive on four-core CI runners.
  workers: 3,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: targetViewports.map(({ id, label, width, height }) => ({
    name: `chromium-${id} (${label})`,
    use: {
      browserName: 'chromium',
      viewport: { width, height },
    },
  })),
  webServer: {
    // E2E exercises the same synthetic journeys exposed by `pnpm dev:mock`.
    command: 'pnpm dev:mock',
    url: `http://127.0.0.1:3000${webServerHealthPath}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
