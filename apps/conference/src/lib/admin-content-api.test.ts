import { describe, expect, it, vi } from 'vitest';

import {
  createFetchAdminContentPort,
  type AdminPublicationPreview,
} from './admin-content-api';

const ids = {
  event: '019fc500-0000-7000-8000-000000000001',
  foreignEvent: '019fc500-0000-7000-8000-000000000002',
  item: '019fc500-0000-7000-8000-000000000003',
} as const;
const checksum = 'a'.repeat(64);
const emptyPublicationSummary = {
  available: true as const,
  changeCount: 0,
  changes: [],
  previousPublication: null,
};
const publicationSnapshot = {
  event: {
    endsAt: '2026-09-20T18:00:00.000Z',
    id: ids.event,
    name: 'BYZON 2026',
    slug: 'byzon-2026',
    startsAt: '2026-09-18T07:00:00.000Z',
    timezone: 'Europe/Prague',
  },
  partners: [],
  practical: { faqs: [], pages: [] },
  program: { days: [], rooms: [], sessions: [] },
  speakers: [],
  venues: [],
};
const sessionItem = (eventId: string = ids.event) => ({
  dayId: '019fc500-0000-7000-8000-000000000004',
  description: null,
  endsAt: '2026-09-18T11:00:00.000Z',
  eventId,
  id: ids.item,
  roomId: null,
  slug: 'synteticky-program',
  sortOrder: 0,
  speakerIds: [],
  startsAt: '2026-09-18T10:00:00.000Z',
  status: 'published',
  summary: 'Shrnutí',
  title: 'Syntetický program',
  type: 'talk',
  version: 3,
});

const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'x-request-id': 'admin-content-test-0001',
    },
  });

describe('admin content fetch port', () => {
  it('performs an event-correlated no-store list read', async () => {
    const fetcher = vi.fn(async () =>
      response({
        resource: 'sessions',
        items: [sessionItem()],
        requestId: 'admin-content-test-0001',
      }),
    );
    const port = createFetchAdminContentPort(
      fetcher as unknown as typeof fetch,
    );

    await expect(port.list(ids.event, 'sessions')).resolves.toMatchObject({
      ok: true,
      data: {
        resource: 'sessions',
        items: [{ eventId: ids.event, id: ids.item, version: 3 }],
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/admin/events/${ids.event}/content/sessions`,
      {
        cache: 'no-store',
        credentials: 'same-origin',
        method: 'GET',
        redirect: 'error',
      },
    );
  });

  it('accepts the full server-supported Markdown range for pages and FAQs', async () => {
    const markdown = 'x'.repeat(65_536);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          resource: 'pages',
          items: [
            {
              bodyMarkdown: markdown,
              eventId: ids.event,
              id: ids.item,
              kind: 'practical',
              slug: 'dlouha-stranka',
              sortOrder: 0,
              status: 'draft',
              title: 'Dlouhá stránka',
              version: 1,
            },
          ],
          requestId: 'admin-content-test-0001',
        }),
      )
      .mockResolvedValueOnce(
        response({
          resource: 'faqs',
          items: [
            {
              answerMarkdown: markdown,
              category: null,
              eventId: ids.event,
              id: ids.item,
              question: 'Dlouhá odpověď?',
              sortOrder: 0,
              status: 'draft',
              version: 1,
            },
          ],
          requestId: 'admin-content-test-0001',
        }),
      )
      .mockResolvedValueOnce(
        response({
          resource: 'pages',
          items: [
            {
              bodyMarkdown: `${markdown}x`,
              eventId: ids.event,
              id: ids.item,
              kind: 'practical',
              slug: 'prilis-dlouha-stranka',
              sortOrder: 0,
              status: 'draft',
              title: 'Příliš dlouhá stránka',
              version: 1,
            },
          ],
          requestId: 'admin-content-test-0001',
        }),
      )
      .mockResolvedValueOnce(
        response({
          resource: 'faqs',
          items: [
            {
              answerMarkdown: `${markdown}x`,
              category: null,
              eventId: ids.event,
              id: ids.item,
              question: 'Příliš dlouhá odpověď?',
              sortOrder: 0,
              status: 'draft',
              version: 1,
            },
          ],
          requestId: 'admin-content-test-0001',
        }),
      );
    const port = createFetchAdminContentPort(
      fetcher as unknown as typeof fetch,
    );

    await expect(port.list(ids.event, 'pages')).resolves.toMatchObject({
      ok: true,
      data: { items: [{ bodyMarkdown: markdown }] },
    });
    await expect(port.list(ids.event, 'faqs')).resolves.toMatchObject({
      ok: true,
      data: { items: [{ answerMarkdown: markdown }] },
    });
    await expect(port.list(ids.event, 'pages')).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
    await expect(port.list(ids.event, 'faqs')).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('sends exact create, update and archive intents and correlates replies', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            id: ids.item,
            requestId: 'admin-content-test-0001',
            status: 'created',
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        response({
          id: ids.item,
          requestId: 'admin-content-test-0001',
          status: 'updated',
        }),
      )
      .mockResolvedValueOnce(
        response({
          id: ids.item,
          requestId: 'admin-content-test-0001',
          status: 'archived',
        }),
      );
    const port = createFetchAdminContentPort(
      fetcher as unknown as typeof fetch,
    );
    const createBody = {
      name: 'Partner Test',
      slug: 'partner-test',
      sortOrder: 0,
    };

    await expect(
      port.save({
        body: createBody,
        eventId: ids.event,
        resource: 'partners',
      }),
    ).resolves.toMatchObject({ ok: true, data: { status: 'created' } });
    await expect(
      port.save({
        body: { ...createBody, name: 'Partner Updated', version: 1 },
        eventId: ids.event,
        id: ids.item,
        resource: 'partners',
      }),
    ).resolves.toMatchObject({ ok: true, data: { status: 'updated' } });
    await expect(
      port.archive({
        eventId: ids.event,
        id: ids.item,
        resource: 'partners',
        version: 2,
      }),
    ).resolves.toMatchObject({ ok: true, data: { status: 'archived' } });

    expect(fetcher.mock.calls).toEqual([
      [
        `/api/v1/admin/events/${ids.event}/content/partners`,
        expect.objectContaining({
          body: JSON.stringify(createBody),
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          redirect: 'error',
        }),
      ],
      [
        `/api/v1/admin/events/${ids.event}/content/partners/${ids.item}`,
        expect.objectContaining({
          body: JSON.stringify({
            ...createBody,
            name: 'Partner Updated',
            version: 1,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }),
      ],
      [
        `/api/v1/admin/events/${ids.event}/content/partners/${ids.item}`,
        expect.objectContaining({
          headers: { 'if-match': '"2"' },
          method: 'DELETE',
        }),
      ],
    ]);
  });

  it('publishes only the checksum and prior version from the immutable preview', async () => {
    const preview: AdminPublicationPreview = {
      checksumSha256: checksum,
      createdAt: '2026-07-26T10:00:00.000Z',
      expectedPreviousVersion: 4,
      itemCount: 0,
      requestId: 'admin-content-test-0001',
      significantSessionIds: [ids.item],
      summary: emptyPublicationSummary,
      version: 5,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          checksumSha256: checksum,
          createdAt: '2026-07-26T10:00:00.000Z',
          requestId: 'admin-content-test-0001',
          significantSessionIds: [ids.item],
          summary: emptyPublicationSummary,
          snapshot: publicationSnapshot,
          version: 5,
        }),
      )
      .mockResolvedValueOnce(
        response({
          checksumSha256: checksum,
          publishedAt: '2026-07-26T10:05:00.000Z',
          requestId: 'admin-content-test-0001',
          version: 5,
        }),
      );
    const port = createFetchAdminContentPort(
      fetcher as unknown as typeof fetch,
    );

    await expect(port.previewPublication(ids.event)).resolves.toMatchObject({
      ok: true,
      data: {
        checksumSha256: checksum,
        expectedPreviousVersion: 4,
        itemCount: 0,
        significantSessionIds: [ids.item],
        version: 5,
      },
    });
    await expect(port.publish(ids.event, preview)).resolves.toMatchObject({
      ok: true,
      data: { checksumSha256: checksum, version: 5 },
    });
    expect(fetcher.mock.calls[1]).toEqual([
      `/api/v1/admin/events/${ids.event}/publication`,
      expect.objectContaining({
        body: JSON.stringify({
          expectedChecksumSha256: checksum,
          expectedPreviousVersion: 4,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    ]);
  });

  it.each([
    [401, 'AUTHENTICATION_REQUIRED', 'session_expired'],
    [403, 'ORIGIN_REJECTED', 'permission'],
    [404, 'CONTENT_NOT_FOUND', 'permission'],
    [404, 'MISSING_ITEM', 'not_found'],
    [409, 'STALE_CONTENT_VERSION', 'stale'],
    [409, 'CONTENT_IN_USE', 'conflict'],
    [422, 'CONTENT_NOT_PUBLISHABLE', 'validation'],
    [500, 'INTERNAL_ERROR', 'server'],
  ] as const)('maps HTTP %s / %s to %s', async (status, code, kind) => {
    const fetcher = vi.fn(async () =>
      response(
        {
          code,
          detail: 'Bezpečný syntetický detail.',
          fieldErrors: { slug: ['Slug je obsazený.'] },
          requestId: 'admin-content-test-0001',
        },
        status,
      ),
    );
    const port = createFetchAdminContentPort(
      fetcher as unknown as typeof fetch,
    );

    await expect(port.list(ids.event, 'partners')).resolves.toMatchObject({
      ok: false,
      failure: {
        fieldErrors: { slug: 'Slug je obsazený.' },
        kind,
        requestId: 'admin-content-test-0001',
      },
    });
  });

  it('rejects malformed, cross-event and intent-mismatched success payloads', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          resource: 'sessions',
          items: [{ id: ids.item, version: 1 }],
          requestId: 'admin-content-test-0001',
        }),
      )
      .mockResolvedValueOnce(
        response({
          resource: 'sessions',
          items: [sessionItem(ids.foreignEvent)],
          requestId: 'admin-content-test-0001',
        }),
      )
      .mockResolvedValueOnce(
        response(
          {
            id: ids.item,
            requestId: 'admin-content-test-0001',
            status: 'archived',
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        response({
          checksumSha256: 'b'.repeat(64),
          requestId: 'admin-content-test-0001',
          version: 6,
        }),
      );
    const port = createFetchAdminContentPort(
      fetcher as unknown as typeof fetch,
    );

    await expect(port.list(ids.event, 'sessions')).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
    await expect(port.list(ids.event, 'sessions')).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
    await expect(
      port.save({
        body: { name: 'Partner', slug: 'partner', sortOrder: 0 },
        eventId: ids.event,
        resource: 'partners',
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
    await expect(
      port.publish(ids.event, {
        checksumSha256: checksum,
        createdAt: '2026-07-26T10:00:00.000Z',
        expectedPreviousVersion: 5,
        itemCount: 8,
        requestId: 'admin-content-test-0001',
        significantSessionIds: [],
        summary: emptyPublicationSummary,
        version: 6,
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('rejects every successful response that omits its request correlation', async () => {
    const preview: AdminPublicationPreview = {
      checksumSha256: checksum,
      createdAt: '2026-07-26T10:00:00.000Z',
      expectedPreviousVersion: 0,
      itemCount: 0,
      requestId: 'admin-content-test-0001',
      significantSessionIds: [],
      summary: emptyPublicationSummary,
      version: 1,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ items: [sessionItem()], resource: 'sessions' }),
      )
      .mockResolvedValueOnce(response({ id: ids.item, status: 'created' }, 201))
      .mockResolvedValueOnce(
        response({
          checksumSha256: checksum,
          significantSessionIds: [],
          snapshot: publicationSnapshot,
          version: 1,
        }),
      )
      .mockResolvedValueOnce(
        response({ checksumSha256: checksum, version: 1 }, 201),
      );
    const port = createFetchAdminContentPort(
      fetcher as unknown as typeof fetch,
    );

    await expect(port.list(ids.event, 'sessions')).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
    await expect(
      port.save({
        body: { name: 'Partner', slug: 'partner', sortOrder: 0 },
        eventId: ids.event,
        resource: 'partners',
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
    await expect(port.previewPublication(ids.event)).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
    await expect(port.publish(ids.event, preview)).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('projects server body and content issues into actionable Czech field errors', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            code: 'INVALID_CONTENT_INPUT',
            fieldErrors: {
              body: ['slug: Invalid string', 'websiteUrl: Invalid URL'],
            },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(
        response(
          {
            code: 'CONTENT_VALIDATION_FAILED',
            fieldErrors: {
              content: ['room:time_collision', 'day:not_in_event'],
            },
          },
          409,
        ),
      );
    const port = createFetchAdminContentPort(
      fetcher as unknown as typeof fetch,
    );

    await expect(port.list(ids.event, 'partners')).resolves.toMatchObject({
      ok: false,
      failure: {
        fieldErrors: {
          slug: expect.stringContaining('malá písmena'),
          websiteUrl: expect.stringContaining('HTTP(S)'),
        },
        kind: 'validation',
      },
    });
    await expect(port.list(ids.event, 'sessions')).resolves.toMatchObject({
      ok: false,
      failure: {
        fieldErrors: {
          content: expect.stringMatching(/překrývá.*Vybraný den/s),
        },
        kind: 'conflict',
      },
    });
  });

  it.each([
    ['required title', { title: undefined }],
    ['timestamp', { startsAt: 'not-an-instant' }],
    ['session type', { type: 'unsupported' }],
    ['speaker reference', { speakerIds: ['not-a-uuid'] }],
    ['version', { version: undefined }],
  ])('rejects a session with an invalid %s', async (_label, override) => {
    const item: Record<string, unknown> = { ...sessionItem(), ...override };
    if ('title' in override && override.title === undefined) delete item.title;
    const port = createFetchAdminContentPort(
      vi.fn(async () =>
        response({
          resource: 'sessions',
          items: [item],
          requestId: 'admin-content-test-0001',
        }),
      ) as unknown as typeof fetch,
    );

    await expect(port.list(ids.event, 'sessions')).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('rejects a publication preview without the complete impact snapshot', async () => {
    const port = createFetchAdminContentPort(
      vi.fn(async () =>
        response({
          checksumSha256: checksum,
          requestId: 'admin-content-test-0001',
          significantSessionIds: [],
          snapshot: {
            program: { days: [], rooms: [], sessions: [] },
          },
          version: 1,
        }),
      ) as unknown as typeof fetch,
    );

    await expect(port.previewPublication(ids.event)).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('rejects a valid publication snapshot correlated to another event', async () => {
    const port = createFetchAdminContentPort(
      vi.fn(async () =>
        response({
          checksumSha256: checksum,
          requestId: 'admin-content-test-0001',
          significantSessionIds: [],
          snapshot: {
            ...publicationSnapshot,
            event: {
              ...publicationSnapshot.event,
              id: ids.foreignEvent,
            },
          },
          version: 1,
        }),
      ) as unknown as typeof fetch,
    );

    await expect(port.previewPublication(ids.event)).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('distinguishes aborted and ambiguous transport failures', async () => {
    const aborted = createFetchAdminContentPort(
      vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError');
      }) as unknown as typeof fetch,
    );
    const transport = createFetchAdminContentPort(
      vi.fn(async () => {
        throw new TypeError('network failed');
      }) as unknown as typeof fetch,
    );

    await expect(aborted.list(ids.event, 'sessions')).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'aborted' },
    });
    await expect(transport.list(ids.event, 'sessions')).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'transport' },
    });
  });
});
