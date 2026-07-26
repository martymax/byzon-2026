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
  it('uses a unique build shell cache and retains one verified rollback', () => {
    expect(workerSource).toContain("const WORKER_VERSION = '2026.07.25.5';");
    expect(workerSource).toContain(
      'const SHELL_CACHE = `${CACHE_NAMESPACE}-shell-${SHELL_VERSION}`;',
    );
    expect(workerSource).toContain(
      'const PUBLIC_CACHE = `${CACHE_NAMESPACE}-public-v3`;',
    );
    expect(workerSource).toContain(
      "const LEGACY_SHELL_CACHE = 'byzon-shell-v1';",
    );
    expect(workerSource).toContain('[SHELL_CACHE, PUBLIC_CACHE, rollback]');
    expect(workerSource).toContain('const SHELL_METADATA_URL');
    expect(workerSource).toContain("importScripts('/sw-shell-manifest.js')");
    expect(workerSource).toContain(
      'const SHELL_VERSION = `${WORKER_VERSION}-${META.version}`;',
    );
  });

  it('stages a complete verified shell and deletes a partial failed build', () => {
    const install = section(
      "self.addEventListener('install'",
      "self.addEventListener('activate'",
    );
    const messages = section(
      "self.addEventListener('message'",
      'const publicRequestDescriptor',
    );

    expect(install).toContain('event.waitUntil(precache())');
    expect(install).not.toContain('skipWaiting');
    expect(workerSource).toContain('const verified = await Promise.all(');
    expect(workerSource).toContain('await caches.delete(SHELL_CACHE)');
    expect(workerSource).toContain('complete: true');
    expect(workerSource).toContain('cacheName: SHELL_CACHE');
    expect(workerSource).toContain('assets: [...ASSETS]');
    expect(workerSource).toContain('digests: { ...DIGESTS }');
    expect(workerSource).toContain("crypto.subtle.digest('SHA-256'");
    expect(workerSource).toContain('storedAssetValid');
    expect(workerSource).toContain('response.redirected');
    expect(workerSource).toContain('ASSETS.includes(url.pathname)');
    expect(messages).toContain("event.data?.type === 'BYZON_SKIP_WAITING'");
    expect(messages).toContain('event.data.version === WORKER_VERSION');
    expect(messages).toContain('self.skipWaiting()');
    expect(messages).toContain("event.data?.type === 'BYZON_GET_VERSION'");
    expect(messages).toContain("type: 'BYZON_WORKER_VERSION'");
  });

  it('allows only anonymous, correlated and sanitized public GET data', () => {
    const eligibility = section(
      'const publicRequestDescriptor',
      'const field =',
    );
    const validation = section(
      'const sanitizePublicResponse',
      'const publicResponse',
    );

    expect(workerSource).toContain(
      String.raw`^\/api\/v1\/public\/events\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(bootstrap|content)$`,
    );
    expect(eligibility).toContain("request.method !== 'GET'");
    expect(eligibility).toContain('url.origin !== self.location.origin');
    expect(eligibility).toContain("url.search !== ''");
    expect(eligibility).toContain("request.headers.has('authorization')");
    expect(eligibility).toContain("credentials: 'omit'");
    expect(eligibility).toContain("redirect: 'error'");
    expect(validation).toContain('responseIsPublic(response)');
    expect(workerSource).toContain('private|no-store');
    expect(workerSource).toContain("'set-cookie'");
    expect(workerSource).toContain('MAX_PUBLIC_RESPONSE_BYTES');
    expect(validation).toContain('body.event.slug !== descriptor.slug');
    expect(workerSource).toContain('bootstrapValue(JSON.parse(text))');
    expect(workerSource).toContain('contentValue(JSON.parse(text))');
    expect(workerSource).toContain(
      'cached.metadata.publicationVersion > metadata.publicationVersion',
    );
  });

  it('never installs a cache route for private, mutation or check-in APIs', () => {
    const fetchHandler = section(
      "self.addEventListener('fetch'",
      "self.addEventListener('sync'",
    );
    expect(fetchHandler).toContain('publicRequestDescriptor(event.request)');
    expect(fetchHandler).toContain('cachedPath(event.request)');
    expect(fetchHandler).toContain(
      'event.respondWith(cachedShell(event.request, shellPath))',
    );
    expect(fetchHandler).not.toContain('caches.match(event.request)');
    expect(workerSource).not.toContain('/api/v1/me');
    expect(workerSource).not.toContain('/api/v1/events');
    expect(workerSource).not.toContain('/api/v1/check-in');
    expect(workerSource).not.toContain("request.method === 'POST'");
  });

  it('stays below the dedicated worker transfer budget', () => {
    expect(new TextEncoder().encode(workerSource).byteLength).toBeLessThan(
      24_576,
    );
  });
});
