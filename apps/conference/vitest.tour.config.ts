import { targetViewports } from '@byzon/test-support/viewports';
import { defineConfig } from 'vitest/config';
import base from './vitest.browser.config';

// Safari does not focus buttons on pointer clicks in the same way as Chromium.
// Keep the actual WebKit interaction in the guide's regression checks.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/test/component/participant-tour.component.tsx'],
    browser: {
      ...base.test?.browser,
      instances: targetViewports.flatMap(({ id, label, width, height }) =>
        (['chromium', 'webkit'] as const).map((browser) => ({
          browser,
          name: `${id} ${browser} (${label})`,
          viewport: { width, height },
        })),
      ),
    },
  },
});
