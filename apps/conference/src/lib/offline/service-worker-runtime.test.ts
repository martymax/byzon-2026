import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://app.byzon.test';
const PUBLIC_CACHE = 'byzon-pwa-public-v3';
const SHELL_ASSETS = [
  '/offline',
  '/icons/icon.svg',
  '/icons/maskable.svg',
  '/manifest.webmanifest',
  '/_next/static/chunks/offline.css',
  '/_next/static/chunks/offline.js',
  '/_next/static/media/offline.woff2',
] as const;
const shellBody = (path: string): string =>
  path.endsWith('.svg')
    ? '<svg xmlns="http://www.w3.org/2000/svg"/>'
    : `shell:${path}`;
const shellAssetDigest = (content: string): string =>
  createHash('sha256').update(content).digest('hex');
const SHELL_DIGESTS = Object.freeze(
  Object.fromEntries(
    SHELL_ASSETS.map((asset) => [asset, shellAssetDigest(shellBody(asset))]),
  ),
);
const shellManifestVersion = (
  assets: readonly string[],
  digests: Readonly<Record<string, string>> = SHELL_DIGESTS,
): string =>
  shellAssetDigest(
    JSON.stringify(assets.map((asset) => [asset, digests[asset]])),
  );
const shellCacheName = (
  workerVersion: string,
  assets: readonly string[] = SHELL_ASSETS,
) =>
  `byzon-pwa-shell-${workerVersion}-${shellManifestVersion(
    assets,
    SHELL_DIGESTS,
  )}`;
const CURRENT_SHELL = shellCacheName('2026.07.25.5');
const workerSource = readFileSync(
  new URL('../../../public/sw.js', import.meta.url),
  'utf8',
);

class WorkerRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init);
  }
}

const responseAt = (
  url: string,
  body: BodyInit,
  init: ResponseInit,
  redirected = false,
): Response => {
  const response = new Response(body, init);
  Object.defineProperties(response, {
    redirected: { configurable: true, value: redirected },
    url: { configurable: true, value: url },
  });
  return response;
};

class MemoryCache {
  readonly entries = new Map<string, Response>();

  private key(input: RequestInfo | URL): string {
    if (typeof input === 'string') return new URL(input, ORIGIN).href;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  async delete(input: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.key(input));
  }

  async match(input: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(this.key(input))?.clone();
  }

  async put(input: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(this.key(input), response.clone());
  }
}

class MemoryCacheStorage {
  readonly stores = new Map<string, MemoryCache>();

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async open(name: string): Promise<MemoryCache> {
    const existing = this.stores.get(name);
    if (existing) return existing;
    const cache = new MemoryCache();
    this.stores.set(name, cache);
    return cache;
  }
}

type WorkerHandler = (event: {
  readonly data?: unknown;
  readonly ports?: readonly { postMessage(value: unknown): void }[];
  readonly request?: Request;
  readonly source?: { postMessage(value: unknown): void } | null;
  readonly tag?: string;
  respondWith?(promise: Promise<Response>): void;
  waitUntil?(promise: Promise<unknown>): void;
}) => void;

const createWorkerHarness = (
  manifestVersion = shellManifestVersion(SHELL_ASSETS, SHELL_DIGESTS),
) => {
  const caches = new MemoryCacheStorage();
  const handlers = new Map<string, WorkerHandler>();
  let fetchImplementation = async (request: Request): Promise<Response> => {
    void request;
    throw new TypeError('Unexpected worker fetch.');
  };
  const clients = {
    claim: vi.fn(async () => undefined),
    matchAll: vi.fn(async () => []),
  };
  const serviceWorker = {
    __BYZON_SHELL_MANIFEST__: Object.freeze({
      assets: Object.freeze([...SHELL_ASSETS]),
      digests: SHELL_DIGESTS,
      version: manifestVersion,
    }),
    addEventListener: (type: string, handler: WorkerHandler) => {
      handlers.set(type, handler);
    },
    clients,
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(async () => undefined),
  };
  const context = createContext({
    Date,
    Headers,
    Request: WorkerRequest,
    Response,
    Symbol,
    TextEncoder,
    URL,
    caches,
    console,
    crypto: webcrypto,
    fetch: (request: Request) => fetchImplementation(request),
    importScripts: vi.fn(),
    self: serviceWorker,
  });
  new Script(workerSource, { filename: 'sw.js' }).runInContext(context);

  const dispatchWaitUntil = async (type: string): Promise<void> => {
    let completion: Promise<unknown> | undefined;
    handlers.get(type)?.({
      waitUntil: (promise) => {
        completion = promise;
      },
    });
    if (!completion) throw new TypeError(`Missing ${type} waitUntil.`);
    await completion;
  };

  const dispatchFetch = async (request: Request): Promise<Response> => {
    let response: Promise<Response> | undefined;
    handlers.get('fetch')?.({
      request,
      respondWith: (promise) => {
        response = promise;
      },
    });
    if (!response) throw new TypeError('Worker did not intercept request.');
    return response;
  };

  return {
    caches,
    dispatchFetch,
    dispatchWaitUntil,
    handlers,
    serviceWorker,
    setFetch: (
      implementation: (request: Request) => Promise<Response>,
    ): void => {
      fetchImplementation = implementation;
    },
  };
};

const shellResponse = (request: Request): Response => {
  const url = new URL(request.url);
  const extension = url.pathname.split('.').at(-1);
  const contentType =
    url.pathname === '/offline'
      ? 'text/html; charset=utf-8'
      : url.pathname === '/manifest.webmanifest'
        ? 'application/manifest+json'
        : extension === 'svg'
          ? 'image/svg+xml'
          : extension === 'css'
            ? 'text/css'
            : extension === 'js'
              ? 'application/javascript'
              : 'font/woff2';
  return responseAt(url.href, shellBody(url.pathname), {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=3600',
      'content-type': contentType,
    },
  });
};

const seedVerifiedShell = async (
  caches: MemoryCacheStorage,
  name: string,
  installedAt: string,
): Promise<MemoryCache> => {
  const cache = await caches.open(name);
  for (const path of SHELL_ASSETS) {
    await cache.put(path, shellResponse(new WorkerRequest(path)));
  }
  await cache.put(
    '/__byzon_pwa_shell_metadata__',
    Response.json(
      {
        assets: [...SHELL_ASSETS],
        cacheName: name,
        complete: true,
        digests: { ...SHELL_DIGESTS },
        installedAt,
        version: name.replace('byzon-pwa-shell-', ''),
      },
      {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json',
        },
      },
    ),
  );
  return cache;
};

const publicContent = (
  version: number,
  eventId = '01930000-0000-7000-8000-000000000001',
) => ({
  version,
  publishedAt: '2026-07-25T08:00:00.000Z',
  event: {
    id: eventId,
    slug: 'byzon-2026',
    name: 'BYZON 2026',
    timezone: 'Europe/Prague',
    startsAt: '2026-09-18T06:00:00.000Z',
    endsAt: '2026-09-19T20:00:00.000Z',
    organizerEmail: 'must-not-enter-cache@example.test',
  },
  program: {
    days: [],
    rooms: [],
    sessions: [],
    privateNotes: ['must-not-enter-cache'],
  },
  speakers: [],
  partners: [],
  venues: [],
  practical: { pages: [], faqs: [] },
  privateAdminNote: 'must-not-enter-cache',
});

const publicResponse = (
  request: Request,
  version: number,
  extraHeaders: Record<string, string> = {},
  body: unknown = publicContent(version),
): Response =>
  responseAt(request.url, JSON.stringify(body), {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=60',
      'content-type': 'application/json',
      ...extraHeaders,
    },
  });

const publicContentWithProgram = (version: number) => ({
  ...publicContent(version),
  program: {
    days: [
      {
        id: '01930000-0000-7000-8000-000000000011',
        localDate: '2026-09-18',
        title: 'Pátek',
        sortOrder: 0,
      },
    ],
    rooms: [
      {
        id: '01930000-0000-7000-8000-000000000012',
        slug: 'main-stage',
        name: 'Main stage',
        sortOrder: 0,
      },
    ],
    sessions: [
      {
        id: '01930000-0000-7000-8000-000000000013',
        dayId: '01930000-0000-7000-8000-000000000011',
        roomId: '01930000-0000-7000-8000-000000000012',
        slug: 'opening',
        title: 'Opening',
        type: 'talk',
        status: 'published',
        startsAt: '2026-09-18T07:00:00.000Z',
        endsAt: '2026-09-18T08:00:00.000Z',
        sortOrder: 0,
      },
    ],
  },
});

describe('service-worker runtime policy', () => {
  it('rejects a manifest fingerprint that does not match its asset digests', async () => {
    const worker = createWorkerHarness('0'.repeat(64));
    worker.setFetch(async (request) => shellResponse(request));

    await expect(worker.dispatchWaitUntil('install')).rejects.toThrow(
      'Fingerprint mismatch',
    );
    expect(await worker.caches.keys()).not.toContain(CURRENT_SHELL);
  });

  it('keeps the old shell intact when a new build install is incomplete', async () => {
    const worker = createWorkerHarness();
    const old = await worker.caches.open('byzon-pwa-shell-2026.07.24.1');
    await old.put('/offline', new Response('old offline'));
    worker.setFetch(async (request) => {
      if (new URL(request.url).pathname === '/icons/maskable.svg') {
        return responseAt(request.url, 'failure', {
          status: 500,
          headers: {
            'cache-control': 'public',
            'content-type': 'image/svg+xml',
          },
        });
      }
      return shellResponse(request);
    });

    await expect(worker.dispatchWaitUntil('install')).rejects.toThrow(
      'not safely cacheable',
    );
    expect(await worker.caches.keys()).toContain(
      'byzon-pwa-shell-2026.07.24.1',
    );
    expect(await worker.caches.keys()).not.toContain(CURRENT_SHELL);
    expect(await old.match('/offline')).toBeDefined();
  });

  it('rejects a cacheable shell response whose bytes differ from the build manifest', async () => {
    const worker = createWorkerHarness();
    worker.setFetch(async (request) => {
      if (new URL(request.url).pathname === '/icons/icon.svg') {
        return responseAt(request.url, '<svg><title>tampered</title></svg>', {
          status: 200,
          headers: {
            'cache-control': 'public',
            'content-type': 'image/svg+xml',
          },
        });
      }
      return shellResponse(request);
    });

    await expect(worker.dispatchWaitUntil('install')).rejects.toThrow(
      'digest mismatch',
    );
    expect(await worker.caches.keys()).not.toContain(CURRENT_SHELL);
  });

  it('precaches and serves every generated CSS, JS, font and document dependency offline', async () => {
    const worker = createWorkerHarness();
    const fetched: Request[] = [];
    worker.setFetch(async (request) => {
      fetched.push(request);
      return shellResponse(request);
    });

    await worker.dispatchWaitUntil('install');

    expect(fetched.map(({ url }) => new URL(url).pathname)).toEqual([
      ...SHELL_ASSETS,
    ]);
    expect(fetched.every(({ credentials }) => credentials === 'omit')).toBe(
      true,
    );
    worker.setFetch(async () => {
      throw new TypeError('offline');
    });
    const css = await worker.dispatchFetch(
      new WorkerRequest(`${ORIGIN}/_next/static/chunks/offline.css`),
    );
    const script = await worker.dispatchFetch(
      new WorkerRequest(`${ORIGIN}/_next/static/chunks/offline.js`),
    );
    const font = await worker.dispatchFetch(
      new WorkerRequest(`${ORIGIN}/_next/static/media/offline.woff2`),
    );

    expect(await css.text()).toContain('offline.css');
    expect(await script.text()).toContain('offline.js');
    expect(await font.text()).toContain('offline.woff2');
  });

  it('activates a complete shell and retains only one verified rollback', async () => {
    const worker = createWorkerHarness();
    for (const [name, installedAt] of [
      [shellCacheName('2026.07.22.1'), '2026-07-22T08:00:00.000Z'],
      [shellCacheName('2026.07.24.1'), '2026-07-24T08:00:00.000Z'],
    ] as const) {
      await seedVerifiedShell(worker.caches, name, installedAt);
    }
    await worker.caches.open('byzon-pwa-shell-unverified');
    const legacy = await worker.caches.open('byzon-shell-v1');
    await legacy.put('/offline', shellResponse(new WorkerRequest('/offline')));
    worker.setFetch(async (request) => shellResponse(request));

    await worker.dispatchWaitUntil('install');
    await worker.dispatchWaitUntil('activate');

    expect((await worker.caches.keys()).sort()).toEqual(
      [CURRENT_SHELL, shellCacheName('2026.07.24.1')].sort(),
    );
    expect(worker.serviceWorker.clients.claim).toHaveBeenCalledOnce();
  });

  it('refuses activation when the installed current shell changes before activate', async () => {
    const worker = createWorkerHarness();
    const rollbackName = shellCacheName('2026.07.24.1');
    await seedVerifiedShell(
      worker.caches,
      rollbackName,
      '2026-07-24T08:00:00.000Z',
    );
    worker.setFetch(async (request) => shellResponse(request));
    await worker.dispatchWaitUntil('install');
    const current = await worker.caches.open(CURRENT_SHELL);
    await current.put(
      '/offline',
      responseAt(`${ORIGIN}/offline`, '<main>changed after install</main>', {
        status: 200,
        headers: {
          'cache-control': 'public',
          'content-type': 'text/html; charset=utf-8',
        },
      }),
    );

    await expect(worker.dispatchWaitUntil('activate')).rejects.toThrow(
      'Current shell invalid',
    );
    expect(worker.serviceWorker.clients.claim).not.toHaveBeenCalled();
    expect(await worker.caches.keys()).toContain(rollbackName);
    expect(await worker.caches.keys()).not.toContain(CURRENT_SHELL);
  });

  it('rejects a changed current offline document before navigation fallback', async () => {
    const worker = createWorkerHarness();
    const rollbackName = shellCacheName('2026.07.24.1');
    await seedVerifiedShell(
      worker.caches,
      rollbackName,
      '2026-07-24T08:00:00.000Z',
    );
    worker.setFetch(async (request) => shellResponse(request));
    await worker.dispatchWaitUntil('install');
    const current = await worker.caches.open(CURRENT_SHELL);
    await current.put(
      '/offline',
      responseAt(`${ORIGIN}/offline`, '<main>changed after install</main>', {
        status: 200,
        headers: {
          'cache-control': 'public',
          'content-type': 'text/html; charset=utf-8',
        },
      }),
    );
    worker.setFetch(async () => {
      throw new TypeError('offline');
    });
    const navigation = new WorkerRequest(`${ORIGIN}/app`);
    Object.defineProperty(navigation, 'mode', { value: 'navigate' });

    const response = await worker.dispatchFetch(navigation);

    expect(await response.text()).toBe('shell:/offline');
    expect(await worker.caches.keys()).not.toContain(CURRENT_SHELL);
    expect(await worker.caches.keys()).toContain(rollbackName);
  });

  it('rejects rollback caches with a partial manifest, mismatched metadata, unsafe asset or changed bytes', async () => {
    const worker = createWorkerHarness();
    const partial = await seedVerifiedShell(
      worker.caches,
      shellCacheName('2026.07.23.1'),
      '2026-07-23T08:00:00.000Z',
    );
    await partial.delete('/icons/maskable.svg');
    const mismatched = await seedVerifiedShell(
      worker.caches,
      shellCacheName('2026.07.24.1'),
      '2026-07-24T08:00:00.000Z',
    );
    await mismatched.put(
      '/__byzon_pwa_shell_metadata__',
      Response.json(
        {
          assets: [...SHELL_ASSETS],
          cacheName: 'byzon-pwa-shell-other',
          complete: true,
          digests: { ...SHELL_DIGESTS },
          installedAt: '2026-07-24T08:00:00.000Z',
          version: '2026.07.24.1',
        },
        {
          headers: {
            'cache-control': 'no-store',
            'content-type': 'application/json',
          },
        },
      ),
    );
    const unsafe = await seedVerifiedShell(
      worker.caches,
      shellCacheName('2026.07.25.1'),
      '2026-07-25T08:00:00.000Z',
    );
    await unsafe.put(
      '/icons/icon.svg',
      responseAt(`${ORIGIN}/icons/icon.svg`, '<svg/>', {
        status: 200,
        headers: {
          'cache-control': 'private, no-store',
          'content-type': 'image/svg+xml',
        },
      }),
    );
    const changed = await seedVerifiedShell(
      worker.caches,
      shellCacheName('2026.07.25.2'),
      '2026-07-25T09:00:00.000Z',
    );
    await changed.put(
      '/icons/icon.svg',
      responseAt(
        `${ORIGIN}/icons/icon.svg`,
        '<svg><title>changed</title></svg>',
        {
          status: 200,
          headers: {
            'cache-control': 'public',
            'content-type': 'image/svg+xml',
          },
        },
      ),
    );
    worker.setFetch(async (request) => shellResponse(request));

    await worker.dispatchWaitUntil('install');
    await worker.dispatchWaitUntil('activate');

    expect(await worker.caches.keys()).toEqual([CURRENT_SHELL]);
  });

  it('handshakes the exact waiting version before skip-waiting', async () => {
    const worker = createWorkerHarness();
    const replies: unknown[] = [];
    worker.handlers.get('message')?.({
      data: { type: 'BYZON_GET_VERSION' },
      ports: [{ postMessage: (value) => replies.push(value) }],
    });
    expect(replies).toEqual([
      {
        type: 'BYZON_WORKER_VERSION',
        version: '2026.07.25.5',
      },
    ]);

    let completion: Promise<unknown> | undefined;
    worker.handlers.get('message')?.({
      data: {
        type: 'BYZON_SKIP_WAITING',
        version: '2026.07.25.4',
      },
      waitUntil: (promise) => {
        completion = promise;
      },
    });
    expect(completion).toBeUndefined();
    expect(worker.serviceWorker.skipWaiting).not.toHaveBeenCalled();

    worker.handlers.get('message')?.({
      data: {
        type: 'BYZON_SKIP_WAITING',
        version: '2026.07.25.5',
      },
      waitUntil: (promise) => {
        completion = promise;
      },
    });
    await completion;
    expect(worker.serviceWorker.skipWaiting).toHaveBeenCalledOnce();
  });

  it('sanitizes public bodies and never downgrades a newer cached version', async () => {
    const worker = createWorkerHarness();
    const fetchedRequests: Request[] = [];
    worker.setFetch(async (request) => {
      fetchedRequests.push(request);
      return publicResponse(request, fetchedRequests.length === 1 ? 5 : 4);
    });
    const request = new WorkerRequest(
      `${ORIGIN}/api/v1/public/events/byzon-2026/content`,
    );

    const first = await worker.dispatchFetch(request);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody.version).toBe(5);
    expect(firstBody).not.toHaveProperty('privateAdminNote');
    expect(firstBody.event).not.toHaveProperty('organizerEmail');
    expect(firstBody.program).not.toHaveProperty('privateNotes');
    expect(fetchedRequests[0]?.credentials).toBe('omit');
    expect(fetchedRequests[0]?.redirect).toBe('error');

    const downgrade = await worker.dispatchFetch(request);
    expect((await downgrade.json()).version).toBe(5);
    expect(downgrade.headers.get('x-byzon-cache-source')).toBe('cache');
    expect(
      await (await worker.caches.open(PUBLIC_CACHE)).match(request),
    ).toBeDefined();
  });

  it('preserves a good cache when a higher version violates content refinements', async () => {
    const worker = createWorkerHarness();
    const request = new WorkerRequest(
      `${ORIGIN}/api/v1/public/events/byzon-2026/content`,
    );
    const good = publicContentWithProgram(5);
    worker.setFetch(async (networkRequest) =>
      publicResponse(networkRequest, 5, {}, good),
    );
    expect((await (await worker.dispatchFetch(request)).json()).version).toBe(
      5,
    );

    const session = good.program.sessions[0]!;
    const invalidBodies = [
      {
        ...good,
        version: 6,
        event: {
          ...good.event,
          endsAt: good.event.startsAt,
        },
      },
      {
        ...good,
        version: 6,
        publishedAt: '2026-07-25T08:00:00',
      },
      {
        ...good,
        version: 6,
        event: {
          ...good.event,
          startsAt: '2026-02-30T08:00:00.000Z',
        },
      },
      {
        ...good,
        version: 6,
        program: {
          ...good.program,
          days: [{ ...good.program.days[0]!, localDate: '2026-02-30' }],
        },
      },
      {
        ...good,
        version: 6,
        program: {
          ...good.program,
          sessions: [{ ...session, startsAt: '2026-09-18T07:00:00.000' }],
        },
      },
      {
        ...good,
        version: 6,
        program: {
          ...good.program,
          sessions: [session, { ...session }],
        },
      },
      {
        ...good,
        version: 6,
        program: {
          ...good.program,
          sessions: [
            {
              ...session,
              dayId: '01930000-0000-7000-8000-000000000099',
            },
          ],
        },
      },
      {
        ...good,
        version: 6,
        program: {
          ...good.program,
          sessions: [
            {
              ...session,
              roomId: '01930000-0000-7000-8000-000000000098',
            },
          ],
        },
      },
      {
        ...good,
        version: 6,
        program: {
          ...good.program,
          sessions: [{ ...session, endsAt: session.startsAt }],
        },
      },
    ];

    for (const invalid of invalidBodies) {
      worker.setFetch(async (networkRequest) =>
        publicResponse(networkRequest, 6, {}, invalid),
      );
      const response = await worker.dispatchFetch(request);
      expect((await response.json()).version).toBe(5);
      expect(response.headers.get('x-byzon-cache-source')).toBe('cache');
    }

    const persisted = await (
      await worker.caches.open(PUBLIC_CACHE)
    ).match(request);
    expect((await persisted?.json()).version).toBe(5);
  });

  it('serializes same-key v5/v4 fetches so the lower version cannot win', async () => {
    const worker = createWorkerHarness();
    const request = new WorkerRequest(
      `${ORIGIN}/api/v1/public/events/byzon-2026/content`,
    );
    let call = 0;
    worker.setFetch(async (networkRequest) => {
      call += 1;
      return publicResponse(networkRequest, call === 1 ? 5 : 4);
    });

    const [first, second] = await Promise.all([
      worker.dispatchFetch(request),
      worker.dispatchFetch(request),
    ]);

    expect((await first.json()).version).toBe(5);
    expect((await second.json()).version).toBe(5);
    const persisted = await (
      await worker.caches.open(PUBLIC_CACHE)
    ).match(request);
    expect((await persisted?.json()).version).toBe(5);
  });

  it('evicts a same-slug cache when the canonical event id changes', async () => {
    const worker = createWorkerHarness();
    const request = new WorkerRequest(
      `${ORIGIN}/api/v1/public/events/byzon-2026/content`,
    );
    const replacementEventId = '01930000-0000-7000-8000-000000000099';
    worker.setFetch(async (networkRequest) =>
      publicResponse(networkRequest, 9),
    );
    await worker.dispatchFetch(request);
    worker.setFetch(async (networkRequest) =>
      publicResponse(
        networkRequest,
        1,
        {},
        publicContent(1, replacementEventId),
      ),
    );

    const replacement = await worker.dispatchFetch(request);
    expect((await replacement.json()).event.id).toBe(replacementEventId);
    expect(replacement.headers.get('x-byzon-cache-source')).toBe('network');
    const persisted = await (
      await worker.caches.open(PUBLIC_CACHE)
    ).match(request);
    expect(persisted?.headers.get('x-byzon-event-id')).toBe(replacementEventId);
  });

  it('rejects Vary/Cookie, Set-Cookie and oversized responses from cache', async () => {
    const worker = createWorkerHarness();
    const request = new WorkerRequest(
      `${ORIGIN}/api/v1/public/events/byzon-2026/content`,
    );
    for (const headers of [
      { vary: 'Accept, Cookie' },
      { 'set-cookie': 'session=secret; HttpOnly' },
      { 'content-length': String(8 * 1024 * 1024 + 1) },
    ]) {
      worker.setFetch(async (networkRequest) =>
        publicResponse(networkRequest, 6, headers),
      );
      await worker.dispatchFetch(request);
      expect(
        await (await worker.caches.open(PUBLIC_CACHE)).match(request),
      ).toBeUndefined();
    }
  });
});
