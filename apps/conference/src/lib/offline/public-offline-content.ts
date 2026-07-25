import {
  publicContentResponseSchema,
  type PublicContentResponse,
} from '@byzon/domain/contracts';

import {
  publicCacheFreshness,
  publicContentPath,
  type PublicCacheFreshness,
} from './offline-policy';

export type PublicContentSource = 'cache' | 'network';

export type PublicOfflineContentResult =
  | {
      readonly data: PublicContentResponse;
      readonly freshness: PublicCacheFreshness;
      readonly source: PublicContentSource;
      readonly status: 'ready';
      readonly storedAt: string;
    }
  | {
      readonly reason: 'invalid_response' | 'not_found' | 'offline' | 'server';
      readonly status: 'unavailable';
    };

export interface LoadPublicOfflineContentOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: Date;
  readonly signal?: AbortSignal;
}

const validIso = (value: string | null): value is string =>
  value !== null && Number.isFinite(Date.parse(value));

export const loadPublicOfflineContent = async (
  eventSlug: string,
  options: LoadPublicOfflineContentOptions = {},
): Promise<PublicOfflineContentResult> => {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? new Date();
  try {
    const response = await fetcher(publicContentPath(eventSlug), {
      cache: 'no-cache',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (response.status === 404) {
      return { status: 'unavailable', reason: 'not_found' };
    }
    if (!response.ok) {
      return { status: 'unavailable', reason: 'server' };
    }
    if (
      !/^application\/json(?:;|$)/i.test(
        response.headers.get('content-type') ?? '',
      )
    ) {
      return { status: 'unavailable', reason: 'invalid_response' };
    }

    const parsed = publicContentResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { status: 'unavailable', reason: 'invalid_response' };
    }

    const sourceHeader = response.headers.get('x-byzon-cache-source');
    if (
      sourceHeader !== null &&
      sourceHeader !== 'cache' &&
      sourceHeader !== 'network'
    ) {
      return { status: 'unavailable', reason: 'invalid_response' };
    }
    const source: PublicContentSource =
      sourceHeader === 'cache' ? 'cache' : 'network';
    const versionHeader = response.headers.get('x-byzon-publication-version');
    if (
      versionHeader !== null &&
      Number(versionHeader) !== parsed.data.version
    ) {
      return { status: 'unavailable', reason: 'invalid_response' };
    }

    const storedHeader = response.headers.get('x-byzon-cache-stored-at');
    if (source === 'cache' && !validIso(storedHeader)) {
      return { status: 'unavailable', reason: 'invalid_response' };
    }
    const storedAt = validIso(storedHeader)
      ? new Date(storedHeader).toISOString()
      : now.toISOString();

    return {
      status: 'ready',
      data: parsed.data,
      source,
      storedAt,
      freshness:
        source === 'cache'
          ? publicCacheFreshness(storedAt, now.getTime())
          : 'fresh',
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { status: 'unavailable', reason: 'offline' };
  }
};
