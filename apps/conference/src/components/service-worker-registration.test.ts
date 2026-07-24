import { describe, expect, it } from 'vitest';

import { shouldRegisterAppServiceWorker } from './service-worker-registration';

const ORIGIN = 'https://app.byzon.test';

describe('application service worker ownership', () => {
  it('registers when the scope is empty or already owned by the app worker', () => {
    expect(shouldRegisterAppServiceWorker([], ORIGIN)).toBe(true);
    expect(shouldRegisterAppServiceWorker([`${ORIGIN}/sw.js`], ORIGIN)).toBe(
      true,
    );
  });

  it('does not replace a different, cross-origin or malformed worker', () => {
    expect(
      shouldRegisterAppServiceWorker(
        [`${ORIGIN}/another-service-worker.js`],
        ORIGIN,
      ),
    ).toBe(false);
    expect(
      shouldRegisterAppServiceWorker(['https://other.test/sw.js'], ORIGIN),
    ).toBe(false);
    expect(shouldRegisterAppServiceWorker(['not a URL'], ORIGIN)).toBe(false);
  });
});
