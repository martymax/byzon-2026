import { describe, expect, it } from 'vitest';

import {
  problemTypeForCode,
  supportCachePolicy,
  supportMutationHeadersSchema,
  supportMutationProblemSchema,
  supportMutationRequestSchema,
  supportSearchQuerySchema,
  supportSearchResponseSchema,
} from './index.js';

const ids = {
  event: '019fa100-0000-7000-8000-000000000001',
  participant: '019fa100-0000-7000-8000-000000000002',
  ticket: '019fa100-0000-7000-8000-000000000003',
  participantTwo: '019fa100-0000-7000-8000-000000000004',
  ticketTwo: '019fa100-0000-7000-8000-000000000005',
} as const;

const activeRecord = {
  eventId: ids.event,
  participantId: ids.participant,
  ticketId: ids.ticket,
  displayName: 'Syntetický účastník',
  maskedContact: 's•••@example.test',
  referenceSuffix: 'T001',
  ticketState: 'active' as const,
  accessState: 'claimed' as const,
  version: 3,
  availableActions: ['resend', 'reassign', 'block', 'transfer'] as const,
};

describe('CS-SUPPORT-01 contracts', () => {
  it('validates bounded no/single/ambiguous search outcomes', () => {
    expect(
      supportSearchQuerySchema.parse({ query: 'syntetický', limit: 5 }),
    ).toEqual({ query: 'syntetický', limit: 5 });
    expect(
      supportSearchResponseSchema.parse({
        eventId: ids.event,
        limitedTo: 5,
        outcome: 'no_match',
        matches: [],
      }).outcome,
    ).toBe('no_match');
    expect(
      supportSearchResponseSchema.parse({
        eventId: ids.event,
        limitedTo: 5,
        outcome: 'single_match',
        matches: [activeRecord],
      }).outcome,
    ).toBe('single_match');
    expect(
      supportSearchResponseSchema.parse({
        eventId: ids.event,
        limitedTo: 5,
        outcome: 'ambiguous',
        matches: [
          activeRecord,
          {
            ...activeRecord,
            participantId: ids.participantTwo,
            ticketId: ids.ticketTwo,
            referenceSuffix: 'T002',
          },
        ],
      }).outcome,
    ).toBe('ambiguous');
    expect(
      supportSearchResponseSchema.safeParse({
        eventId: ids.event,
        limitedTo: 5,
        outcome: 'single_match',
        matches: [activeRecord, activeRecord],
      }).success,
    ).toBe(false);
  });

  it('keeps operational PII masked and private/no-store', () => {
    expect(supportCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      browserPersistence: 'forbidden',
      sharedCache: 'forbidden',
      searchMutation: 'none',
      supportMutation: 'online-only',
      mutationIdempotency: 'required',
    });
    expect(
      supportSearchResponseSchema.safeParse({
        eventId: ids.event,
        limitedTo: 5,
        outcome: 'single_match',
        matches: [
          {
            ...activeRecord,
            maskedContact: 'person@example.test',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires reason/version/target while deriving actor authority server-side', () => {
    const blockRequest = {
      participantId: ids.participant,
      ticketId: ids.ticket,
      action: 'block' as const,
      expectedVersion: 3,
      reason: 'Potvrzená bezpečná blokace vstupenky.',
      targetTicketId: null,
    };

    expect(supportMutationRequestSchema.parse(blockRequest)).toEqual(
      blockRequest,
    );
    expect(
      supportMutationRequestSchema.safeParse({
        ...blockRequest,
        action: 'transfer',
      }).success,
    ).toBe(false);
    expect(
      supportMutationRequestSchema.safeParse({
        ...blockRequest,
        actorRole: 'organizer_admin',
        assignedSessionIds: [],
      }).success,
    ).toBe(false);
    expect(
      supportMutationHeadersSchema.parse({
        idempotencyKey: 'support-mutation-0001',
      }),
    ).toEqual({ idempotencyKey: 'support-mutation-0001' });
  });

  it('enumerates stale and invalid-transition problems', () => {
    const stale = {
      type: problemTypeForCode('STALE_VERSION'),
      title: 'Support record is stale',
      status: 409,
      code: 'STALE_VERSION',
      detail: 'Reload the canonical support record.',
      requestId: 'request-support-0001',
      currentVersion: 4,
    };

    expect(supportMutationProblemSchema.parse(stale)).toEqual(stale);
    expect(
      supportMutationProblemSchema.safeParse({
        ...stale,
        type: problemTypeForCode('SUPPORT_UNSAFE_OVERRIDE'),
        code: 'SUPPORT_UNSAFE_OVERRIDE',
      }).success,
    ).toBe(false);
  });
});
