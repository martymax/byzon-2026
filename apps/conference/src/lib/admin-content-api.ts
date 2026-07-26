import {
  publishedContentSnapshotSchema,
  publishedProgramSnapshotSchema,
} from '@byzon/domain/contracts';
import { z } from 'zod';

export const adminContentResources = [
  'days',
  'venues',
  'rooms',
  'sessions',
  'speakers',
  'partners',
  'pages',
  'faqs',
] as const;

export type AdminContentResource = (typeof adminContentResources)[number];

export interface AdminContentItem {
  readonly id: string;
  readonly version?: number;
  readonly [key: string]: unknown;
}

export interface AdminContentList {
  readonly items: readonly AdminContentItem[];
  readonly resource: AdminContentResource;
  readonly requestId: string;
}

export interface AdminContentMutation {
  readonly id: string;
  readonly status: 'created' | 'updated' | 'archived';
  readonly requestId: string;
}

export interface AdminPublicationPreview {
  readonly checksumSha256: string;
  readonly createdAt: string;
  readonly expectedPreviousVersion: number;
  readonly itemCount: number;
  readonly requestId: string;
  readonly significantSessionIds: readonly string[];
  readonly version: number;
}

export interface AdminPublicationResult {
  readonly checksumSha256: string;
  readonly requestId: string;
  readonly version: number;
}

export type AdminContentFailureKind =
  | 'aborted'
  | 'offline'
  | 'session_expired'
  | 'permission'
  | 'validation'
  | 'stale'
  | 'conflict'
  | 'not_found'
  | 'invalid_response'
  | 'transport'
  | 'server';

export interface AdminContentFailure {
  readonly fieldErrors?: Readonly<Record<string, string>>;
  readonly kind: AdminContentFailureKind;
  readonly message: string;
  readonly requestId?: string;
}

export type AdminContentResult<Value> =
  | { readonly ok: true; readonly data: Value }
  | { readonly ok: false; readonly failure: AdminContentFailure };

export interface AdminContentSaveInput {
  readonly body: Readonly<Record<string, unknown>>;
  readonly eventId: string;
  readonly id?: string;
  readonly resource: AdminContentResource;
  readonly signal?: AbortSignal;
}

export interface AdminContentArchiveInput {
  readonly eventId: string;
  readonly id: string;
  readonly resource: AdminContentResource;
  readonly signal?: AbortSignal;
  readonly version?: number;
}

export interface AdminContentPort {
  readonly archive: (
    input: AdminContentArchiveInput,
  ) => Promise<AdminContentResult<AdminContentMutation>>;
  readonly list: (
    eventId: string,
    resource: AdminContentResource,
    signal?: AbortSignal,
  ) => Promise<AdminContentResult<AdminContentList>>;
  readonly previewPublication: (
    eventId: string,
    signal?: AbortSignal,
  ) => Promise<AdminContentResult<AdminPublicationPreview>>;
  readonly publish: (
    eventId: string,
    preview: AdminPublicationPreview,
    signal?: AbortSignal,
  ) => Promise<AdminContentResult<AdminPublicationResult>>;
  readonly save: (
    input: AdminContentSaveInput,
  ) => Promise<AdminContentResult<AdminContentMutation>>;
}

const itemIdentity = {
  eventId: z.string().uuid(),
  id: z.string().uuid(),
  sortOrder: z.number().int().nonnegative(),
} as const;
const versionedItemBase = {
  ...itemIdentity,
  version: z.number().int().positive(),
} as const;
const itemText = z.string().trim().min(1).max(10_000);
const itemNullableText = z.string().nullable().optional();
const itemStatus = z.enum(['draft', 'published', 'archived']);
const itemSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(128);
const itemUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value))
  .nullable()
  .optional();
const resourceItemSchemas = {
  days: z
    .object({
      ...itemIdentity,
      description: itemNullableText,
      localDate: z.string().date(),
      title: itemText,
    })
    .strip(),
  venues: z
    .object({
      ...versionedItemBase,
      mapQuery: itemNullableText,
      name: itemText,
      navigationMarkdown: itemNullableText,
      slug: itemSlug,
      status: itemStatus,
    })
    .strip(),
  rooms: z
    .object({
      ...versionedItemBase,
      capacity: z.number().int().positive().nullable().optional(),
      description: itemNullableText,
      name: itemText,
      slug: itemSlug,
      status: itemStatus,
      venueId: z.string().uuid(),
    })
    .strip(),
  sessions: z
    .object({
      ...versionedItemBase,
      dayId: z.string().uuid(),
      description: itemNullableText,
      endsAt: z.string().datetime({ offset: true }),
      roomId: z.string().uuid().nullable().optional(),
      slug: itemSlug,
      speakerIds: z.array(z.string().uuid()).max(50),
      startsAt: z.string().datetime({ offset: true }),
      status: z.enum(['draft', 'published', 'cancelled', 'archived']),
      summary: itemNullableText,
      title: itemText,
      type: z.enum([
        'talk',
        'panel',
        'workshop',
        'mastermind',
        'coaching',
        'networking',
        'break',
        'meal',
        'gala',
        'other',
      ]),
    })
    .strip(),
  speakers: z
    .object({
      ...versionedItemBase,
      bioMarkdown: itemNullableText,
      company: itemNullableText,
      firstName: itemText,
      jobTitle: itemNullableText,
      lastName: itemText,
      linkedinUrl: itemUrl,
      slug: itemSlug,
      status: itemStatus,
      websiteUrl: itemUrl,
    })
    .strip(),
  partners: z
    .object({
      ...versionedItemBase,
      category: itemNullableText,
      descriptionMarkdown: itemNullableText,
      name: itemText,
      slug: itemSlug,
      status: itemStatus,
      tier: itemNullableText,
      websiteUrl: itemUrl,
    })
    .strip(),
  pages: z
    .object({
      ...versionedItemBase,
      bodyMarkdown: itemText,
      kind: z.enum(['practical', 'marketing', 'other']),
      slug: itemSlug,
      status: itemStatus,
      summary: itemNullableText,
      title: itemText,
    })
    .strip(),
  faqs: z
    .object({
      ...versionedItemBase,
      answerMarkdown: itemText,
      category: itemNullableText,
      question: itemText,
      status: itemStatus,
    })
    .strip(),
} satisfies Record<AdminContentResource, z.ZodType<AdminContentItem>>;

const listSchema = z
  .object({
    items: z.array(z.unknown()),
    requestId: z.string().min(1),
    resource: z.enum(adminContentResources),
  })
  .passthrough();

const mutationSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().min(1),
    status: z.enum(['created', 'updated', 'archived']),
  })
  .passthrough();

const publicationSnapshotSchema = publishedProgramSnapshotSchema.and(
  publishedContentSnapshotSchema,
);

const publicationPreviewSchema = z
  .object({
    checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
    requestId: z.string().min(1),
    significantSessionIds: z.array(z.string().uuid()),
    snapshot: publicationSnapshotSchema,
    version: z.number().int().positive(),
  })
  .passthrough();

const publicationResultSchema = z
  .object({
    checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
    requestId: z.string().min(1),
    version: z.number().int().positive(),
  })
  .passthrough();

interface ProblemLike {
  readonly code?: unknown;
  readonly detail?: unknown;
  readonly fieldErrors?: unknown;
  readonly requestId?: unknown;
}

const parseFieldErrors = (
  input: unknown,
): Readonly<Record<string, string>> | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const normalized: Record<string, string> = {};
  const append = (field: string, message: string) => {
    normalized[field] = normalized[field]
      ? `${normalized[field]} ${message}`
      : message;
  };
  const formField = (serverPath: string): string => {
    const root = serverPath.split('.')[0] ?? serverPath;
    if (
      root === 'name' ||
      root === 'question' ||
      root === 'firstName' ||
      root === 'lastName'
    ) {
      return 'title';
    }
    return root;
  };
  const invalidFieldMessage = (field: string): string => {
    if (field === 'slug') {
      return 'Slug je povinný a smí obsahovat jen malá písmena, číslice a pomlčky.';
    }
    if (field === 'startsAt' || field === 'endsAt') {
      return 'Zkontrolujte datum, čas a pořadí začátku a konce.';
    }
    if (field === 'websiteUrl' || field === 'linkedinUrl') {
      return 'Zadejte platnou HTTP(S) adresu.';
    }
    return 'Zkontrolujte povinnou hodnotu a její formát.';
  };
  const contentIssueMessage = (issue: string): string => {
    const known: Readonly<Record<string, string>> = {
      'day:not_in_event': 'Vybraný den nepatří do této akce.',
      'event:not_found': 'Akce už není dostupná.',
      'room:not_in_event': 'Vybraná místnost nepatří do této akce.',
      'room:time_collision':
        'Čas se překrývá s jiným bodem programu ve stejné místnosti.',
      'slug:duplicate': 'Slug už používá jiná položka.',
      'speakers:duplicate': 'Stejný řečník je vybraný vícekrát.',
      'speakers:not_in_event': 'Některý řečník nepatří do této akce.',
      'time:invalid_range': 'Konec musí následovat po začátku.',
      'time:outside_event_day':
        'Čas musí ležet ve vybraném dni a v rozsahu akce.',
      'venue:not_in_event': 'Vybrané místo nepatří do této akce.',
    };
    if (known[issue]) return known[issue];
    if (issue.startsWith('room_collision:')) {
      return 'Publikovaný program obsahuje překryv ve stejné místnosti.';
    }
    if (issue.startsWith('session:')) {
      return 'Některý bod programu nemá platný den, místnost, čas nebo slug.';
    }
    return `Obsah nesplňuje publikační pravidlo (${issue}).`;
  };

  Object.entries(input).forEach(([field, value]) => {
    const messages =
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === 'string')
          : [];
    if (field === 'body') {
      messages.forEach((message) => {
        const match = message.match(/^([^:]+):/);
        const target = formField(match?.[1]?.trim() || 'body');
        append(target, invalidFieldMessage(target));
      });
      return;
    }
    if (field === 'content') {
      messages.forEach((message) =>
        append('content', contentIssueMessage(message.trim())),
      );
      return;
    }
    messages
      .map((message) => message.trim())
      .filter(Boolean)
      .forEach((message) => append(formField(field), message));
  });
  return Object.keys(normalized).length ? normalized : undefined;
};

const responseProblem = async (response: Response): Promise<ProblemLike> => {
  try {
    const value: unknown = await response.clone().json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as ProblemLike)
      : {};
  } catch {
    return {};
  }
};

const problemFailure = async (
  response: Response,
): Promise<AdminContentFailure> => {
  const problem = await responseProblem(response);
  const code = typeof problem.code === 'string' ? problem.code : '';
  const requestId =
    typeof problem.requestId === 'string'
      ? problem.requestId
      : response.headers.get('x-request-id') || undefined;
  const detail =
    typeof problem.detail === 'string' && problem.detail.trim()
      ? problem.detail.trim()
      : undefined;
  const fieldErrors = parseFieldErrors(problem.fieldErrors);
  const withMetadata = (
    failure: Omit<AdminContentFailure, 'requestId' | 'fieldErrors'>,
  ): AdminContentFailure => ({
    ...failure,
    ...(fieldErrors ? { fieldErrors } : {}),
    ...(requestId ? { requestId } : {}),
  });

  if (response.status === 401) {
    return withMetadata({
      kind: 'session_expired',
      message: 'Relace vypršela. Obsah byl z rozhraní odstraněn.',
    });
  }
  if (
    response.status === 403 ||
    (response.status === 404 && code === 'CONTENT_NOT_FOUND')
  ) {
    return withMetadata({
      kind: 'permission',
      message: 'Oprávnění ke správě obsahu už není dostupné.',
    });
  }
  if (response.status === 404) {
    return withMetadata({
      kind: 'not_found',
      message: 'Položka už není dostupná. Načtěte aktuální stav.',
    });
  }
  if (
    response.status === 409 &&
    (code.includes('STALE') || code === 'STALE_CONTENT_VERSION')
  ) {
    return withMetadata({
      kind: 'stale',
      message: 'Obsah se mezitím změnil. Načtěte nový snapshot.',
    });
  }
  if (response.status === 409) {
    return withMetadata({
      kind: 'conflict',
      message:
        detail ??
        'Změna koliduje s aktuálním programem nebo navázaným obsahem.',
    });
  }
  if (response.status === 400 || response.status === 422) {
    return withMetadata({
      kind: 'validation',
      message: detail ?? 'Server odmítl neplatný obsah.',
    });
  }
  return withMetadata({
    kind: 'server',
    message: 'Obsahovou operaci se nepodařilo bezpečně dokončit.',
  });
};

const transportFailure = (error: unknown): AdminContentFailure => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { kind: 'aborted', message: 'Požadavek byl zrušen.' };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      kind: 'offline',
      message: 'Správa obsahu je online-only. Obnovte připojení.',
    };
  }
  return {
    kind: 'transport',
    message:
      'Server nepotvrdil výsledek. Před další změnou načtěte aktuální stav.',
  };
};

const invalidResponse = (): AdminContentResult<never> => ({
  ok: false,
  failure: {
    kind: 'invalid_response',
    message:
      'Server vrátil neplatný obsah. Rozhraní jej z bezpečnostních důvodů nepřevzalo.',
  },
});

export const parseAdminContentItems = (
  eventId: string,
  resource: AdminContentResource,
  input: unknown,
): AdminContentResult<readonly AdminContentItem[]> => {
  const items = z.array(resourceItemSchemas[resource]).safeParse(input);
  if (!items.success || items.data.some((item) => item.eventId !== eventId)) {
    return invalidResponse();
  }
  return { ok: true, data: items.data };
};

const snapshotItemCount = (snapshot: Record<string, unknown>): number => {
  const collectionSize = (
    parent: Record<string, unknown>,
    key: string,
  ): number => (Array.isArray(parent[key]) ? parent[key].length : 0);
  const program =
    snapshot.program &&
    typeof snapshot.program === 'object' &&
    !Array.isArray(snapshot.program)
      ? (snapshot.program as Record<string, unknown>)
      : {};
  const practical =
    snapshot.practical &&
    typeof snapshot.practical === 'object' &&
    !Array.isArray(snapshot.practical)
      ? (snapshot.practical as Record<string, unknown>)
      : {};
  return (
    collectionSize(program, 'days') +
    collectionSize(program, 'rooms') +
    collectionSize(program, 'sessions') +
    collectionSize(snapshot, 'speakers') +
    collectionSize(snapshot, 'partners') +
    collectionSize(snapshot, 'venues') +
    collectionSize(practical, 'pages') +
    collectionSize(practical, 'faqs')
  );
};

const readJson = async <Value>(
  response: Response,
  schema: z.ZodType<Value>,
): Promise<AdminContentResult<Value>> => {
  if (!response.ok)
    return { ok: false, failure: await problemFailure(response) };
  try {
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? { ok: true, data: parsed.data } : invalidResponse();
  } catch {
    return invalidResponse();
  }
};

export const createFetchAdminContentPort = (
  fetcher: typeof fetch = globalThis.fetch,
): AdminContentPort => {
  const request = async <Value>(
    path: string,
    schema: z.ZodType<Value>,
    init: RequestInit,
  ): Promise<AdminContentResult<Value>> => {
    try {
      return await readJson(
        await fetcher(path, {
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'error',
          ...init,
        }),
        schema,
      );
    } catch (error) {
      return { ok: false, failure: transportFailure(error) };
    }
  };

  return {
    list: async (eventId, resource, signal) => {
      const result = await request(
        `/api/v1/admin/events/${encodeURIComponent(eventId)}/content/${resource}`,
        listSchema,
        { method: 'GET', ...(signal ? { signal } : {}) },
      );
      if (!result.ok) return result;
      if (result.data.resource !== resource) {
        return invalidResponse();
      }
      const items = parseAdminContentItems(
        eventId,
        resource,
        result.data.items,
      );
      if (!items.ok) return items;
      return {
        ok: true,
        data: {
          ...result.data,
          items: items.data,
        },
      };
    },
    save: async ({ body, eventId, id, resource, signal }) => {
      const expectedStatus = id ? 'updated' : 'created';
      const result = await request(
        `/api/v1/admin/events/${encodeURIComponent(eventId)}/content/${resource}${
          id ? `/${encodeURIComponent(id)}` : ''
        }`,
        mutationSchema,
        {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
          method: id ? 'PATCH' : 'POST',
          ...(signal ? { signal } : {}),
        },
      );
      if (!result.ok) return result;
      if (
        result.data.status !== expectedStatus ||
        (id && result.data.id !== id)
      ) {
        return invalidResponse();
      }
      return result;
    },
    archive: async ({ eventId, id, resource, signal, version }) => {
      const result = await request(
        `/api/v1/admin/events/${encodeURIComponent(eventId)}/content/${resource}/${encodeURIComponent(id)}`,
        mutationSchema,
        {
          headers: version === undefined ? {} : { 'if-match': `"${version}"` },
          method: 'DELETE',
          ...(signal ? { signal } : {}),
        },
      );
      if (
        result.ok &&
        (result.data.status !== 'archived' || result.data.id !== id)
      ) {
        return invalidResponse();
      }
      return result;
    },
    previewPublication: async (eventId, signal) => {
      const result = await request(
        `/api/v1/admin/events/${encodeURIComponent(eventId)}/publication`,
        publicationPreviewSchema,
        { method: 'GET', ...(signal ? { signal } : {}) },
      );
      if (!result.ok) return result;
      if (result.data.snapshot.event.id !== eventId) {
        return invalidResponse();
      }
      return {
        ok: true,
        data: {
          checksumSha256: result.data.checksumSha256,
          createdAt: new Date().toISOString(),
          expectedPreviousVersion: result.data.version - 1,
          itemCount: snapshotItemCount(result.data.snapshot),
          requestId: result.data.requestId,
          significantSessionIds: result.data.significantSessionIds,
          version: result.data.version,
        },
      };
    },
    publish: async (eventId, preview, signal) => {
      const result = await request(
        `/api/v1/admin/events/${encodeURIComponent(eventId)}/publication`,
        publicationResultSchema,
        {
          body: JSON.stringify({
            expectedChecksumSha256: preview.checksumSha256,
            expectedPreviousVersion: preview.expectedPreviousVersion,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          ...(signal ? { signal } : {}),
        },
      );
      if (
        result.ok &&
        (result.data.version !== preview.version ||
          result.data.checksumSha256 !== preview.checksumSha256)
      ) {
        return invalidResponse();
      }
      return result;
    },
  };
};

export const browserAdminContentPort = createFetchAdminContentPort();

export const isAdminContentSecurityFailure = (
  failure: AdminContentFailure,
): boolean =>
  failure.kind === 'offline' ||
  failure.kind === 'permission' ||
  failure.kind === 'session_expired';
