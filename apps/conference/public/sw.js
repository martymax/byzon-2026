'use strict';

const WORKER_VERSION = '2026.07.25.2';
const CACHE_NAMESPACE = 'byzon-pwa';
const SHELL_CACHE = `${CACHE_NAMESPACE}-shell-v2`;
const PUBLIC_CACHE = `${CACHE_NAMESPACE}-public-v2`;
const LEGACY_SHELL_CACHE = 'byzon-shell-v1';
const OFFLINE_URL = '/offline';
const SHELL_ASSETS = [OFFLINE_URL, '/icons/icon.svg', '/icons/maskable.svg'];
const PUBLIC_CONTENT_PATH =
  /^\/api\/v1\/public\/events\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:bootstrap|content)$/;

const isOwnedCache = (name) =>
  name === LEGACY_SHELL_CACHE || name.startsWith(`${CACHE_NAMESPACE}-`);

const retainedCacheNames = (names) => {
  const olderShell = names
    .filter(
      (name) =>
        name !== SHELL_CACHE &&
        (name === LEGACY_SHELL_CACHE ||
          name.startsWith(`${CACHE_NAMESPACE}-shell-`)),
    )
    .sort()
    .at(-1);
  return new Set(
    [SHELL_CACHE, PUBLIC_CACHE, olderShell].filter(
      (name) => typeof name === 'string',
    ),
  );
};

const precacheShell = async () => {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    SHELL_ASSETS.map(async (path) => {
      const response = await fetch(
        new Request(path, {
          cache: 'reload',
          credentials: 'same-origin',
        }),
      );
      if (!response.ok) {
        throw new TypeError(`Shell asset ${path} returned ${response.status}`);
      }
      await cache.put(path, response);
    }),
  );
};

self.addEventListener('install', (event) => {
  // A failed precache rejects this install, so the previous active worker and
  // its verified shell remain in control. Updates activate only after the UI
  // explicitly asks the waiting worker to proceed.
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const retained = retainedCacheNames(names);
      await Promise.all(
        names
          .filter((name) => isOwnedCache(name) && !retained.has(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
      const clients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: 'window',
      });
      for (const client of clients) {
        client.postMessage({
          type: 'BYZON_WORKER_ACTIVATED',
          version: WORKER_VERSION,
        });
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (
    event.data?.type === 'BYZON_SKIP_WAITING' &&
    event.data.version === WORKER_VERSION
  ) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type === 'BYZON_GET_VERSION') {
    event.source?.postMessage({
      type: 'BYZON_WORKER_VERSION',
      version: WORKER_VERSION,
    });
  }
});

const isPublicContentRequest = (request) => {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return (
    url.origin === self.location.origin &&
    url.search === '' &&
    PUBLIC_CONTENT_PATH.test(url.pathname) &&
    !request.headers.has('authorization')
  );
};

const responseMetadata = async (response) => {
  if (!response.ok || response.status !== 200) return null;
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (
    !/(?:^|,)\s*public(?:\s|,|$)/i.test(cacheControl) ||
    /(?:^|,)\s*(?:private|no-store)(?:\s|,|$)/i.test(cacheControl)
  ) {
    return null;
  }
  if (
    !/^application\/json(?:;|$)/i.test(
      response.headers.get('content-type') ?? '',
    )
  ) {
    return null;
  }
  try {
    const body = await response.clone().json();
    if (
      !body ||
      typeof body !== 'object' ||
      !Number.isSafeInteger(body.version) ||
      body.version < 1 ||
      typeof body.publishedAt !== 'string' ||
      !Number.isFinite(Date.parse(body.publishedAt))
    ) {
      return null;
    }
    return {
      publicationVersion: body.version,
      storedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

const withCacheMetadata = async (response, metadata, source) => {
  const headers = new Headers(response.headers);
  headers.set(
    'x-byzon-publication-version',
    String(metadata.publicationVersion),
  );
  headers.set('x-byzon-cache-stored-at', metadata.storedAt);
  headers.set('x-byzon-cache-source', source);
  if (source === 'cache') {
    headers.set('warning', '110 - "Response is stale"');
  }
  return new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const cachedPublicResponse = async (request) => {
  const cached = await (await caches.open(PUBLIC_CACHE)).match(request);
  if (!cached) return null;
  const publicationVersion = Number(
    cached.headers.get('x-byzon-publication-version'),
  );
  const storedAt = cached.headers.get('x-byzon-cache-stored-at');
  if (
    !Number.isSafeInteger(publicationVersion) ||
    publicationVersion < 1 ||
    !storedAt ||
    !Number.isFinite(Date.parse(storedAt))
  ) {
    await (await caches.open(PUBLIC_CACHE)).delete(request);
    return null;
  }
  return withCacheMetadata(cached, { publicationVersion, storedAt }, 'cache');
};

const networkFirstPublicContent = async (request) => {
  try {
    const response = await fetch(request);
    const metadata = await responseMetadata(response);
    if (metadata) {
      const cacheable = await withCacheMetadata(response, metadata, 'network');
      await (await caches.open(PUBLIC_CACHE)).put(request, cacheable.clone());
      return cacheable;
    }
    if (response.status >= 500) {
      return (await cachedPublicResponse(request)) ?? response;
    }
    return response;
  } catch {
    const cached = await cachedPublicResponse(request);
    if (cached) return cached;
    throw new TypeError('Public content is unavailable offline');
  }
};

const navigationFallback = async (request) => {
  try {
    return await fetch(request);
  } catch {
    const current = await (await caches.open(SHELL_CACHE)).match(OFFLINE_URL);
    if (current) return current;
    const legacy = await (
      await caches.open(LEGACY_SHELL_CACHE)
    ).match(OFFLINE_URL);
    return (
      legacy ??
      new Response('Offline', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    );
  }
};

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(navigationFallback(event.request));
    return;
  }
  if (isPublicContentRequest(event.request)) {
    event.respondWith(networkFirstPublicContent(event.request));
  }
  // Every private API, credential, mutation and check-in request deliberately
  // falls through to the browser network stack and is never cached here.
});

self.addEventListener('sync', (event) => {
  if (event.tag !== 'byzon-offline-queue') return;
  event.waitUntil(
    self.clients
      .matchAll({ includeUncontrolled: false, type: 'window' })
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'BYZON_SYNC_REQUESTED' });
        }
      }),
  );
});
