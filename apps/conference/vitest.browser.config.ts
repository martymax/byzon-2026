import { targetViewports } from '@byzon/test-support/viewports';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.component.tsx'],
    setupFiles: ['./src/test/component/setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: targetViewports.map(({ id, label, width, height }) => ({
        browser: 'chromium',
        name: `${id} (${label})`,
        viewport: { width, height },
      })),
    },
  },
});
