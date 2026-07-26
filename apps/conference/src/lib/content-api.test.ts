import {
  participantProgramFixtures,
  participantProgramProblemFixtures,
} from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';

import { createFetchApiClient } from './api/fetch-client.js';
import { requestParticipantProgram } from './content-api.js';

const responseHeaders = {
  'content-type': 'application/json',
  'x-request-id': 'content-client-0001',
};

describe('CS-CONTENT-01 browser adapter', () => {
  it('returns a response validated by the shared program contract', async () => {
    const client = createFetchApiClient({
      maxRetries: 0,
      fetch: async () =>
        Response.json(participantProgramFixtures.happy, {
          headers: responseHeaders,
        }),
    });

    await expect(
      requestParticipantProgram(
        client,
        participantProgramFixtures.happy!.eventId,
      ),
    ).resolves.toMatchObject({
      ok: true,
      kind: 'success',
      data: { version: 3 },
    });
  });

  it('rejects an unknown response field instead of casting the body', async () => {
    const client = createFetchApiClient({
      maxRetries: 0,
      fetch: async () =>
        Response.json(
          {
            ...participantProgramFixtures.happy,
            privateAdminNote: 'must-not-reach-the-ui',
          },
          { headers: responseHeaders },
        ),
    });

    await expect(
      requestParticipantProgram(
        client,
        participantProgramFixtures.happy!.eventId,
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('maps only a supported validated problem response', async () => {
    const problem = participantProgramProblemFixtures.permission!;
    const client = createFetchApiClient({
      maxRetries: 0,
      fetch: async () =>
        Response.json(problem, {
          status: problem.status,
          headers: {
            'content-type': 'application/problem+json',
            'x-request-id': problem.requestId,
          },
        }),
    });

    await expect(
      requestParticipantProgram(
        client,
        participantProgramFixtures.happy!.eventId,
      ),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
      failure: {
        kind: 'problem',
        problem: { code: 'PROGRAM_NOT_FOUND' },
      },
    });
  });
});
