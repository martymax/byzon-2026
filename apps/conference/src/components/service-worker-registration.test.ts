import { describe, expect, it } from 'vitest';

import {
  serviceWorkerNotice,
  shouldRegisterAppServiceWorker,
} from './service-worker-registration';

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

describe('service worker notice priority', () => {
  it('keeps loss of connectivity visible above update and install prompts', () => {
    expect(
      serviceWorkerNotice({
        failed: true,
        installAvailable: true,
        online: false,
        updateAvailable: true,
      }),
    ).toBe('offline');
  });

  it('offers a verified update before a secondary installation prompt', () => {
    expect(
      serviceWorkerNotice({
        failed: false,
        installAvailable: true,
        online: true,
        updateAvailable: true,
      }),
    ).toBe('update');
    expect(
      serviceWorkerNotice({
        failed: false,
        installAvailable: true,
        online: true,
        updateAvailable: false,
      }),
    ).toBe('install');
  });

  it('stays silent during the healthy installed online state', () => {
    expect(
      serviceWorkerNotice({
        failed: false,
        installAvailable: false,
        online: true,
        updateAvailable: false,
      }),
    ).toBe('none');
  });
});
