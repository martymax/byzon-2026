'use strict';

const WORKER_VERSION = '2026.07.25.4';
const CACHE_NAMESPACE = 'byzon-pwa';
const SHELL_CACHE = `${CACHE_NAMESPACE}-shell-${WORKER_VERSION}`;
const PUBLIC_CACHE = `${CACHE_NAMESPACE}-public-v3`;
const LEGACY_SHELL_CACHE = 'byzon-shell-v1';
const OFFLINE_URL = '/offline';
const SHELL_METADATA_URL = '/__byzon_pwa_shell_metadata__';
const SHELL_ASSETS = Object.freeze(
  [OFFLINE_URL, '/icons/icon.svg', '/icons/maskable.svg']);
const MAX_SHELL_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_PUBLIC_RESPONSE_BYTES = 8 * 1024 * 1024;
const OFFLINE_CONTRACT_VERSION = 1;
const PUBLIC_TTL = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_CONTENT_PATH =
  /^\/api\/v1\/public\/events\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(bootstrap|content)$/;
const INVALID = Symbol('invalid-public-field');

const isOwnedCache = (name) =>
  name === LEGACY_SHELL_CACHE || name.startsWith(`${CACHE_NAMESPACE}-`);

const sizeAllowed = (response, maximum) => {
  const declared = response.headers.get('content-length');
  if (declared === null) return true;
  const size = Number(declared);
  return Number.isSafeInteger(size) && size >= 0 && size <= maximum;
};

const responseIsPublic = (response) => {
  const cacheControl = response.headers.get('cache-control') ?? '';
  const vary = response.headers.get('vary') ?? '';
  return (
    /(?:^|,)\s*public(?:\s|,|$)/i.test(cacheControl) &&
    !/\b(?:private|no-store)\b/i.test(cacheControl) &&
    !/(?:^|,)\s*(?:\*|cookie|authorization)(?:\s|,|$)/i.test(vary) &&
    !response.headers.has('set-cookie')
  );
};

const safeHeaders = (response, contentType) => {
  const headers = new Headers({
    'cache-control': 'public, max-age=0, must-revalidate',
    'content-type': contentType,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  const contentSecurityPolicy = response.headers.get('content-security-policy');
  if (contentSecurityPolicy?.length <= 4096 &&
      !/[\r\n\u0000]/.test(contentSecurityPolicy)) {
    headers.set('content-security-policy', contentSecurityPolicy);
  }
  const etag = response.headers.get('etag');
  if (etag && etag.length <= 256) headers.set('etag', etag);
  const lastModified = response.headers.get('last-modified');
  if (lastModified && Number.isFinite(Date.parse(lastModified))) {
    headers.set('last-modified', lastModified);
  }
  return headers;
};

const shellAllowed = (path, response, stored = false) => {
  const expected = new URL(path, self.location.origin);
  const contentType = response.headers.get('content-type') ?? '';
  const typeAllowed =
    path === OFFLINE_URL
      ? /^text\/html(?:;|$)/i.test(contentType)
      : /^image\/svg\+xml(?:;|$)/i.test(contentType);
  return (
    response.ok &&
    response.status === 200 &&
    !response.redirected &&
    (stored
      ? response.url === '' || response.url === expected.href
      : response.url === expected.href) &&
    typeAllowed &&
    responseIsPublic(response) &&
    sizeAllowed(response, MAX_SHELL_BYTES)
  );
};

const verifyShell = async (path, response) => {
  if (!shellAllowed(path, response)) {
    throw new TypeError('Shell asset not safely cacheable.');
  }
  const body = await response.clone().arrayBuffer();
  if (body.byteLength > MAX_SHELL_BYTES) {
    throw new TypeError('Shell too large.');
  }
  return new Response(body, {
    status: 200,
    headers: safeHeaders(response, response.headers.get('content-type') ?? ''),
  });
};
const storedAssetValid = async (path, response) => {
  if (!response || !shellAllowed(path, response, true)) return false;
  const body = await response.clone().arrayBuffer();
  return body.byteLength <= MAX_SHELL_BYTES;
};
const precacheShell = async () => {
  const verified = await Promise.all(
    SHELL_ASSETS.map(async (path) => {
      const response = await fetch(
        new Request(path, {
          cache: 'reload',
          credentials: 'omit',
          redirect: 'error',
        }),
      );
      return [path, await verifyShell(path, response)];
    }),
  );
  try {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(verified.map(([path, response]) =>
      cache.put(path, response)));
    await cache.put(
      SHELL_METADATA_URL,
      Response.json(
        {
          complete: true,
          cacheName: SHELL_CACHE,
          assets: [...SHELL_ASSETS],
          installedAt: new Date().toISOString(),
          version: WORKER_VERSION,
        },
        { headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json',
        } },
      ),
    );
  } catch (error) {
    await caches.delete(SHELL_CACHE);
    throw error;
  }
};

const shellInfo = async (name) => {
  const shellPrefix = `${CACHE_NAMESPACE}-shell-`;
  if (!name.startsWith(shellPrefix)) return null;
  const version = name.slice(shellPrefix.length);
  if (version.length < 1) return null;
  const cache = await caches.open(name);
  const response = await cache.match(SHELL_METADATA_URL);
  if (
    !response ||
    !response.ok ||
    response.status !== 200 ||
    response.redirected ||
    (response.url !== '' &&
      response.url !== new URL(SHELL_METADATA_URL, self.location.origin).href) ||
    !/^application\/json(?:;|$)/i.test(
      response.headers.get('content-type') ?? '',
    ) ||
    !/\bno-store\b/i.test(response.headers.get('cache-control') ?? '') ||
    /(?:^|,)\s*(?:\*|cookie|authorization)(?:\s|,|$)/i.test(
      response.headers.get('vary') ?? '',
    ) ||
    response.headers.has('set-cookie')
  ) {
    return null;
  }
  try {
    const text = await response.clone().text();
    if (new TextEncoder().encode(text).byteLength > MAX_METADATA_BYTES) {
      return null;
    }
    const value = JSON.parse(text);
    const keys = Object.keys(value ?? {}).sort().join(',');
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      keys !== 'assets,cacheName,complete,installedAt,version' ||
      value.complete !== true ||
      value.cacheName !== name ||
      value.version !== version ||
      !Array.isArray(value.assets) ||
      JSON.stringify(value.assets) !== JSON.stringify(SHELL_ASSETS) ||
      typeof value.installedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.installedAt))
    ) {
      return null;
    }
    for (const path of SHELL_ASSETS) {
      if (!(await storedAssetValid(path, await cache.match(path)))) {
        return null;
      }
    }
    return { installedAt: value.installedAt, name };
  } catch {
    return null;
  }
};

const verifiedShells = async (names) => {
  const candidates = await Promise.all(
    names
      .filter((name) => name.startsWith(`${CACHE_NAMESPACE}-shell-`))
      .map(shellInfo),
  );
  return candidates
    .filter((candidate) => candidate !== null)
    .sort((left, right) => right.installedAt.localeCompare(left.installedAt));
};

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const verified = await verifiedShells(names);
      const rollback = verified.find(({ name }) => name !== SHELL_CACHE)?.name;
      const retained = new Set([SHELL_CACHE, PUBLIC_CACHE, rollback].filter(
        (name) => typeof name === 'string'));
      await Promise.all(
        names
          .filter((name) => isOwnedCache(name) && !retained.has(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
      const clients = await self.clients.matchAll(
        { includeUncontrolled: true, type: 'window' });
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
    const target = event.ports?.[0] ?? event.source;
    target?.postMessage({
      type: 'BYZON_WORKER_VERSION',
      version: WORKER_VERSION,
    });
  }
});

const publicRequestDescriptor = (request) => {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const match = PUBLIC_CONTENT_PATH.exec(url.pathname);
  if (
    url.origin !== self.location.origin ||
    url.search !== '' ||
    !match ||
    request.headers.has('authorization')
  ) {
    return null;
  }
  return {
    kind: match[2],
    slug: match[1],
    url,
  };
};

const publicRequest = (request) => {
  const descriptor = publicRequestDescriptor(request);
  if (!descriptor) return null;
  return new Request(descriptor.url.href, {
    cache: 'no-store',
    credentials: 'omit',
    headers: { accept: 'application/json' },
    method: 'GET',
    mode: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
};

const field = (sanitize, optional = false) => ({ optional, sanitize });
const optionalField = (sanitize) => field(sanitize, true);
const stringValue =
  (maximum, minimum = 0, pattern = null) =>
  (value) =>
    typeof value === 'string' &&
    value.length >= minimum &&
    value.length <= maximum &&
    (!pattern || pattern.test(value))
      ? value
      : INVALID;
const nonBlankString = (maximum) => (value) =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= maximum &&
  value.trim().length > 0
    ? value
    : INVALID;
const integerValue = (minimum = 0) => (value) =>
  Number.isSafeInteger(value) && value >= minimum ? value : INVALID;
const enumValue = (allowed) => (value) => allowed.has(value) ? value : INVALID;
const nullable = (sanitize) => (value) =>
  value === null ? null : sanitize(value);
const arrayValue = (maximum, sanitize) => (value) => {
  if (!Array.isArray(value) || value.length > maximum) return INVALID;
  const result = [];
  for (const item of value) {
    const sanitized = sanitize(item);
    if (sanitized === INVALID) return INVALID;
    result.push(sanitized);
  }
  return result;
};
const objectValue = (shape) => (value) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return INVALID;
  }
  const result = {};
  for (const [key, descriptor] of Object.entries(shape)) {
    if (!(key in value)) {
      if (descriptor.optional) continue;
      return INVALID;
    }
    const sanitized = descriptor.sanitize(value[key]);
    if (sanitized === INVALID) return INVALID;
    result[key] = sanitized;
  }
  return result;
};

const uuid = stringValue(
  36,
  36,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);
const slug = stringValue(128, 1, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const isoDateTime = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : INVALID;
const localDate = stringValue(10, 10, /^\d{4}-\d{2}-\d{2}$/);
const published = enumValue(new Set(['published']));
const nullableText = (maximum) => nullable(stringValue(maximum));
const safeExternalUrl = nullable((value) => {
  if (typeof value !== 'string' || value.length > 2048) return INVALID;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.username === '' &&
      url.password === ''
      ? value
      : INVALID;
  } catch {
    return INVALID;
  }
});

const eventValue = objectValue({
  id: field(uuid), slug: field(slug), name: field(nonBlankString(256)),
  timezone: field(nonBlankString(128)), startsAt: field(isoDateTime),
  endsAt: field(isoDateTime),
});
const dayValue = objectValue({
  id: field(uuid), localDate: field(localDate),
  title: field(nonBlankString(256)), sortOrder: field(integerValue()),
  description: optionalField(nullableText(8192)),
});
const roomValue = objectValue({
  id: field(uuid), slug: field(slug), name: field(nonBlankString(256)),
  sortOrder: field(integerValue()),
  description: optionalField(nullableText(8192)),
});
const sessionValue = objectValue({
  id: field(uuid), dayId: field(uuid), roomId: field(nullable(uuid)),
  slug: field(slug), title: field(nonBlankString(512)),
  startsAt: field(isoDateTime), endsAt: field(isoDateTime),
  sortOrder: field(integerValue()),
  summary: optionalField(nullableText(2048)),
  description: optionalField(nullableText(65536)),
  type: field(enumValue(new Set([
    'talk', 'panel', 'workshop', 'mastermind', 'coaching',
    'networking', 'break', 'meal', 'gala', 'other',
  ]))),
  status: optionalField(enumValue(new Set(['published', 'cancelled']))),
});
const programValue = objectValue({
  days: field(arrayValue(64, dayValue)), rooms: field(arrayValue(256, roomValue)),
  sessions: field(arrayValue(4096, sessionValue)),
});
const speakerValue = objectValue({
  id: field(uuid), slug: field(slug),
  firstName: field(nonBlankString(256)), lastName: field(nonBlankString(256)),
  company: field(nullableText(256)), jobTitle: field(nullableText(256)),
  bioMarkdown: field(nullableText(65536)),
  linkedinUrl: field(safeExternalUrl), websiteUrl: field(safeExternalUrl),
  photoAssetId: field(nullable(uuid)), status: field(published),
  sortOrder: field(integerValue()), version: field(integerValue(1)),
});
const partnerValue = objectValue({
  id: field(uuid), slug: field(slug), name: field(nonBlankString(256)),
  descriptionMarkdown: field(nullableText(65536)),
  websiteUrl: field(safeExternalUrl), category: field(nullableText(128)),
  tier: field(nullableText(128)), logoAssetId: field(nullable(uuid)),
  status: field(published), sortOrder: field(integerValue()),
  version: field(integerValue(1)),
});
const venueValue = objectValue({
  id: field(uuid), slug: field(slug), name: field(nonBlankString(256)),
  addressLine1: field(nullableText(256)), addressLine2: field(nullableText(256)),
  city: field(nullableText(128)), postalCode: field(nullableText(32)),
  countryCode: field(nullable(stringValue(2, 2, /^[A-Z]{2}$/))),
  mapQuery: field(nullableText(1024)), status: field(published),
  navigationMarkdown: field(nullableText(65536)),
  accessibilityMarkdown: field(nullableText(65536)),
  sortOrder: field(integerValue()), version: field(integerValue(1)),
});
const practicalPageValue = objectValue({
  id: field(uuid), slug: field(slug),
  kind: field(enumValue(new Set(['practical', 'marketing', 'other']))),
  title: field(nonBlankString(256)), summary: field(nullableText(2048)),
  bodyMarkdown: field(stringValue(65536)),
  status: field(published), sortOrder: field(integerValue()),
  version: field(integerValue(1)),
});
const faqValue = objectValue({
  id: field(uuid), category: field(nullableText(128)),
  question: field(nonBlankString(1024)),
  answerMarkdown: field(stringValue(65536)),
  status: field(published), sortOrder: field(integerValue()),
  version: field(integerValue(1)),
});
const practicalValue = objectValue({
  pages: field(arrayValue(512, practicalPageValue)),
  faqs: field(arrayValue(512, faqValue)),
});
const bootstrapValue = objectValue({
  version: field(integerValue(1)),
  publishedAt: field(isoDateTime),
  event: field(eventValue),
});
const contentValue = objectValue({
  version: field(integerValue(1)),
  publishedAt: field(isoDateTime),
  event: field(eventValue),
  program: field(programValue),
  speakers: field(arrayValue(2048, speakerValue)),
  partners: field(arrayValue(2048, partnerValue)),
  venues: field(arrayValue(2048, venueValue)),
  practical: field(practicalValue),
});

const uniqueValues = (values) => new Set(values).size === values.length;
const intervalIsPositive = (start, end) => Date.parse(end) > Date.parse(start);
const bodyIsValid = (body, kind) => {
  if (!intervalIsPositive(body.event.startsAt, body.event.endsAt)) return false;
  if (kind === 'bootstrap') return true;
  const { days, rooms, sessions } = body.program;
  if (
    !uniqueValues(days.map(({ id }) => id)) ||
    !uniqueValues(rooms.map(({ id }) => id)) ||
    !uniqueValues(rooms.map(({ slug: roomSlug }) => roomSlug)) ||
    !uniqueValues(sessions.map(({ id }) => id)) ||
    !uniqueValues(sessions.map(({ slug: value }) => value))
  ) {
    return false;
  }
  const dayIds = new Set(days.map(({ id }) => id));
  const roomIds = new Set(rooms.map(({ id }) => id));
  return sessions.every(
    (session) =>
      dayIds.has(session.dayId) &&
      (session.roomId === null || roomIds.has(session.roomId)) &&
      intervalIsPositive(session.startsAt, session.endsAt),
  );
};

const sanitizePublicResponse = async (
  request,
  response,
  { stored = false, storedAt: cachedStoredAt = null } = {},
) => {
  const descriptor = publicRequestDescriptor(request);
  if (
    !descriptor ||
    !response.ok ||
    response.status !== 200 ||
    (!stored &&
      (response.redirected ||
        (response.url !== '' && response.url !== descriptor.url.href))) ||
    !responseIsPublic(response) ||
    !/^application\/json(?:;|$)/i.test(
      response.headers.get('content-type') ?? '',
    ) ||
    !sizeAllowed(response, MAX_PUBLIC_RESPONSE_BYTES)
  ) {
    return null;
  }
  try {
    const text = await response.clone().text();
    if (new TextEncoder().encode(text).byteLength > MAX_PUBLIC_RESPONSE_BYTES) {
      return null;
    }
    const body =
      descriptor.kind === 'bootstrap'
        ? bootstrapValue(JSON.parse(text))
        : contentValue(JSON.parse(text));
    if (
      body === INVALID ||
      body.event.slug !== descriptor.slug ||
      !bodyIsValid(body, descriptor.kind)
    ) {
      return null;
    }
    const serialized = JSON.stringify(body);
    if (
      new TextEncoder().encode(serialized).byteLength >
      MAX_PUBLIC_RESPONSE_BYTES
    ) {
      return null;
    }
    const storedAt =
      stored &&
      typeof cachedStoredAt === 'string' &&
      Number.isFinite(Date.parse(cachedStoredAt))
        ? new Date(cachedStoredAt)
        : new Date();
    return {
      body: serialized,
      contractVersion: OFFLINE_CONTRACT_VERSION,
      eventId: body.event.id,
      eventSlug: body.event.slug,
      expiresAt: new Date(
        storedAt.getTime() + PUBLIC_TTL,
      ).toISOString(),
      publicationVersion: body.version,
      storedAt: storedAt.toISOString(),
    };
  } catch {
    return null;
  }
};

const publicResponse = (response, metadata, source) => {
  const headers = safeHeaders(response, 'application/json');
  headers.set('x-byzon-offline-contract-version',
    String(metadata.contractVersion));
  headers.set('x-byzon-event-id', metadata.eventId);
  headers.set('x-byzon-event-slug', metadata.eventSlug);
  headers.set('x-byzon-cache-expires-at', metadata.expiresAt);
  headers.set('x-byzon-publication-version',
    String(metadata.publicationVersion));
  headers.set('x-byzon-cache-stored-at', metadata.storedAt);
  headers.set('x-byzon-cache-source', source);
  if (source === 'cache') headers.set('warning', '110 - "Response is stale"');
  return new Response(metadata.body, { status: 200, headers });
};

const cachedEntry = async (request) => {
  const cache = await caches.open(PUBLIC_CACHE);
  const cached = await cache.match(request);
  if (!cached) return null;
  const publicationVersion = Number(
    cached.headers.get('x-byzon-publication-version'),
  );
  const contractVersion = Number(
    cached.headers.get('x-byzon-offline-contract-version'),
  );
  const eventId = cached.headers.get('x-byzon-event-id');
  const eventSlug = cached.headers.get('x-byzon-event-slug');
  const expiresAt = cached.headers.get('x-byzon-cache-expires-at');
  const storedAt = cached.headers.get('x-byzon-cache-stored-at');
  const sanitized = await sanitizePublicResponse(request, cached, {
    stored: true,
    storedAt,
  });
  if (
    !sanitized ||
    contractVersion !== OFFLINE_CONTRACT_VERSION ||
    eventId !== sanitized.eventId ||
    eventSlug !== sanitized.eventSlug ||
    !Number.isSafeInteger(publicationVersion) ||
    publicationVersion < 1 ||
    publicationVersion !== sanitized.publicationVersion ||
    !storedAt ||
    !Number.isFinite(Date.parse(storedAt)) ||
    !expiresAt ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    expiresAt !== sanitized.expiresAt ||
    Date.parse(expiresAt) <= Date.now()
  ) {
    await cache.delete(request);
    return null;
  }
  const metadata = {
    ...sanitized,
    contractVersion,
    eventId,
    eventSlug,
    expiresAt,
    publicationVersion,
    storedAt,
  };
  return {
    metadata,
    response: publicResponse(cached, metadata, 'cache'),
  };
};

const rejectedResponse = () =>
  new Response('Rejected', {
    status: 502,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  });

const fetchPublic = async (request) => {
  const anonymousRequest = publicRequest(request);
  if (!anonymousRequest) {
    throw new TypeError('Unsafe request.');
  }
  try {
    const response = await fetch(anonymousRequest);
    const metadata = await sanitizePublicResponse(anonymousRequest, response);
    if (metadata) {
      let cached = await cachedEntry(anonymousRequest);
      if (cached && cached.metadata.eventId !== metadata.eventId) {
        await (await caches.open(PUBLIC_CACHE)).delete(anonymousRequest);
        cached = null;
      }
      if (
        cached &&
        cached.metadata.publicationVersion > metadata.publicationVersion
      ) {
        return cached.response;
      }
      const cacheable = publicResponse(response, metadata, 'network');
      await (await caches.open(PUBLIC_CACHE))
        .put(anonymousRequest, cacheable.clone());
      return cacheable;
    }
    const cached = await cachedEntry(anonymousRequest);
    if (cached) return cached.response;
    if (response.status === 200) {
      return rejectedResponse();
    }
    return response;
  } catch {
    const cached = await cachedEntry(anonymousRequest);
    if (cached) return cached.response;
    throw new TypeError('Content unavailable');
  }
};

const publicRequests = new Map();
const serializePublic = (request) => {
  const key = request.url;
  const previous = publicRequests.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => fetchPublic(request))
    .finally(() => {
      if (publicRequests.get(key) === current) {
        publicRequests.delete(key);
      }
    });
  publicRequests.set(key, current);
  return current;
};

const rollbackResponse = async () => {
  const names = await caches.keys();
  const verified = await verifiedShells(names);
  for (const candidate of verified) {
    if (candidate.name === SHELL_CACHE) continue;
    const response = await (await caches.open(candidate.name))
      .match(OFFLINE_URL);
    if (response) return response;
  }
  return null;
};

const navigationResponse = async (request) => {
  try {
    return await fetch(request);
  } catch {
    const current = await (await caches.open(SHELL_CACHE)).match(OFFLINE_URL);
    if (current) return current;
    return (
      (await rollbackResponse()) ??
      new Response('Offline', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    );
  }
};

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(navigationResponse(event.request));
    return;
  }
  if (publicRequestDescriptor(event.request)) {
    event.respondWith(serializePublic(event.request));
  }
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
