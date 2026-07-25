import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workerSource = readFileSync(
  new URL('../../../public/sw.js', import.meta.url),
  'utf8',
);

const section = (start: string, end: string): string => {
  const startIndex = workerSource.indexOf(start);
  const endIndex = workerSource.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new TypeError(`Missing service-worker section ${start} → ${end}.`);
  }
  return workerSource.slice(startIndex, endIndex);
};

describe('application service-worker source policy', () => {
  it('pins a versioned shell/public cache and retains one rollback shell', () => {
    expect(workerSource).toContain("const WORKER_VERSION = '2026.07.25.2';");
    expect(workerSource).toContain(
      'const SHELL_CACHE = `${CACHE_NAMESPACE}-shell-v2`;',
    );
    expect(workerSource).toContain(
      'const PUBLIC_CACHE = `${CACHE_NAMESPACE}-public-v2`;',
    );
    expect(workerSource).toContain(
      "const LEGACY_SHELL_CACHE = 'byzon-shell-v1';",
    );
    expect(workerSource).toContain('[SHELL_CACHE, PUBLIC_CACHE, olderShell]');
  });

  it('keeps activation explicit and leaves a failed install on the previous worker', () => {
    const install = section(
      "self.addEventListener('install'",
      "self.addEventListener('activate'",
    );
    const messages = section(
      "self.addEventListener('message'",
      'const isPublicContentRequest',
    );

    expect(install).toContain('event.waitUntil(precacheShell())');
    expect(install).not.toContain('skipWaiting');
    expect(workerSource).toContain('if (!response.ok)');
    expect(messages).toContain("event.data?.type === 'BYZON_SKIP_WAITING'");
    expect(messages).toContain('event.data.version === WORKER_VERSION');
    expect(messages).toContain('self.skipWaiting()');
  });

  it('allows only anonymous versioned public GET data into the data cache', () => {
    const eligibility = section(
      'const isPublicContentRequest',
      'const responseMetadata',
    );
    const validation = section(
      'const responseMetadata',
      'const withCacheMetadata',
    );

    expect(workerSource).toContain(
      String.raw`^\/api\/v1\/public\/events\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:bootstrap|content)$`,
    );
    expect(eligibility).toContain("request.method !== 'GET'");
    expect(eligibility).toContain('url.origin === self.location.origin');
    expect(eligibility).toContain("url.search === ''");
    expect(eligibility).toContain("!request.headers.has('authorization')");
    expect(validation).toContain('cache-control');
    expect(validation).toContain('private|no-store');
    expect(validation).toContain('Number.isSafeInteger(body.version)');
    expect(validation).toContain('Date.parse(body.publishedAt)');
  });

  it('never installs a cache route for private, mutation or check-in APIs', () => {
    const fetchHandler = section(
      "self.addEventListener('fetch'",
      "self.addEventListener('sync'",
    );
    expect(fetchHandler).toContain('isPublicContentRequest(event.request)');
    expect(fetchHandler).not.toContain('caches.match(event.request)');
    expect(workerSource).not.toContain('/api/v1/me');
    expect(workerSource).not.toContain('/api/v1/events');
    expect(workerSource).not.toContain('/api/v1/check-in');
    expect(workerSource).not.toContain("request.method === 'POST'");
  });

  it('stays below the dedicated worker transfer budget', () => {
    expect(new TextEncoder().encode(workerSource).byteLength).toBeLessThan(
      16_384,
    );
  });
});
