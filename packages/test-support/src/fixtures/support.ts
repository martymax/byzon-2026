import {
  problemTypeForCode,
  supportMutationProblemSchema,
  supportMutationResponseSchema,
  supportSearchProblemSchema,
  supportSearchResponseSchema,
  supportTargetTicketSearchProblemSchema,
  supportTargetTicketSearchResponseSchema,
  type SupportRecord,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';

export const supportFixtureIds = Object.freeze({
  event: '019fb100-0000-7000-8000-000000000001',
  participant: '019fb100-0000-7000-8000-000000000002',
  ticket: '019fb100-0000-7000-8000-000000000003',
  participantTwo: '019fb100-0000-7000-8000-000000000004',
  ticketTwo: '019fb100-0000-7000-8000-000000000005',
  audit: '019fb100-0000-7000-8000-000000000006',
} as const);

const activeRecord = {
  eventId: supportFixtureIds.event,
  participantId: supportFixtureIds.participant,
  ticketId: supportFixtureIds.ticket,
  displayName: 'Syntetický účastník',
  maskedContact: 's•••@example.test',
  referenceSuffix: 'T001',
  ticketState: 'active' as const,
  accessState: 'claimed' as const,
  version: 3,
  availableActions: ['resend', 'reassign', 'block', 'transfer'],
} satisfies SupportRecord;

const secondActiveRecord = {
  ...activeRecord,
  participantId: supportFixtureIds.participantTwo,
  ticketId: supportFixtureIds.ticketTwo,
  displayName: 'Testovací návštěvník',
  maskedContact: 't•••@example.test',
  referenceSuffix: 'T002',
  version: 2,
} satisfies SupportRecord;

const blockedRecord = {
  ...activeRecord,
  ticketState: 'blocked' as const,
  version: 4,
  availableActions: ['resend', 'reassign', 'reactivate', 'transfer'],
} satisfies SupportRecord;

export const supportSearchFixtures = defineFixtureSet({
  name: 'support.search',
  schema: supportSearchResponseSchema,
  fixtures: {
    no_match: {
      eventId: supportFixtureIds.event,
      limitedTo: 5,
      outcome: 'no_match',
      matches: [],
    },
    single_match: {
      eventId: supportFixtureIds.event,
      limitedTo: 5,
      outcome: 'single_match',
      matches: [activeRecord],
    },
    ambiguous: {
      eventId: supportFixtureIds.event,
      limitedTo: 5,
      outcome: 'ambiguous',
      matches: [activeRecord, secondActiveRecord],
    },
  },
});

const targetCandidate = {
  eventId: supportFixtureIds.event,
  ticketId: supportFixtureIds.ticketTwo,
  maskedContact: 't•••@example.test',
  referenceSuffix: 'T002',
  ticketState: 'active' as const,
  accessState: 'claimed' as const,
  version: 2,
};

const targetSearchBase = {
  eventId: supportFixtureIds.event,
  sourceTicketId: supportFixtureIds.ticket,
  sourceVersion: 3,
  limitedTo: 5 as const,
};

export const supportTargetTicketSearchFixtures = defineFixtureSet({
  name: 'support.target-ticket-search',
  schema: supportTargetTicketSearchResponseSchema,
  fixtures: {
    no_match: {
      ...targetSearchBase,
      outcome: 'no_match',
      candidates: [],
    },
    single_match: {
      ...targetSearchBase,
      outcome: 'single_match',
      candidates: [targetCandidate],
    },
    ambiguous: {
      ...targetSearchBase,
      outcome: 'ambiguous',
      candidates: [
        targetCandidate,
        {
          ...targetCandidate,
          ticketId: '019fb100-0000-7000-8000-000000000007',
          maskedContact: 'u•••@example.test',
          referenceSuffix: 'T003',
          version: 1,
        },
      ],
    },
  },
});

const mutationBase = {
  eventId: supportFixtureIds.event,
  changedAt: '2026-07-25T12:40:00.000+02:00',
  audit: { auditId: supportFixtureIds.audit },
};

export const supportMutationFixtures = defineFixtureSet({
  name: 'support.mutation',
  schema: supportMutationResponseSchema,
  fixtures: {
    blocked: {
      ...mutationBase,
      record: blockedRecord,
      outcome: 'applied',
    },
    idempotent_replay: {
      ...mutationBase,
      record: blockedRecord,
      outcome: 'already_applied',
    },
    reactivated: {
      ...mutationBase,
      record: {
        ...activeRecord,
        version: 5,
      },
      outcome: 'applied',
    },
  },
});

interface SupportProblemStatus {
  readonly AUTHENTICATION_REQUIRED: 401;
  readonly AUTH_SESSION_EXPIRED: 401;
  readonly EVENT_ACCESS_DENIED: 403;
  readonly SUPPORT_RATE_LIMITED: 429;
  readonly VALIDATION_FAILED: 422;
  readonly INTERNAL_ERROR: 500;
  readonly SUPPORT_RECORD_NOT_FOUND: 404;
  readonly SUPPORT_TARGET_NOT_FOUND: 404;
  readonly SUPPORT_INVALID_TRANSITION: 409;
  readonly IDEMPOTENCY_KEY_REUSED: 409;
  readonly IDEMPOTENCY_IN_PROGRESS: 409;
}

const problem = <Code extends keyof SupportProblemStatus>(
  code: Code,
  status: SupportProblemStatus[Code],
) => ({
  type: problemTypeForCode(code),
  title: 'Synthetic support problem',
  status,
  code,
  detail: 'Synthetic support request could not be completed.',
  requestId: 'fixture-support-0001',
});

export const supportSearchProblemFixtures = defineFixtureSet({
  name: 'support.search-problem',
  schema: supportSearchProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    permission: problem('EVENT_ACCESS_DENIED', 403),
    rate_limited: problem('SUPPORT_RATE_LIMITED', 429),
    validation: problem('VALIDATION_FAILED', 422),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const supportTargetTicketSearchProblemFixtures = defineFixtureSet({
  name: 'support.target-ticket-search-problem',
  schema: supportTargetTicketSearchProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    permission: problem('EVENT_ACCESS_DENIED', 403),
    source_not_found: problem('SUPPORT_RECORD_NOT_FOUND', 404),
    stale: {
      type: problemTypeForCode('STALE_VERSION'),
      title: 'Synthetic support target search problem',
      status: 409,
      code: 'STALE_VERSION',
      detail: 'Synthetic source ticket changed before target lookup.',
      requestId: 'fixture-support-target-0002',
      currentVersion: 4,
    },
    rate_limited: problem('SUPPORT_RATE_LIMITED', 429),
    validation: problem('VALIDATION_FAILED', 422),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const supportMutationProblemFixtures = defineFixtureSet({
  name: 'support.mutation-problem',
  schema: supportMutationProblemSchema,
  fixtures: {
    permission: problem('EVENT_ACCESS_DENIED', 403),
    not_found: problem('SUPPORT_RECORD_NOT_FOUND', 404),
    target_not_found: problem('SUPPORT_TARGET_NOT_FOUND', 404),
    stale: {
      type: problemTypeForCode('STALE_VERSION'),
      title: 'Synthetic support problem',
      status: 409,
      code: 'STALE_VERSION',
      detail: 'Synthetic support record is stale.',
      requestId: 'fixture-support-0002',
      currentVersion: 4,
    },
    invalid_transition: problem('SUPPORT_INVALID_TRANSITION', 409),
    key_reused: problem('IDEMPOTENCY_KEY_REUSED', 409),
    in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
  },
});
