import {
  etagSchema,
  idempotencyKeySchema,
  requestIdSchema,
  sessionExpiredProblemSchema,
  transportMetadataSchema,
  type ApiFailure,
  type ApiProblem,
  type RequestId,
  type TransportMetadata,
} from '@byzon/domain/contracts';
import type { z } from 'zod';

import type {
  ApiEndpoint,
  ApiFailureResult,
  ApiPort,
  ApiRequest,
  ApiRequestOptions,
  ApiResult,
} from './endpoint.js';

const API_PATH_PATTERN = /^\/api\/v1(?:\/|[?#]|$)/;
const RETRYABLE_READ_STATUSES = new Set([408, 425, 429, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;
const DEFAULT_MAX_REQUEST_BYTES = 1_000_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;
const MAX_BODY_BYTES = 10_000_000;

type OptionalRequestSchema = z.ZodType | null;
type ProblemSchema = z.ZodType<ApiProblem>;
type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export type ApiRequestConfigurationErrorCode =
  | 'invalid_path'
  | 'invalid_body'
  | 'invalid_etag'
  | 'invalid_idempotency_key'
  | 'invalid_request_policy';

export interface ApiRequestConfigurationIssue {
  readonly code: string;
  readonly path: string;
}

export class ApiRequestConfigurationError extends Error {
  readonly code: ApiRequestConfigurationErrorCode;
  readonly issues: readonly ApiRequestConfigurationIssue[];

  constructor(
    code: ApiRequestConfigurationErrorCode,
    issues: readonly ApiRequestConfigurationIssue[] = [],
  ) {
    super(`Invalid API request configuration (${code})`);
    this.name = 'ApiRequestConfigurationError';
    this.code = code;
    this.issues = Object.freeze(
      issues.map((issue) => Object.freeze({ ...issue })),
    );
  }
}

export interface FetchApiClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: FetchImplementation;
  readonly isOnline?: () => boolean;
  readonly sleep?: Sleep;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
}

interface ResolvedClientOptions {
  readonly baseOrigin: string | null;
  readonly fetch: FetchImplementation;
  readonly isOnline: () => boolean;
  readonly sleep: Sleep;
  readonly now: () => number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
}

const boundedInteger = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new TypeError('Invalid API client numeric option');
  }
  return resolved;
};

const resolveBaseOrigin = (baseUrl: string | undefined): string | null => {
  if (!baseUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new TypeError('Invalid API client base URL');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TypeError('Invalid API client base URL');
  }
  if (typeof location === 'undefined' || location.origin !== parsed.origin) {
    throw new TypeError('API client base URL must use the current origin');
  }
  return parsed.origin;
};

const defaultIsOnline = (): boolean =>
  typeof navigator === 'undefined' || navigator.onLine !== false;

const defaultSleep: Sleep = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });

const abortable = <Value>(
  operation: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> => {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
};

const resolveOptions = (
  options: FetchApiClientOptions,
): ResolvedClientOptions => ({
  baseOrigin: resolveBaseOrigin(options.baseUrl),
  fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
  isOnline: options.isOnline ?? defaultIsOnline,
  sleep: options.sleep ?? defaultSleep,
  now: options.now ?? Date.now,
  timeoutMs: boundedInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    100,
    MAX_TIMEOUT_MS,
  ),
  maxRetries: boundedInteger(
    options.maxRetries,
    DEFAULT_MAX_RETRIES,
    0,
    MAX_RETRIES,
  ),
  retryDelayMs: boundedInteger(
    options.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS,
    0,
    DEFAULT_MAX_RETRY_DELAY_MS,
  ),
  maxRetryDelayMs: boundedInteger(
    options.maxRetryDelayMs,
    DEFAULT_MAX_RETRY_DELAY_MS,
    0,
    30_000,
  ),
  maxRequestBytes: boundedInteger(
    options.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES,
    1,
    MAX_BODY_BYTES,
  ),
  maxResponseBytes: boundedInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    1,
    MAX_BODY_BYTES,
  ),
});

const pathForFetch = (path: string, baseOrigin: string | null): string => {
  if (
    path.length > 2_048 ||
    !API_PATH_PATTERN.test(path) ||
    path.includes('\\') ||
    /[\u0000-\u001F\u007F]/.test(path) ||
    path.includes('#')
  ) {
    throw new ApiRequestConfigurationError('invalid_path');
  }
  let parsed: URL;
  try {
    decodeURI(path);
    parsed = new URL(path, 'https://byzon.invalid');
  } catch {
    throw new ApiRequestConfigurationError('invalid_path');
  }
  if (!/^\/api\/v1(?:\/|$)/.test(parsed.pathname)) {
    throw new ApiRequestConfigurationError('invalid_path');
  }
  const canonicalPath = `${parsed.pathname}${parsed.search}`;
  return baseOrigin
    ? new URL(canonicalPath, baseOrigin).toString()
    : canonicalPath;
};

const issuePath = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? '$' : `$.${path.map(String).join('.')}`;

const serializeRequestBody = (
  schema: z.ZodType,
  value: unknown,
  maximumBytes: number,
): string => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiRequestConfigurationError(
      'invalid_body',
      parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issuePath(issue.path),
      })),
    );
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(parsed.data);
  } catch {
    throw new ApiRequestConfigurationError('invalid_body');
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > maximumBytes
  ) {
    throw new ApiRequestConfigurationError('invalid_body');
  }
  return serialized;
};

const validatedHeader = (
  value: string | undefined,
  kind: 'etag' | 'idempotency',
): string | undefined => {
  if (value === undefined) return undefined;
  const schema = kind === 'etag' ? etagSchema : idempotencyKeySchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiRequestConfigurationError(
      kind === 'etag' ? 'invalid_etag' : 'invalid_idempotency_key',
    );
  }
  return parsed.data;
};

const requestBody = (
  requestSchema: OptionalRequestSchema,
  options: ApiRequestOptions<OptionalRequestSchema>,
  maximumBytes: number,
): string | undefined => {
  const suppliedBody = 'body' in options ? options.body : undefined;
  if (requestSchema === null) {
    if (suppliedBody !== undefined) {
      throw new ApiRequestConfigurationError('invalid_request_policy');
    }
    return undefined;
  }
  if (!('body' in options)) {
    throw new ApiRequestConfigurationError('invalid_request_policy');
  }
  return serializeRequestBody(requestSchema, suppliedBody, maximumBytes);
};

const assertEndpointPolicy = (
  endpoint: ApiEndpoint<OptionalRequestSchema, z.ZodType, ProblemSchema>,
): void => {
  const safeRead = endpoint.method === 'GET' || endpoint.method === 'HEAD';
  if (
    (safeRead && endpoint.idempotency !== 'forbidden') ||
    (!safeRead && endpoint.retry === 'safe-read') ||
    (safeRead && endpoint.requestSchema !== null) ||
    (endpoint.method === 'HEAD' && endpoint.responseKind !== 'empty')
  ) {
    throw new ApiRequestConfigurationError('invalid_request_policy');
  }
};

const requestHeaders = (
  endpoint: ApiEndpoint<OptionalRequestSchema, z.ZodType, ProblemSchema>,
  options: ApiRequestOptions<OptionalRequestSchema>,
  hasBody: boolean,
): Headers => {
  const safeRead = endpoint.method === 'GET' || endpoint.method === 'HEAD';
  const etag = validatedHeader(options.etag, 'etag');
  const ifMatch = validatedHeader(options.ifMatch, 'etag');
  const idempotencyKey = validatedHeader(options.idempotencyKey, 'idempotency');

  if (
    (safeRead && (ifMatch || idempotencyKey)) ||
    (!safeRead && etag) ||
    (endpoint.idempotency === 'forbidden' && idempotencyKey) ||
    (endpoint.idempotency === 'required' && !idempotencyKey)
  ) {
    throw new ApiRequestConfigurationError('invalid_request_policy');
  }

  const headers = new Headers({
    accept: 'application/json, application/problem+json',
  });
  if (hasBody) headers.set('content-type', 'application/json');
  if (etag) headers.set('if-none-match', etag);
  if (ifMatch) headers.set('if-match', ifMatch);
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
  return headers;
};

const mediaType = (response: Response): string | null => {
  const value = response.headers.get('content-type');
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? null;
};

const validatedRequestId = (response: Response): RequestId | undefined => {
  const parsed = requestIdSchema.safeParse(
    response.headers.get('x-request-id'),
  );
  return parsed.success ? parsed.data : undefined;
};

const responseMetadata = (
  response: Response,
): TransportMetadata | undefined => {
  const requestId = validatedRequestId(response);
  if (!requestId) return undefined;
  const etag = response.headers.get('etag') ?? undefined;
  const parsed = transportMetadataSchema.safeParse({
    requestId,
    ...(etag ? { etag } : {}),
  });
  return parsed.success ? parsed.data : undefined;
};

const failureResult = <Problem extends ApiProblem>(
  failure: ApiFailure<Problem>,
  response?: Response,
  metadata?: TransportMetadata,
): ApiFailureResult<Problem> => ({
  ok: false,
  kind: 'failure',
  failure,
  ...(response ? { status: response.status } : {}),
  ...(metadata ? { metadata } : {}),
});

const invalidResponse = <Problem extends ApiProblem>(
  response: Response,
  metadata?: TransportMetadata,
): ApiFailureResult<Problem> =>
  failureResult(
    {
      kind: 'invalid_response',
      ...(metadata ? { requestId: metadata.requestId } : {}),
    },
    response,
    metadata,
  );

type BoundedTextResult =
  | { readonly kind: 'success'; readonly text: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'transport' };

const readBoundedText = async (
  response: Response,
  maximumBytes: number,
): Promise<BoundedTextResult> => {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    void response.body?.cancel().catch(() => undefined);
    return { kind: 'invalid' };
  }
  if (!response.body) {
    try {
      const text = await response.text();
      return new TextEncoder().encode(text).byteLength <= maximumBytes
        ? { kind: 'success', text }
        : { kind: 'invalid' };
    } catch {
      return { kind: 'transport' };
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        void reader.cancel().catch(() => undefined);
        return { kind: 'invalid' };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      kind: 'success',
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    };
  } catch {
    return { kind: 'transport' };
  } finally {
    reader.releaseLock();
  }
};

const parseJson = (text: string): unknown => {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const parseResponse = async <
  SuccessSchema extends z.ZodType,
  SupportedProblemSchema extends ProblemSchema,
>(
  endpoint: ApiEndpoint<
    OptionalRequestSchema,
    SuccessSchema,
    SupportedProblemSchema
  >,
  response: Response,
  options: ApiRequestOptions<OptionalRequestSchema>,
  maximumBytes: number,
): Promise<
  ApiResult<z.output<SuccessSchema>, z.output<SupportedProblemSchema>>
> => {
  const metadata = responseMetadata(response);
  if (!metadata) return invalidResponse(response);

  if (response.status === 304) {
    if (!options.etag || !metadata.etag || metadata.etag !== options.etag) {
      return invalidResponse(response, metadata);
    }
    return {
      ok: true,
      kind: 'not_modified',
      status: 304,
      metadata,
    };
  }

  const type = mediaType(response);
  const body = await readBoundedText(response, maximumBytes);
  if (body.kind === 'invalid') return invalidResponse(response, metadata);
  if (body.kind === 'transport') {
    return failureResult({ kind: 'transport' }, response, metadata);
  }
  const { text } = body;

  if (!response.ok) {
    if (type !== 'application/problem+json') {
      return invalidResponse(response, metadata);
    }
    const body = parseJson(text);
    const expired = sessionExpiredProblemSchema.safeParse(body);
    if (
      expired.success &&
      expired.data.status === response.status &&
      expired.data.requestId === metadata.requestId
    ) {
      return failureResult<z.output<SupportedProblemSchema>>(
        { kind: 'session_expired', problem: expired.data },
        response,
        metadata,
      );
    }

    const problem = endpoint.problemSchema.safeParse(body);
    if (
      !problem.success ||
      problem.data.status !== response.status ||
      problem.data.requestId !== metadata.requestId ||
      !endpoint.problemCodes.includes(problem.data.code)
    ) {
      return invalidResponse(response, metadata);
    }
    return failureResult(
      { kind: 'problem', problem: problem.data },
      response,
      metadata,
    );
  }

  if (endpoint.responseKind === 'empty') {
    if (text.length > 0) return invalidResponse(response, metadata);
    const parsed = endpoint.successSchema.safeParse(undefined);
    return parsed.success
      ? {
          ok: true,
          kind: 'success',
          status: response.status,
          data: parsed.data,
          metadata,
        }
      : invalidResponse(response, metadata);
  }

  if (
    type !== 'application/json' &&
    !(type?.startsWith('application/') && type.endsWith('+json'))
  ) {
    return invalidResponse(response, metadata);
  }
  const parsed = endpoint.successSchema.safeParse(parseJson(text));
  return parsed.success
    ? {
        ok: true,
        kind: 'success',
        status: response.status,
        data: parsed.data,
        metadata,
      }
    : invalidResponse(response, metadata);
};

const retryAfterMilliseconds = (
  response: Response,
  now: number,
  fallback: number,
  maximum: number,
): number | null => {
  const header = response.headers.get('retry-after');
  let delay = fallback;
  if (header) {
    if (/^\d+$/.test(header)) {
      delay = Number(header) * 1_000;
    } else {
      const retryAt = Date.parse(header);
      if (!Number.isFinite(retryAt)) return null;
      delay = Math.max(0, retryAt - now);
    }
  }
  return Number.isFinite(delay) && delay >= 0 && delay <= maximum
    ? delay
    : null;
};

const canRetryRead = (
  endpoint: ApiEndpoint<OptionalRequestSchema, z.ZodType, ProblemSchema>,
  attempt: number,
  maximumRetries: number,
): boolean =>
  (endpoint.method === 'GET' || endpoint.method === 'HEAD') &&
  endpoint.retry === 'safe-read' &&
  attempt < maximumRetries;

const safelyOnline = (isOnline: () => boolean): boolean => {
  try {
    return isOnline();
  } catch {
    return true;
  }
};

export const createFetchApiClient = (
  clientOptions: FetchApiClientOptions = {},
): ApiPort => {
  const resolved = resolveOptions(clientOptions);

  const request: ApiRequest = async (endpoint, options) => {
    assertEndpointPolicy(endpoint);
    const timeoutMs = boundedInteger(
      options.timeoutMs,
      resolved.timeoutMs,
      100,
      MAX_TIMEOUT_MS,
    );
    const path = pathForFetch(options.path, resolved.baseOrigin);
    const body = requestBody(
      endpoint.requestSchema,
      options as ApiRequestOptions<OptionalRequestSchema>,
      resolved.maxRequestBytes,
    );
    const headers = requestHeaders(
      endpoint,
      options as ApiRequestOptions<OptionalRequestSchema>,
      body !== undefined,
    );

    if (options.signal?.aborted) {
      return failureResult({ kind: 'aborted' });
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      for (let attempt = 0; ; attempt += 1) {
        if (options.signal?.aborted) {
          return failureResult({ kind: 'aborted' });
        }
        if (timedOut) return failureResult({ kind: 'timeout' });

        let response: Response;
        try {
          response = await abortable(
            resolved.fetch(path, {
              method: endpoint.method,
              headers,
              ...(body !== undefined ? { body } : {}),
              signal: controller.signal,
              credentials: 'same-origin',
              redirect: 'error',
              referrerPolicy: 'same-origin',
              cache: options.cache ?? 'default',
            }),
            controller.signal,
          );
        } catch {
          if (options.signal?.aborted) {
            return failureResult({ kind: 'aborted' });
          }
          if (timedOut) return failureResult({ kind: 'timeout' });
          if (!safelyOnline(resolved.isOnline)) {
            return failureResult({ kind: 'offline' });
          }
          if (canRetryRead(endpoint, attempt, resolved.maxRetries)) {
            const delay = Math.min(
              resolved.maxRetryDelayMs,
              resolved.retryDelayMs * 2 ** attempt,
            );
            try {
              await abortable(
                resolved.sleep(delay, controller.signal),
                controller.signal,
              );
              continue;
            } catch {
              if (options.signal?.aborted) {
                return failureResult({ kind: 'aborted' });
              }
              if (timedOut) return failureResult({ kind: 'timeout' });
              return failureResult({ kind: 'transport' });
            }
          }
          return failureResult({ kind: 'transport' });
        }

        if (options.signal?.aborted) {
          return failureResult({ kind: 'aborted' });
        }
        if (timedOut) return failureResult({ kind: 'timeout' });

        if (
          RETRYABLE_READ_STATUSES.has(response.status) &&
          canRetryRead(endpoint, attempt, resolved.maxRetries)
        ) {
          const fallback = Math.min(
            resolved.maxRetryDelayMs,
            resolved.retryDelayMs * 2 ** attempt,
          );
          const delay = retryAfterMilliseconds(
            response,
            resolved.now(),
            fallback,
            resolved.maxRetryDelayMs,
          );
          if (delay !== null) {
            try {
              await response.body?.cancel();
              await abortable(
                resolved.sleep(delay, controller.signal),
                controller.signal,
              );
              continue;
            } catch {
              if (options.signal?.aborted) {
                return failureResult({ kind: 'aborted' });
              }
              if (timedOut) return failureResult({ kind: 'timeout' });
              return failureResult({ kind: 'transport' });
            }
          }
        }

        let result: ApiResult<
          z.output<typeof endpoint.successSchema>,
          z.output<typeof endpoint.problemSchema>
        >;
        try {
          result = await abortable(
            parseResponse(
              endpoint,
              response,
              options as ApiRequestOptions<OptionalRequestSchema>,
              resolved.maxResponseBytes,
            ),
            controller.signal,
          );
        } catch {
          if (options.signal?.aborted) {
            return failureResult({ kind: 'aborted' });
          }
          if (timedOut) return failureResult({ kind: 'timeout' });
          return failureResult({ kind: 'transport' });
        }
        if (options.signal?.aborted) {
          return failureResult({ kind: 'aborted' });
        }
        if (timedOut) return failureResult({ kind: 'timeout' });
        return result;
      }
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  };

  return Object.freeze({ request });
};
