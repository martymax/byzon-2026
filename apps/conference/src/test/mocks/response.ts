import {
  requestIdSchema,
  transportMetadataSchema,
  type ApiProblem,
} from '@byzon/domain/contracts';
import { validateFixture } from '@byzon/test-support';
import { HttpResponse, type JsonBodyType } from 'msw';
import { z } from 'zod';

export const MOCK_REQUEST_ID = requestIdSchema.parse('mock-request-0001');

const successStatusSchema = z.number().int().min(200).max(299);

export interface MockJsonResponseOptions {
  readonly fixtureName: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly etag?: string;
}

export const mockJsonResponse = <Schema extends z.ZodType<JsonBodyType>>(
  schema: Schema,
  value: unknown,
  options: MockJsonResponseOptions,
) => {
  const status = successStatusSchema.parse(options.status ?? 200);
  const metadata = transportMetadataSchema.parse({
    requestId: options.requestId ?? MOCK_REQUEST_ID,
    ...(options.etag ? { etag: options.etag } : {}),
  });
  const fixture = validateFixture({
    name: options.fixtureName,
    schema,
    value,
  });
  return HttpResponse.json(fixture, {
    status,
    headers: {
      'x-request-id': metadata.requestId,
      ...(metadata.etag ? { etag: metadata.etag } : {}),
    },
  });
};

export interface MockProblemResponseOptions {
  readonly fixtureName: string;
}

export const mockProblemResponse = <Schema extends z.ZodType<ApiProblem>>(
  schema: Schema,
  value: unknown,
  options: MockProblemResponseOptions,
) => {
  const fixture = validateFixture({
    name: options.fixtureName,
    schema,
    value,
  });
  return HttpResponse.json(fixture, {
    status: fixture.status,
    headers: {
      'content-type': 'application/problem+json',
      'x-request-id': fixture.requestId,
    },
  });
};
