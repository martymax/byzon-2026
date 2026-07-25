import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://app.byzon.test';
const CURRENT_SHELL = 'byzon-pwa-shell-2026.07.25.3';
const PUBLIC_CACHE = 'byzon-pwa-public-v3';
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

const createWorkerHarness = () => {
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
    fetch: (request: Request) => fetchImplementation(request),
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
  const svg = url.pathname.endsWith('.svg');
  return responseAt(
    url.href,
    svg ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : '<h1>Offline</h1>',
    {
      status: 200,
      headers: {
        'cache-control': 'public, max-age=3600',
        'content-type': svg ? 'image/svg+xml' : 'text/html; charset=utf-8',
      },
    },
  );
};

const publicContent = (version: number) => ({
  version,
  publishedAt: '2026-07-25T08:00:00.000Z',
  event: {
    id: '01930000-0000-7000-8000-000000000001',
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
): Response =>
  responseAt(request.url, JSON.stringify(publicContent(version)), {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=60',
      'content-type': 'application/json',
      ...extraHeaders,
    },
  });

describe('service-worker runtime policy', () => {
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

  it('activates a complete shell and retains only one verified rollback', async () => {
    const worker = createWorkerHarness();
    for (const [name, installedAt] of [
      ['byzon-pwa-shell-2026.07.22.1', '2026-07-22T08:00:00.000Z'],
      ['byzon-pwa-shell-2026.07.24.1', '2026-07-24T08:00:00.000Z'],
    ] as const) {
      const cache = await worker.caches.open(name);
      await cache.put('/offline', new Response('old offline'));
      await cache.put(
        '/__byzon_pwa_shell_metadata__',
        Response.json({ complete: true, installedAt, version: name }),
      );
    }
    await worker.caches.open('byzon-pwa-shell-unverified');
    worker.setFetch(async (request) => shellResponse(request));

    await worker.dispatchWaitUntil('install');
    await worker.dispatchWaitUntil('activate');

    expect((await worker.caches.keys()).sort()).toEqual(
      [CURRENT_SHELL, 'byzon-pwa-shell-2026.07.24.1'].sort(),
    );
    expect(worker.serviceWorker.clients.claim).toHaveBeenCalledOnce();
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
        version: '2026.07.25.3',
      },
    ]);

    let completion: Promise<unknown> | undefined;
    worker.handlers.get('message')?.({
      data: {
        type: 'BYZON_SKIP_WAITING',
        version: '2026.07.25.2',
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
        version: '2026.07.25.3',
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
