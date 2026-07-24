import {
  apiProblemCodeSchema,
  type ApiProblem,
  type ApiProblemCode,
  type ApiFailure,
  type TransportMetadata,
} from '@byzon/domain/contracts';
import type { z } from 'zod';

export const apiHttpMethods = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;

export type ApiHttpMethod = (typeof apiHttpMethods)[number];
export type ApiResponseKind = 'json' | 'empty';
export type ApiRetryPolicy = 'never' | 'safe-read';
export type ApiIdempotencyPolicy = 'forbidden' | 'optional' | 'required';

type OptionalRequestSchema = z.ZodType | null;
type ProblemSchema = z.ZodType<ApiProblem>;

export interface ApiEndpoint<
  RequestSchema extends OptionalRequestSchema,
  SuccessSchema extends z.ZodType,
  SupportedProblemSchema extends ProblemSchema,
> {
  readonly method: ApiHttpMethod;
  readonly requestSchema: RequestSchema;
  readonly successSchema: SuccessSchema;
  readonly problemSchema: SupportedProblemSchema;
  readonly problemCodes: readonly ApiProblemCode[];
  readonly responseKind: ApiResponseKind;
  readonly retry: ApiRetryPolicy;
  readonly idempotency: ApiIdempotencyPolicy;
}

export const defineApiEndpoint = <
  RequestSchema extends OptionalRequestSchema,
  SuccessSchema extends z.ZodType,
  SupportedProblemSchema extends ProblemSchema,
>(
  definition: ApiEndpoint<RequestSchema, SuccessSchema, SupportedProblemSchema>,
): ApiEndpoint<RequestSchema, SuccessSchema, SupportedProblemSchema> => {
  const safeRead = definition.method === 'GET' || definition.method === 'HEAD';
  if (
    (safeRead && definition.idempotency !== 'forbidden') ||
    (!safeRead && definition.retry === 'safe-read') ||
    (safeRead && definition.requestSchema !== null) ||
    (definition.method === 'HEAD' && definition.responseKind !== 'empty')
  ) {
    throw new TypeError('Invalid API endpoint policy');
  }

  const problemCodes = definition.problemCodes.map((code) =>
    apiProblemCodeSchema.parse(code),
  );
  if (new Set(problemCodes).size !== problemCodes.length) {
    throw new TypeError('Duplicate API problem code');
  }

  return Object.freeze({
    ...definition,
    problemCodes: Object.freeze(problemCodes),
  });
};

export interface ApiRequestCommonOptions {
  readonly path: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly etag?: string;
  readonly ifMatch?: string;
  readonly idempotencyKey?: string;
  readonly cache?: RequestCache;
}

export type ApiRequestOptions<RequestSchema extends OptionalRequestSchema> =
  ApiRequestCommonOptions &
    (RequestSchema extends z.ZodType
      ? { readonly body: z.input<RequestSchema> }
      : { readonly body?: never });

export interface ApiSuccess<Success> {
  readonly ok: true;
  readonly kind: 'success';
  readonly status: number;
  readonly data: Success;
  readonly metadata: TransportMetadata;
}

export interface ApiNotModified {
  readonly ok: true;
  readonly kind: 'not_modified';
  readonly status: 304;
  readonly metadata: TransportMetadata;
}

export interface ApiFailureResult<Problem extends ApiProblem> {
  readonly ok: false;
  readonly kind: 'failure';
  readonly status?: number;
  readonly failure: ApiFailure<Problem>;
  readonly metadata?: TransportMetadata;
}

export type ApiResult<Success, Problem extends ApiProblem> =
  ApiSuccess<Success> | ApiNotModified | ApiFailureResult<Problem>;

export type ApiRequest = <
  RequestSchema extends OptionalRequestSchema,
  SuccessSchema extends z.ZodType,
  SupportedProblemSchema extends ProblemSchema,
>(
  endpoint: ApiEndpoint<RequestSchema, SuccessSchema, SupportedProblemSchema>,
  options: ApiRequestOptions<RequestSchema>,
) => Promise<
  ApiResult<z.output<SuccessSchema>, z.output<SupportedProblemSchema>>
>;

export interface ApiPort {
  readonly request: ApiRequest;
}
