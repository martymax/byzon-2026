import { targetViewports } from '@byzon/test-support/viewports';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'next/link': fileURLToPath(
        new URL('./src/test/component/link-stub.tsx', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    include: ['zod'],
  },
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
