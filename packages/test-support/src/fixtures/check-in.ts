import { problemTypeForCode } from '@byzon/domain/contracts';
import {
  checkinBootstrapResponseSchema,
  checkinConfirmProblemSchema,
  checkinConfirmResponseSchema,
  checkinLookupProblemSchema,
  checkinLookupResponseSchema,
  checkinSearchResponseSchema,
  checkinUndoProblemSchema,
  checkinUndoResponseSchema,
} from '@byzon/domain/contracts/check-in';

import { defineFixtureSet } from '../fixture-harness.js';

export const checkinFixtureIds = Object.freeze({
  event: '019f9100-0000-7000-8000-000000000001',
  station: '019f9100-0000-7000-8000-000000000002',
  device: '019f9100-0000-7000-8000-000000000003',
  person: '019f9100-0000-7000-8000-000000000004',
  lookup: '019f9100-0000-7000-8000-000000000005',
  checkin: '019f9100-0000-7000-8000-000000000006',
  secondPerson: '019f9100-0000-7000-8000-000000000007',
} as const);

const person = {
  id: checkinFixtureIds.person,
  displayName: 'Testovací Účastník',
  maskedEmail: 't***@b***.test',
} as const;
const ticket = { referenceSuffix: 'TST1', state: 'valid' } as const;
const station = {
  id: checkinFixtureIds.station,
  name: 'Hlavní vstup',
} as const;
const canonicalCheckin = {
  id: checkinFixtureIds.checkin,
  occurredAt: '2026-09-11T07:45:00.000+02:00',
  station,
  undo: {
    allowed: true,
    expiresAt: '2026-09-11T07:55:00.000+02:00',
    unavailableReason: null,
  },
} as const;
const lookupBase = {
  lookupId: checkinFixtureIds.lookup,
  expiresAt: '2026-09-11T07:47:00.000+02:00',
} as const;

export const checkinBootstrapFixtures = defineFixtureSet({
  name: 'checkin.bootstrap',
  schema: checkinBootstrapResponseSchema,
  fixtures: {
    operator: {
      serverNow: '2026-09-11T07:40:00.000+02:00',
      event: {
        id: checkinFixtureIds.event,
        name: 'BYZON 2026 — syntetická ukázka',
        timezone: 'Europe/Prague',
      },
      station,
      device: {
        id: checkinFixtureIds.device,
        label: 'Demo zařízení A',
        state: 'trusted',
      },
      actor: {
        displayLabel: 'Demo operátor',
        role: 'checkin_operator',
        permissions: { confirm: true, undo: true },
      },
      policy: {
        credentialAdapter: 'synthetic_demo_only',
        operatingMode: 'online_authoritative',
        offlineCheckinEnabled: false,
        searchMinLength: 2,
        searchMaxLength: 80,
        searchResultLimit: 5,
        undoWindowSeconds: 600,
      },
    },
    revoked_admin: {
      serverNow: '2026-09-11T07:40:00.000+02:00',
      event: {
        id: checkinFixtureIds.event,
        name: 'BYZON 2026 — syntetická ukázka',
        timezone: 'Europe/Prague',
      },
      station,
      device: {
        id: checkinFixtureIds.device,
        label: 'Revokované demo zařízení',
        state: 'revoked',
      },
      actor: {
        displayLabel: 'Demo administrátor',
        role: 'organizer_admin',
        permissions: { confirm: false, undo: true },
      },
      policy: {
        credentialAdapter: 'synthetic_demo_only',
        operatingMode: 'online_authoritative',
        offlineCheckinEnabled: false,
        searchMinLength: 2,
        searchMaxLength: 80,
        searchResultLimit: 5,
        undoWindowSeconds: 600,
      },
    },
  },
});

export const checkinLookupFixtures = defineFixtureSet({
  name: 'checkin.lookup',
  schema: checkinLookupResponseSchema,
  fixtures: {
    valid: {
      ...lookupBase,
      outcome: 'valid',
      person,
      ticket,
      previousCheckin: null,
      confirmation: { state: 'required' },
    },
    duplicate: {
      ...lookupBase,
      outcome: 'duplicate',
      person,
      ticket,
      previousCheckin: canonicalCheckin,
      confirmation: { state: 'unavailable' },
    },
    cancelled: {
      ...lookupBase,
      outcome: 'cancelled',
      person,
      ticket: { ...ticket, state: 'cancelled' },
      previousCheckin: null,
      confirmation: { state: 'unavailable' },
    },
    refunded: {
      ...lookupBase,
      outcome: 'refunded',
      person,
      ticket: { ...ticket, state: 'refunded' },
      previousCheckin: null,
      confirmation: { state: 'unavailable' },
    },
    blocked: {
      ...lookupBase,
      outcome: 'blocked',
      person,
      ticket: { ...ticket, state: 'blocked' },
      previousCheckin: null,
      confirmation: { state: 'unavailable' },
    },
    unknown: {
      ...lookupBase,
      outcome: 'unknown',
      person: null,
      ticket: null,
      previousCheckin: null,
      confirmation: { state: 'unavailable' },
    },
  },
});

export const checkinSearchFixtures = defineFixtureSet({
  name: 'checkin.search',
  schema: checkinSearchResponseSchema,
  fixtures: {
    matches: {
      limitedTo: 5,
      results: [
        { person, ticket },
        {
          person: {
            id: checkinFixtureIds.secondPerson,
            displayName: 'Demo Návštěvník',
            maskedEmail: 'd***@b***.test',
          },
          ticket: { referenceSuffix: 'TST2', state: 'valid' },
        },
      ],
    },
    empty: { limitedTo: 5, results: [] },
  },
});

export const checkinConfirmFixtures = defineFixtureSet({
  name: 'checkin.confirm',
  schema: checkinConfirmResponseSchema,
  fixtures: {
    checked_in: {
      outcome: 'checked_in',
      person,
      ticket,
      checkin: canonicalCheckin,
    },
    duplicate: {
      outcome: 'duplicate',
      person,
      ticket,
      checkin: canonicalCheckin,
    },
  },
});

export const checkinUndoFixtures = defineFixtureSet({
  name: 'checkin.undo',
  schema: checkinUndoResponseSchema,
  fixtures: {
    undone: {
      outcome: 'undone',
      checkinId: checkinFixtureIds.checkin,
      undoneAt: '2026-09-11T07:48:00.000+02:00',
    },
    already_undone: {
      outcome: 'already_undone',
      checkinId: checkinFixtureIds.checkin,
      undoneAt: '2026-09-11T07:48:00.000+02:00',
    },
  },
});

const problem = <Code extends string, Status extends number>(
  code: Code,
  status: Status,
) => ({
  type: problemTypeForCode(code),
  title: 'Synthetic check-in problem',
  status,
  code,
  detail: 'Synthetic failure detail must not be shown to an operator.',
  requestId: 'fixture-checkin-0001',
});

export const checkinLookupProblemFixtures = defineFixtureSet({
  name: 'checkin.lookup-problem',
  schema: checkinLookupProblemSchema,
  fixtures: {
    rate_limited: problem('CHECKIN_RATE_LIMITED', 429),
    device_revoked: problem('CHECKIN_DEVICE_REVOKED', 403),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const checkinConfirmProblemFixtures = defineFixtureSet({
  name: 'checkin.confirm-problem',
  schema: checkinConfirmProblemSchema,
  fixtures: {
    lookup_expired: problem('CHECKIN_LOOKUP_EXPIRED', 409),
    ticket_changed: problem('CHECKIN_TICKET_STATE_CHANGED', 409),
    idempotency_in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
  },
});

export const checkinUndoProblemFixtures = defineFixtureSet({
  name: 'checkin.undo-problem',
  schema: checkinUndoProblemSchema,
  fixtures: {
    role_forbidden: problem('CHECKIN_UNDO_FORBIDDEN', 403),
    window_expired: problem('CHECKIN_UNDO_WINDOW_EXPIRED', 409),
  },
});
