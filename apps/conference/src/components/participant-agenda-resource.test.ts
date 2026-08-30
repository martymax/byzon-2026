import {
  participantAgendaMutationProblemFixtures,
  participantAgendaProblemFixtures,
} from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';

import {
  mapParticipantAgendaMutationFailure,
  mapParticipantAgendaReadFailure,
} from './participant-agenda-failures';

describe('participant agenda failure mapping', () => {
  it('keeps read authentication, permission, disabled and offline distinct', () => {
    expect(
      mapParticipantAgendaReadFailure({
        kind: 'problem',
        problem: participantAgendaProblemFixtures.authentication!,
      }),
    ).toEqual({ status: 'authentication' });
    expect(
      mapParticipantAgendaReadFailure({
        kind: 'problem',
        problem: participantAgendaProblemFixtures.permission!,
      }),
    ).toEqual({ status: 'permission' });
    expect(
      mapParticipantAgendaReadFailure({
        kind: 'problem',
        problem: participantAgendaProblemFixtures.disabled!,
      }),
    ).toEqual({ status: 'disabled' });
    expect(mapParticipantAgendaReadFailure({ kind: 'offline' })).toEqual({
      status: 'offline',
    });
    expect(
      mapParticipantAgendaReadFailure({
        kind: 'problem',
        problem: participantAgendaProblemFixtures.rate_limited!,
      }),
    ).toMatchObject({ status: 'error' });
  });

  it('only retries an uncertain mutation with the retained idempotency key', () => {
    expect(mapParticipantAgendaMutationFailure({ kind: 'offline' })).toEqual({
      kind: 'offline',
      retry: 'mutation',
    });
    expect(
      mapParticipantAgendaMutationFailure({
        kind: 'problem',
        problem: participantAgendaMutationProblemFixtures.in_progress!,
      }),
    ).toMatchObject({ kind: 'in_progress', retry: 'mutation' });
    expect(
      mapParticipantAgendaMutationFailure({
        kind: 'problem',
        problem: participantAgendaMutationProblemFixtures.key_reused!,
      }),
    ).toMatchObject({ kind: 'rejected', retry: 'none' });
    expect(
      mapParticipantAgendaMutationFailure({
        kind: 'problem',
        problem: participantAgendaMutationProblemFixtures.rate_limited!,
      }),
    ).toMatchObject({ kind: 'rate_limited', retry: 'mutation' });
  });

  it('treats canonical capacity, closure and stale problems as final feedback', () => {
    expect(
      mapParticipantAgendaMutationFailure({
        kind: 'problem',
        problem: participantAgendaMutationProblemFixtures.capacity_full!,
      }),
    ).toMatchObject({ kind: 'capacity_full', retry: 'none' });
    expect(
      mapParticipantAgendaMutationFailure({
        kind: 'problem',
        problem: participantAgendaMutationProblemFixtures.reservation_closed!,
      }),
    ).toMatchObject({ kind: 'closed', retry: 'none' });
    expect(
      mapParticipantAgendaMutationFailure({
        kind: 'problem',
        problem: participantAgendaMutationProblemFixtures.stale_version!,
      }),
    ).toMatchObject({ kind: 'stale', retry: 'none' });
  });

  it('forces a canonical read-state transition when agenda is disabled during mutation', () => {
    expect(
      mapParticipantAgendaMutationFailure({
        kind: 'problem',
        problem: participantAgendaMutationProblemFixtures.disabled!,
      }),
    ).toMatchObject({ kind: 'disabled', retry: 'read' });
  });
});
