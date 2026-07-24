import {
  participantContentResponseSchema,
  participantProgramResponseSchema,
} from '@byzon/domain/contracts';
import {
  participantContentFixtures,
  participantProgramFixtures,
} from '@byzon/test-support/fixtures';
import { http, type RequestHandler } from 'msw';

import { mockJsonResponse } from './response';

/**
 * Development preview uses the same success contracts and synthetic fixtures
 * as component tests. Failure-state variants stay explicit in tests instead
 * of adding production-looking query switches to the API.
 */
export const mockHandlers: readonly RequestHandler[] = Object.freeze([
  http.get('/api/v1/events/:eventId/program', ({ params }) =>
    mockJsonResponse(
      participantProgramResponseSchema,
      {
        ...participantProgramFixtures.happy,
        eventId: String(params.eventId),
      },
      {
        fixtureName: 'content.mock.program',
        etag: '"content-program-v3"',
      },
    ),
  ),
  http.get('/api/v1/events/:eventId/content', ({ params }) =>
    mockJsonResponse(
      participantContentResponseSchema,
      {
        ...participantContentFixtures.happy,
        eventId: String(params.eventId),
        content: {
          ...participantContentFixtures.happy!.content,
          event: {
            ...participantContentFixtures.happy!.content.event,
            id: String(params.eventId),
          },
        },
      },
      {
        fixtureName: 'content.mock.directory',
        etag: '"content-directory-v3"',
      },
    ),
  ),
]);
