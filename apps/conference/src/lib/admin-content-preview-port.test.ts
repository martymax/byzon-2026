import { describe, expect, it } from 'vitest';

import {
  adminContentResources,
  type AdminContentItem,
  type AdminContentResource,
} from './admin-content-api';
import {
  createAdminContentPreviewPort,
  isAdminContentPreviewReadOnly,
} from './admin-content-preview-port';

const eventId = '019fc600-0000-7000-8000-000000000001';
const foreignEventId = '019fc600-0000-7000-8000-000000000002';

const initialItems = async (
  port: ReturnType<typeof createAdminContentPreviewPort>,
) => {
  const entries = await Promise.all(
    adminContentResources.map(async (resource) => {
      const result = await port.list(eventId, resource);
      if (!result.ok) throw new Error(result.failure.message);
      return [resource, result.data.items[0]!] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<
    AdminContentResource,
    AdminContentItem
  >;
};

const validBodies = (
  items: Record<AdminContentResource, AdminContentItem>,
): Record<AdminContentResource, Record<string, unknown>> => ({
  days: {
    localDate: '2026-09-19',
    sortOrder: 1,
    title: 'Sobota',
  },
  venues: {
    mapQuery: null,
    name: 'Druhé syntetické místo',
    navigationMarkdown: null,
    slug: 'druhe-misto',
    sortOrder: 1,
    status: 'draft',
  },
  rooms: {
    capacity: 80,
    name: 'Workshop room',
    slug: 'workshop-room',
    sortOrder: 1,
    status: 'draft',
    venueId: items.venues.id,
  },
  sessions: {
    dayId: items.days.id,
    description: 'Detail syntetického bodu.',
    endsAt: '2026-09-18T10:00:00.000Z',
    roomId: items.rooms.id,
    slug: 'druhy-bod',
    sortOrder: 1,
    speakerIds: [items.speakers.id],
    startsAt: '2026-09-18T09:00:00.000Z',
    status: 'draft',
    summary: 'Shrnutí syntetického bodu.',
    title: 'Druhý bod programu',
    type: 'workshop',
  },
  speakers: {
    bioMarkdown: 'Syntetický profil.',
    company: 'Example.test',
    firstName: 'Dana',
    jobTitle: 'Facilitátorka',
    lastName: 'Nová',
    linkedinUrl: null,
    slug: 'dana-nova',
    sortOrder: 1,
    status: 'draft',
    websiteUrl: 'https://example.test/dana',
  },
  partners: {
    category: 'Partner',
    descriptionMarkdown: 'Syntetický partner.',
    name: 'Druhý partner',
    slug: 'druhy-partner',
    sortOrder: 1,
    status: 'draft',
    tier: 'silver',
    websiteUrl: 'https://example.test/partner',
  },
  pages: {
    bodyMarkdown: 'Syntetický obsah stránky.',
    kind: 'practical',
    slug: 'druha-stranka',
    sortOrder: 1,
    status: 'draft',
    summary: 'Krátké shrnutí.',
    title: 'Druhá stránka',
  },
  faqs: {
    answerMarkdown: 'Syntetická odpověď.',
    category: 'Obecné',
    question: 'Druhá otázka?',
    sortOrder: 1,
    status: 'draft',
  },
});

describe('stateful admin content preview port', () => {
  it('lists, creates, updates and archives every supported content resource', async () => {
    const port = createAdminContentPreviewPort({ eventId });
    const initial = await initialItems(port);
    const bodies = validBodies(initial);
    expect(initial.days).not.toHaveProperty('version');

    for (const resource of adminContentResources) {
      const existing = initial[resource];
      expect(existing.eventId).toBe(eventId);
      const created = await port.save({
        body: bodies[resource],
        eventId,
        resource,
      });
      expect(created).toMatchObject({
        ok: true,
        data: { status: 'created' },
      });
      if (!created.ok) continue;

      const updated = await port.save({
        body: {
          ...bodies[resource],
          sortOrder: 2,
          ...(resource === 'days' ? {} : { version: 1 }),
        },
        eventId,
        id: created.data.id,
        resource,
      });
      expect(updated).toMatchObject({
        ok: true,
        data: { id: created.data.id, status: 'updated' },
      });

      const archived = await port.archive({
        eventId,
        id: created.data.id,
        resource,
        ...(resource === 'days' ? {} : { version: 2 }),
      });
      expect(archived).toMatchObject({
        ok: true,
        data: {
          id: created.data.id,
          status: 'archived',
        },
      });

      const after = await port.list(eventId, resource);
      expect(after.ok).toBe(true);
      if (!after.ok) continue;
      expect(after.data.items.every((item) => item.eventId === eventId)).toBe(
        true,
      );
      const archivedItem = after.data.items.find(
        (item) => item.id === created.data.id,
      );
      if (resource === 'days') {
        expect(archivedItem).toBeUndefined();
      } else {
        expect(archivedItem).toMatchObject({
          status: 'archived',
          version: 3,
        });
      }
    }
  });

  it('returns deterministic validation, duplicate, stale and conflict failures', async () => {
    const port = createAdminContentPreviewPort({ eventId });
    const initial = await initialItems(port);
    const bodies = validBodies(initial);

    await expect(
      port.save({
        body: {
          name: '',
          slug: 'Neplatný Slug',
          sortOrder: 0,
          websiteUrl: 'javascript:alert(1)',
        },
        eventId,
        resource: 'partners',
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        fieldErrors: {
          slug: expect.any(String),
          title: expect.any(String),
          websiteUrl: expect.any(String),
        },
        kind: 'validation',
      },
    });
    await expect(
      port.save({
        body: {
          ...bodies.partners,
          slug: String(initial.partners.slug),
        },
        eventId,
        resource: 'partners',
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { fieldErrors: { slug: expect.any(String) }, kind: 'conflict' },
    });
    await expect(
      port.save({
        body: { ...bodies.partners, version: 999 },
        eventId,
        id: initial.partners.id,
        resource: 'partners',
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'stale' },
    });
    await expect(
      port.archive({
        eventId,
        id: initial.days.id,
        resource: 'days',
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        fieldErrors: { content: expect.any(String) },
        kind: 'conflict',
      },
    });
    await expect(
      port.save({
        body: {
          localDate: String(initial.days.localDate),
          sortOrder: Number(initial.days.sortOrder),
          title: 'Duplicitní den',
        },
        eventId,
        resource: 'days',
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        fieldErrors: {
          localDate: expect.any(String),
          sortOrder: expect.any(String),
        },
        kind: 'conflict',
      },
    });

    port.setMode('conflict');
    await expect(
      port.save({
        body: bodies.sessions,
        eventId,
        resource: 'sessions',
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        fieldErrors: { content: expect.any(String) },
        kind: 'conflict',
      },
    });
    port.setMode('stale');
    await expect(
      port.archive({
        eventId,
        id: initial.partners.id,
        resource: 'partners',
        version: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'stale' },
    });
  });

  it('never lets open mutation bodies replace row identity or event scope', async () => {
    const port = createAdminContentPreviewPort({ eventId });
    const initial = await initialItems(port);
    const injectedId = '019fc600-0000-7000-8000-000000000099';
    const created = await port.save({
      body: {
        ...validBodies(initial).partners,
        eventId: foreignEventId,
        id: injectedId,
      },
      eventId,
      resource: 'partners',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.id).not.toBe(injectedId);

    await expect(port.list(eventId, 'partners')).resolves.toMatchObject({
      ok: true,
      data: {
        items: expect.arrayContaining([
          expect.objectContaining({
            eventId,
            id: created.data.id,
            name: 'Druhý partner',
          }),
        ]),
      },
    });
  });

  it.each([
    ['offline', 'offline'],
    ['permission', 'permission'],
    ['session_expired', 'session_expired'],
  ] as const)('exposes the %s safe-wipe read state', async (mode, kind) => {
    const port = createAdminContentPreviewPort({ eventId });
    port.setMode(mode);

    await expect(port.list(eventId, 'sessions')).resolves.toMatchObject({
      ok: false,
      failure: { kind },
    });
  });

  it('supports empty, event-scope and aborted states without leaking content', async () => {
    const port = createAdminContentPreviewPort({ eventId });
    port.setMode('empty');
    await expect(port.list(eventId, 'sessions')).resolves.toMatchObject({
      ok: true,
      data: { items: [] },
    });
    await expect(port.previewPublication(eventId)).resolves.toMatchObject({
      ok: false,
      failure: {
        fieldErrors: { content: expect.any(String) },
        kind: 'validation',
      },
    });
    await expect(
      port.save({
        body: {
          name: 'První partner',
          slug: 'prvni-partner',
          sortOrder: 0,
          status: 'draft',
          websiteUrl: 'https://example.test/partner',
        },
        eventId,
        resource: 'partners',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(port.list(eventId, 'partners')).resolves.toMatchObject({
      ok: true,
      data: { items: [{ name: 'První partner' }] },
    });

    await expect(port.list(foreignEventId, 'sessions')).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'permission' },
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      port.list(eventId, 'sessions', controller.signal),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'aborted' },
    });
  });

  it('keeps archived preview journeys read-only and excludes archived rows', async () => {
    const port = createAdminContentPreviewPort({ eventId });
    const initial = await initialItems(port);
    const partnerVersion = initial.partners.version;
    expect(partnerVersion).toBeTypeOf('number');
    if (partnerVersion === undefined) {
      throw new Error('Expected the seeded partner to be versioned.');
    }
    await expect(
      port.archive({
        eventId,
        id: initial.partners.id,
        resource: 'partners',
        version: partnerVersion,
      }),
    ).resolves.toMatchObject({ ok: true });
    const preview = await port.previewPublication(eventId);
    expect(preview).toMatchObject({ ok: true, data: { itemCount: 7 } });

    port.setMode('archived');
    expect(isAdminContentPreviewReadOnly('archived')).toBe(true);
    await expect(port.list(eventId, 'sessions')).resolves.toMatchObject({
      ok: true,
    });
    const archivedPreview = await port.previewPublication(eventId);
    expect(archivedPreview).toMatchObject({ ok: true });
    await expect(
      port.save({
        body: validBodies(initial).faqs,
        eventId,
        resource: 'faqs',
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'conflict' },
    });
    if (!archivedPreview.ok) return;
    await expect(
      port.publish(eventId, archivedPreview.data),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'conflict' },
    });
  });

  it('publishes only an unchanged immutable preview', async () => {
    const port = createAdminContentPreviewPort({ eventId });
    const initial = await initialItems(port);
    const firstPreview = await port.previewPublication(eventId);
    expect(firstPreview.ok).toBe(true);
    if (!firstPreview.ok) return;

    await expect(
      port.save({
        body: validBodies(initial).partners,
        eventId,
        resource: 'partners',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      port.publish(eventId, firstPreview.data),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'stale' },
    });

    const secondPreview = await port.previewPublication(eventId);
    expect(secondPreview.ok).toBe(true);
    if (!secondPreview.ok) return;
    expect(secondPreview.data.significantSessionIds).toEqual([]);
    await expect(
      port.publish(eventId, secondPreview.data),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        checksumSha256: secondPreview.data.checksumSha256,
        version: secondPreview.data.version,
      },
    });
    await expect(
      port.publish(eventId, secondPreview.data),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'validation' },
    });
    await expect(port.previewPublication(eventId)).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'validation' },
    });
  });

  it('reports significant impact only for production-relevant program changes', async () => {
    const port = createAdminContentPreviewPort({ eventId });
    const initial = await initialItems(port);
    const bodies = validBodies(initial);

    await port.save({
      body: bodies.faqs,
      eventId,
      resource: 'faqs',
    });
    const faqPreview = await port.previewPublication(eventId);
    expect(faqPreview).toMatchObject({
      ok: true,
      data: { significantSessionIds: [] },
    });

    await port.save({
      body: { ...bodies.sessions, version: initial.sessions.version },
      eventId,
      id: initial.sessions.id,
      resource: 'sessions',
    });
    const sessionPreview = await port.previewPublication(eventId);
    expect(sessionPreview).toMatchObject({
      ok: true,
      data: { significantSessionIds: [initial.sessions.id] },
    });
  });
});
