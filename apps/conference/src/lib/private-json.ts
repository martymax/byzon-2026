import type { ZodType } from 'zod';
export class PrivateApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function requestPrivateJson<T>(
  path: string,
  schema: ZodType<T>,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
    body?: unknown;
    key?: string;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) cancel();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 15000);
  try {
    const response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(options.key ? { 'idempotency-key': options.key } : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const problem = data as { code?: unknown; detail?: unknown };
      throw new PrivateApiError(
        response.status,
        typeof problem.code === 'string' ? problem.code : 'REQUEST_FAILED',
        typeof problem.detail === 'string'
          ? problem.detail
          : 'Požadavek se nepodařilo dokončit.',
      );
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new PrivateApiError(
        502,
        'INVALID_RESPONSE',
        'Server vrátil neplatnou odpověď. Zkuste načíst stránku znovu.',
      );
    return parsed.data;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
