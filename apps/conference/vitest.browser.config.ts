import { targetViewports } from '@byzon/test-support/viewports';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const snapshotViewportId = (name: string | undefined) =>
  name?.match(/^[a-z0-9-]+/)?.[0] ?? 'default';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'next/link': fileURLToPath(
        new URL('./src/test/component/link-stub.tsx', import.meta.url),
      ),
      'next/navigation': fileURLToPath(
        new URL('./src/test/component/navigation-stub.ts', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    include: ['axe-core', 'zod'],
  },
  test: {
    include: ['src/**/*.component.tsx'],
    setupFiles: ['./src/test/component/setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      expect: {
        toMatchScreenshot: {
          resolveScreenshotPath: ({
            arg,
            browserName,
            ext,
            project,
            root,
            screenshotDirectory,
            testFileDirectory,
            testFileName,
          }) =>
            resolve(
              root,
              testFileDirectory,
              screenshotDirectory,
              testFileName,
              `${arg}-${snapshotViewportId(project.name)}-${browserName}${ext}`,
            ),
        },
      },
      instances: targetViewports.map(({ id, label, width, height }) => ({
        browser: 'chromium',
        name: `${id} (${label})`,
        viewport: { width, height },
      })),
    },
  },
});
