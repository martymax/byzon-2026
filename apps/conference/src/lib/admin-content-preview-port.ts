import {
  publishedContentSnapshotSchema,
  publishedProgramSnapshotSchema,
  type AdminPublicationChange,
} from '@byzon/domain/contracts';

import {
  adminContentResources,
  parseAdminContentItems,
  type AdminContentFailure,
  type AdminContentItem,
  type AdminContentMutation,
  type AdminContentPort,
  type AdminContentResource,
  type AdminContentResult,
  type AdminPublicationPreview,
} from './admin-content-api';

export const ADMIN_CONTENT_PREVIEW_BOUNDARY_MARKER =
  'BYZON_ADMIN_CONTENT_PREVIEW_F4';

export type AdminContentPreviewMode =
  | 'ready'
  | 'max_page'
  | 'empty'
  | 'archived'
  | 'offline'
  | 'permission'
  | 'session_expired'
  | 'stale'
  | 'conflict';

export const isAdminContentPreviewReadOnly = (
  mode: AdminContentPreviewMode,
): boolean => mode === 'archived';

export interface AdminContentPreviewPort extends AdminContentPort {
  readonly setMode: (mode: AdminContentPreviewMode) => void;
}

const ids = {
  day: '019fc400-0000-7000-8000-000000000001',
  venue: '019fc400-0000-7000-8000-000000000002',
  room: '019fc400-0000-7000-8000-000000000003',
  session: '019fc400-0000-7000-8000-000000000004',
  speaker: '019fc400-0000-7000-8000-000000000005',
  partner: '019fc400-0000-7000-8000-000000000006',
  page: '019fc400-0000-7000-8000-000000000007',
  faq: '019fc400-0000-7000-8000-000000000008',
} as const;

const initialContent = (
  eventId: string,
): Record<AdminContentResource, AdminContentItem[]> => ({
  days: [
    {
      id: ids.day,
      eventId,
      localDate: '2026-09-18',
      sortOrder: 0,
      title: 'Pátek',
    },
  ],
  venues: [
    {
      id: ids.venue,
      eventId,
      mapQuery: 'Clarion Congress Hotel České Budějovice',
      name: 'Clarion Congress Hotel',
      navigationMarkdown: 'Vstup hlavním vchodem z Pražské třídy.',
      slug: 'clarion',
      sortOrder: 0,
      status: 'published',
      version: 1,
    },
  ],
  rooms: [
    {
      capacity: 320,
      id: ids.room,
      eventId,
      name: 'Main Stage',
      slug: 'main-stage',
      sortOrder: 0,
      status: 'published',
      venueId: ids.venue,
      version: 1,
    },
  ],
  sessions: [
    {
      dayId: ids.day,
      description: 'Syntetický detail úvodního bodu programu.',
      endsAt: '2026-09-18T08:00:00.000Z',
      id: ids.session,
      eventId,
      roomId: ids.room,
      slug: 'otevreni-konference',
      sortOrder: 0,
      speakerIds: [ids.speaker],
      startsAt: '2026-09-18T07:00:00.000Z',
      status: 'published',
      summary: 'Společné zahájení programu.',
      title: 'Otevření konference',
      type: 'talk',
      version: 1,
    },
  ],
  speakers: [
    {
      bioMarkdown: 'Syntetický profil pro bezpečný frontendový průchod.',
      company: 'Example.test',
      firstName: 'Alex',
      id: ids.speaker,
      eventId,
      jobTitle: 'Průvodce programem',
      lastName: 'Novák',
      linkedinUrl: null,
      slug: 'alex-novak',
      sortOrder: 0,
      status: 'published',
      version: 1,
      websiteUrl: null,
    },
  ],
  partners: [
    {
      category: 'Hlavní partner',
      descriptionMarkdown: 'Syntetický partner bez produkčních údajů.',
      id: ids.partner,
      eventId,
      name: 'Partner Example',
      slug: 'partner-example',
      sortOrder: 0,
      status: 'published',
      tier: 'gold',
      version: 1,
      websiteUrl: 'https://example.test/',
    },
  ],
  pages: [
    {
      bodyMarkdown: 'Registrace se otevírá v pátek v 8:00.',
      id: ids.page,
      eventId,
      kind: 'practical',
      slug: 'registrace',
      sortOrder: 0,
      status: 'published',
      summary: 'Kde a kdy se registrovat.',
      title: 'Registrace na místě',
      version: 1,
    },
  ],
  faqs: [
    {
      answerMarkdown: 'Ano, šatna je v přízemí hotelu.',
      category: 'Na místě',
      id: ids.faq,
      eventId,
      question: 'Je k dispozici šatna?',
      sortOrder: 0,
      status: 'published',
      version: 1,
    },
  ],
});

const clone = <Value>(value: Value): Value => structuredClone(value);
const previewItemTitle = (item: AdminContentItem): string =>
  item.firstName && item.lastName
    ? `${String(item.firstName)} ${String(item.lastName)}`
    : String(
        item.title ?? item.name ?? item.question ?? item.localDate ?? 'Obsah',
      );
const previewChangeImpact = (
  resource: AdminContentResource,
  body: Readonly<Record<string, unknown>>,
  current: AdminContentItem,
): AdminPublicationChange['impact'] => {
  if (resource !== 'sessions') return ['content'];
  const impact: AdminPublicationChange['impact'][number][] = [];
  if (body.startsAt !== current.startsAt || body.endsAt !== current.endsAt) {
    impact.push('time');
  }
  if (body.roomId !== current.roomId) impact.push('location');
  if (body.status !== current.status) impact.push('status');
  return impact.length ? impact : ['content'];
};
const success = <Value>(data: Value): AdminContentResult<Value> => ({
  ok: true,
  data: clone(data),
});
const failure = (
  kind: AdminContentFailure['kind'],
  message: string,
  fieldErrors?: Readonly<Record<string, string>>,
): AdminContentResult<never> => ({
  ok: false,
  failure: { kind, message, ...(fieldErrors ? { fieldErrors } : {}) },
});

const modeFailure = (
  mode: AdminContentPreviewMode,
  operation: 'read' | 'write',
): AdminContentResult<never> | null => {
  if (mode === 'offline') {
    return failure(
      'offline',
      'Syntetické připojení je offline. Soukromý obsah byl odstraněn.',
    );
  }
  if (mode === 'permission') {
    return failure(
      'permission',
      'Syntetické oprávnění program:manage bylo odebráno.',
    );
  }
  if (mode === 'session_expired') {
    return failure(
      'session_expired',
      'Syntetická relace vypršela. Je nutné znovu načíst kontext.',
    );
  }
  if (operation === 'write' && mode === 'stale') {
    return failure(
      'stale',
      'Syntetický obsah se mezitím změnil. Načtěte aktuální stav.',
    );
  }
  if (operation === 'write' && mode === 'conflict') {
    return failure('conflict', 'Syntetická změna koliduje s programem.', {
      content: 'Časy bodu se překrývají s jiným programem ve stejné místnosti.',
    });
  }
  if (operation === 'write' && mode === 'archived') {
    return failure(
      'conflict',
      'Archivovaná akce je autoritativně pouze ke čtení.',
      { content: 'Archivovanou akci nelze měnit ani publikovat.' },
    );
  }
  return null;
};

const safeSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const maximumLengths: Record<
  AdminContentResource,
  Readonly<Record<string, number>>
> = {
  days: { description: 8_192, title: 256 },
  venues: { mapQuery: 1_024, name: 256, navigationMarkdown: 65_536 },
  rooms: { description: 8_192, name: 256 },
  sessions: { description: 65_536, summary: 2_048, title: 512 },
  speakers: {
    bioMarkdown: 65_536,
    company: 256,
    firstName: 128,
    jobTitle: 256,
    lastName: 128,
  },
  partners: {
    category: 128,
    descriptionMarkdown: 65_536,
    name: 256,
    tier: 128,
  },
  pages: { bodyMarkdown: 65_536, summary: 2_048, title: 256 },
  faqs: { answerMarkdown: 65_536, category: 128, question: 1_024 },
};

const validateBody = (
  resource: AdminContentResource,
  body: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> => {
  const errors: Record<string, string> = {};
  const text = (field: string) =>
    typeof body[field] === 'string' ? body[field].trim() : '';
  const slug = text('slug');
  if (
    resource !== 'days' &&
    resource !== 'faqs' &&
    (!slug || !safeSlug.test(slug))
  ) {
    errors.slug = 'Slug musí obsahovat pouze malá písmena, číslice a pomlčky.';
  }
  const title =
    text('title') ||
    text('name') ||
    text('question') ||
    (text('firstName') && text('lastName')) ||
    text('localDate');
  if (!title) errors.title = 'Vyplňte povinný název nebo otázku.';
  Object.entries(maximumLengths[resource]).forEach(([field, maximum]) => {
    if (typeof body[field] === 'string' && body[field].length > maximum) {
      errors[field] = `Hodnota smí mít nejvýše ${maximum} znaků.`;
    }
  });
  if (resource === 'sessions') {
    const startsAt = Date.parse(text('startsAt'));
    const endsAt = Date.parse(text('endsAt'));
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
      errors.startsAt = 'Vyplňte platný začátek a konec.';
    } else if (endsAt <= startsAt) {
      errors.endsAt = 'Konec musí následovat po začátku.';
    }
  }
  for (const field of ['websiteUrl', 'linkedinUrl'] as const) {
    const value = text(field);
    if (!value) continue;
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        value.length > 2_048
      ) {
        errors[field] =
          'Použijte HTTPS adresu bez přihlašovacích údajů (max. 2048 znaků).';
      }
    } catch {
      errors[field] = 'Zadejte platnou URL.';
    }
  }
  return errors;
};

const publicationSnapshot = (
  eventId: string,
  content: Record<AdminContentResource, AdminContentItem[]>,
) => ({
  event: {
    endsAt: '2026-09-20T18:00:00.000Z',
    id: eventId,
    name: 'BYZON 2026',
    slug: 'byzon-2026',
    startsAt: '2026-09-18T06:00:00.000Z',
    timezone: 'Europe/Prague',
  },
  partners: content.partners
    .filter((partner) => partner.status !== 'archived')
    .map((partner) => ({
      ...partner,
      category: partner.category ?? null,
      descriptionMarkdown: partner.descriptionMarkdown ?? null,
      logoAssetId: null,
      status: 'published',
      tier: partner.tier ?? null,
      websiteUrl: partner.websiteUrl ?? null,
    })),
  practical: {
    faqs: content.faqs
      .filter((faq) => faq.status !== 'archived')
      .map((faq) => ({
        ...faq,
        category: faq.category ?? null,
        status: 'published',
      })),
    pages: content.pages
      .filter((page) => page.status !== 'archived')
      .map((page) => ({
        ...page,
        status: 'published',
        summary: page.summary ?? null,
      })),
  },
  program: {
    days: content.days,
    rooms: content.rooms.filter((room) => room.status !== 'archived'),
    sessions: content.sessions
      .filter((session) => session.status !== 'archived')
      .map((session) => ({
        ...session,
        roomId: session.roomId ?? null,
        status: session.status === 'cancelled' ? 'cancelled' : 'published',
      })),
  },
  speakers: content.speakers
    .filter((speaker) => speaker.status !== 'archived')
    .map((speaker) => ({
      ...speaker,
      bioMarkdown: speaker.bioMarkdown ?? null,
      company: speaker.company ?? null,
      jobTitle: speaker.jobTitle ?? null,
      linkedinUrl: speaker.linkedinUrl ?? null,
      photoAssetId: null,
      status: 'published',
      websiteUrl: speaker.websiteUrl ?? null,
    })),
  venues: content.venues
    .filter((venue) => venue.status !== 'archived')
    .map((venue) => ({
      ...venue,
      accessibilityMarkdown: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      countryCode: null,
      mapQuery: venue.mapQuery ?? null,
      navigationMarkdown: venue.navigationMarkdown ?? null,
      postalCode: null,
      status: 'published',
    })),
});

const withoutVersion = (
  body: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const next = { ...body };
  delete next.eventId;
  delete next.id;
  delete next.version;
  return next;
};

export const createAdminContentPreviewPort = ({
  eventId,
}: {
  readonly eventId: string;
}): AdminContentPreviewPort => {
  const content = initialContent(eventId);
  let mode: AdminContentPreviewMode = 'ready';
  let serial = 20;
  let contentRevision = 1;
  let publishedVersion = 0;
  let publishedChecksum: string | null = null;
  let lastPublishedAt: string | null = null;
  const significantSessionIds = new Set<string>();
  const pendingChanges = new Map<string, AdminPublicationChange>();
  let preview:
    (AdminPublicationPreview & { readonly sourceRevision: number }) | null =
    null;

  const eventAllowed = (candidate: string): AdminContentResult<never> | null =>
    candidate === eventId
      ? null
      : failure('permission', 'Syntetický event scope se neshoduje.');

  const writeGuard = (candidate: string): AdminContentResult<never> | null =>
    eventAllowed(candidate) ?? modeFailure(mode, 'write');

  const changed = () => {
    contentRevision += 1;
  };

  return {
    setMode: (nextMode) => {
      if (nextMode === 'max_page' && mode !== 'max_page') {
        const base =
          content.sessions[0] ?? initialContent(eventId).sessions[0]!;
        content.sessions.splice(
          0,
          content.sessions.length,
          ...Array.from({ length: 50 }, (_, index) => {
            const serial = index + 1;
            return {
              ...base,
              id: `019fc400-0001-7000-8000-${String(serial).padStart(12, '0')}`,
              slug: `maximalni-testovaci-aktivita-${serial}`,
              sortOrder: index,
              title: `Maximální testovací aktivita ${String(serial).padStart(2, '0')}`,
            };
          }),
        );
        changed();
      }
      if (nextMode === 'empty' && mode !== 'empty') {
        adminContentResources.forEach((resource) => {
          content[resource].splice(0);
        });
        changed();
      }
      mode = nextMode;
      preview = null;
    },
    list: async (candidateEventId, resource, signal) => {
      if (signal?.aborted) return failure('aborted', 'Požadavek byl zrušen.');
      const blocked =
        eventAllowed(candidateEventId) ?? modeFailure(mode, 'read');
      if (blocked) return blocked;
      const parsed = parseAdminContentItems(
        eventId,
        resource,
        content[resource],
      );
      if (!parsed.ok) return parsed;
      return success({
        resource,
        items: parsed.data,
        requestId: `preview-content-list-${resource}`,
      });
    },
    save: async ({ body, eventId: candidateEventId, id, resource, signal }) => {
      if (signal?.aborted) return failure('aborted', 'Požadavek byl zrušen.');
      const blocked = writeGuard(candidateEventId);
      if (blocked) return blocked;
      const fieldErrors = validateBody(resource, body);
      if (Object.keys(fieldErrors).length) {
        return failure(
          'validation',
          'Zkontrolujte označená pole.',
          fieldErrors,
        );
      }
      const slug = typeof body.slug === 'string' ? body.slug : undefined;
      const duplicate = slug
        ? content[resource].find((item) => item.id !== id && item.slug === slug)
        : undefined;
      if (duplicate) {
        return failure('conflict', 'Slug už používá jiná položka.', {
          slug: 'Zvolte jedinečný slug.',
        });
      }
      if (resource === 'days') {
        const duplicateDay = content.days.find(
          (item) =>
            item.id !== id &&
            (item.localDate === body.localDate ||
              item.sortOrder === body.sortOrder),
        );
        if (duplicateDay) {
          return failure(
            'conflict',
            'Den se stejným datem nebo pořadím už existuje.',
            {
              ...(duplicateDay.localDate === body.localDate
                ? { localDate: 'Zvolte jedinečné datum dne.' }
                : {}),
              ...(duplicateDay.sortOrder === body.sortOrder
                ? { sortOrder: 'Zvolte jedinečné pořadí dne.' }
                : {}),
            },
          );
        }
      }
      if (id) {
        const index = content[resource].findIndex((item) => item.id === id);
        const current = content[resource][index];
        if (!current) return failure('not_found', 'Položka už neexistuje.');
        if (
          resource !== 'days' &&
          (typeof body.version !== 'number' || body.version !== current.version)
        ) {
          return failure(
            'stale',
            'Verze položky se změnila. Načtěte aktuální stav.',
          );
        }
        if (
          resource === 'sessions' &&
          ['startsAt', 'endsAt', 'roomId', 'status'].some(
            (field) =>
              Object.hasOwn(body, field) && body[field] !== current[field],
          )
        ) {
          significantSessionIds.add(id);
        }
        if (
          resource === 'rooms' &&
          ['name', 'venueId'].some(
            (field) =>
              Object.hasOwn(body, field) && body[field] !== current[field],
          )
        ) {
          content.sessions
            .filter((session) => session.roomId === id)
            .forEach((session) => significantSessionIds.add(session.id));
        }
        content[resource][index] =
          resource === 'days'
            ? {
                ...current,
                ...withoutVersion(body),
                id,
              }
            : {
                ...current,
                ...withoutVersion(body),
                id,
                version: (current.version ?? 0) + 1,
              };
        pendingChanges.set(`${resource}:${id}`, {
          kind:
            resource === 'sessions' && body.status === 'cancelled'
              ? 'cancelled'
              : 'updated',
          resource,
          title: previewItemTitle(content[resource][index]!),
          impact: previewChangeImpact(resource, body, current),
        });
        changed();
        return success({
          id,
          status: 'updated',
          requestId: 'preview-content-updated',
        } satisfies AdminContentMutation);
      }
      serial += 1;
      const createdId = `019fc400-0000-7000-8000-${String(serial).padStart(12, '0')}`;
      content[resource].push({
        ...withoutVersion(body),
        eventId,
        id: createdId,
        ...(resource === 'days' ? {} : { version: 1 }),
      });
      pendingChanges.set(`${resource}:${createdId}`, {
        kind: 'added',
        resource,
        title: previewItemTitle(content[resource].at(-1)!),
        impact: ['content'],
      });
      changed();
      return success({
        id: createdId,
        status: 'created',
        requestId: 'preview-content-created',
      } satisfies AdminContentMutation);
    },
    archive: async ({
      eventId: candidateEventId,
      id,
      resource,
      signal,
      version,
    }) => {
      if (signal?.aborted) return failure('aborted', 'Požadavek byl zrušen.');
      const blocked = writeGuard(candidateEventId);
      if (blocked) return blocked;
      const index = content[resource].findIndex((item) => item.id === id);
      const current = content[resource][index];
      if (!current) return failure('not_found', 'Položka už neexistuje.');
      if (
        resource === 'days' &&
        content.sessions.some((session) => session.dayId === id)
      ) {
        return failure(
          'conflict',
          'Den používá existující program a nelze jej trvale smazat.',
          {
            content:
              'Nejdřív přesuňte nebo odstraňte všechny navázané body programu.',
          },
        );
      }
      if (
        resource !== 'days' &&
        (version === undefined || version !== current.version)
      ) {
        return failure(
          'stale',
          'Verze položky se změnila. Archivaci zkontrolujte znovu.',
        );
      }
      if (resource === 'days') {
        content.days.splice(index, 1);
      } else {
        content[resource][index] = {
          ...current,
          status: 'archived',
          version: (current.version ?? 0) + 1,
        };
      }
      if (resource === 'sessions') significantSessionIds.add(id);
      pendingChanges.set(`${resource}:${id}`, {
        kind: 'archived',
        resource,
        title: previewItemTitle(current),
        impact: ['status'],
      });
      changed();
      return success({
        id,
        status: 'archived',
        requestId: 'preview-content-archived',
      } satisfies AdminContentMutation);
    },
    previewPublication: async (candidateEventId, signal) => {
      if (signal?.aborted) return failure('aborted', 'Požadavek byl zrušen.');
      const blocked =
        eventAllowed(candidateEventId) ?? modeFailure(mode, 'read');
      if (blocked) return blocked;
      if (
        content.days.length === 0 ||
        !content.sessions.some((session) => session.status !== 'archived')
      ) {
        return failure('validation', 'Obsah zatím nelze publikovat.', {
          content: 'Publikace vyžaduje alespoň jeden den a jeden bod programu.',
        });
      }
      const publishable = publishedProgramSnapshotSchema
        .and(publishedContentSnapshotSchema)
        .safeParse(publicationSnapshot(eventId, content));
      if (!publishable.success) {
        return failure('validation', 'Draft nesplňuje publikační kontrakt.', {
          content: publishable.error.issues
            .map(({ path, message }) => `${path.join('.')}: ${message}`)
            .join(' '),
        });
      }
      const itemCount = Object.values(content)
        .flat()
        .filter((item) => item.status !== 'archived').length;
      const checksumSha256 = contentRevision.toString(16).padStart(64, '0');
      if (publishedChecksum === checksumSha256) {
        return failure(
          'validation',
          'Aktuální draft je shodný s poslední publikovanou verzí.',
          { content: 'Bez změny obsahu nelze vytvořit další verzi.' },
        );
      }
      const changes =
        publishedVersion === 0
          ? adminContentResources.flatMap((resource) =>
              content[resource]
                .filter((item) => item.status !== 'archived')
                .map((item): AdminPublicationChange => ({
                  kind: 'added',
                  resource,
                  title: previewItemTitle(item),
                  impact: ['content'],
                })),
            )
          : [...pendingChanges.values()];
      preview = {
        checksumSha256,
        createdAt: '2026-07-26T08:00:00.000+02:00',
        expectedPreviousVersion: publishedVersion,
        itemCount,
        requestId: 'preview-content-publication',
        significantSessionIds: [...significantSessionIds].sort(),
        summary: {
          available: true,
          changeCount: changes.length,
          changes,
          previousPublication:
            publishedVersion > 0 && lastPublishedAt
              ? { version: publishedVersion, publishedAt: lastPublishedAt }
              : null,
        },
        sourceRevision: contentRevision,
        version: publishedVersion + 1,
      };
      return success(preview);
    },
    publish: async (candidateEventId, candidate, signal) => {
      if (signal?.aborted) return failure('aborted', 'Požadavek byl zrušen.');
      const blocked = writeGuard(candidateEventId);
      if (blocked) return blocked;
      if (publishedChecksum === candidate.checksumSha256) {
        return failure('validation', 'Aktuální draft už byl publikován.', {
          content: 'Beze změny obsahu nelze publikovat další verzi.',
        });
      }
      if (
        !preview ||
        preview.sourceRevision !== contentRevision ||
        preview.checksumSha256 !== candidate.checksumSha256 ||
        preview.version !== candidate.version ||
        preview.expectedPreviousVersion !== candidate.expectedPreviousVersion
      ) {
        return failure(
          'stale',
          'Draft se po vytvoření preview změnil. Vytvořte nové preview.',
        );
      }
      publishedVersion = preview.version;
      publishedChecksum = preview.checksumSha256;
      lastPublishedAt = '2026-07-26T08:05:00.000+02:00';
      const result = {
        checksumSha256: preview.checksumSha256,
        publishedAt: lastPublishedAt,
        requestId: 'preview-content-published',
        version: publishedVersion,
      };
      preview = null;
      significantSessionIds.clear();
      pendingChanges.clear();
      return success(result);
    },
  };
};
