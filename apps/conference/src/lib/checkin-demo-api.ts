import {
  checkinBootstrapResponseSchema,
  checkinConfirmRequestSchema,
  checkinConfirmResponseSchema,
  checkinLookupRequestSchema,
  checkinLookupResponseSchema,
  checkinSearchRequestSchema,
  checkinSearchResponseSchema,
  checkinUndoRequestSchema,
  checkinUndoResponseSchema,
} from '@byzon/domain/contracts/check-in';
import { problemTypeForCode } from '@byzon/domain/contracts';

import type { ApiPort } from './api';
import { createFetchApiClient } from './api/fetch-client';

const ids = Object.freeze({
  event: '019f9200-0000-7000-8000-000000000001',
  station: '019f9200-0000-7000-8000-000000000002',
  device: '019f9200-0000-7000-8000-000000000003',
  person: '019f9200-0000-7000-8000-000000000004',
  secondPerson: '019f9200-0000-7000-8000-000000000005',
  lookup: '019f9200-0000-7000-8000-000000000006',
  checkin: '019f9200-0000-7000-8000-000000000007',
} as const);

const station = { id: ids.station, name: 'Hlavní vstup' } as const;
const person = {
  id: ids.person,
  displayName: 'Testovací Účastník',
  maskedEmail: 't***@b***.test',
} as const;
const secondPerson = {
  id: ids.secondPerson,
  displayName: 'Demo Návštěvník',
  maskedEmail: 'd***@b***.test',
} as const;
const ticket = { referenceSuffix: 'TST1', state: 'valid' } as const;
const lookupBase = {
  lookupId: ids.lookup,
  expiresAt: '2026-09-11T07:47:00.000+02:00',
} as const;

const json = (body: unknown, status = 200, requestId = 'demo-checkin-0001') =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'content-type':
        status >= 400 ? 'application/problem+json' : 'application/json',
      'x-request-id': requestId,
    },
  });

const problem = (code: string, status: number) =>
  json(
    {
      type: problemTypeForCode(code),
      title: 'Synthetic check-in failure',
      status,
      code,
      detail: 'Synthetic failure used only by the frontend preview.',
      requestId: 'demo-checkin-problem-0001',
    },
    status,
    'demo-checkin-problem-0001',
  );

const urlFor = (input: RequestInfo | URL): URL => {
  const value =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.toString()
        : input;
  return new URL(value, 'https://byzon.invalid');
};

const methodFor = (input: RequestInfo | URL, init?: RequestInit): string =>
  init?.method ?? (input instanceof Request ? input.method : 'GET');

const parsedBody = (init?: RequestInit): unknown =>
  JSON.parse(String(init?.body ?? 'null'));

const idempotencyKeyFor = (init?: RequestInit): string =>
  new Headers(init?.headers).get('idempotency-key') ?? '';

/**
 * Deterministic preview transport. It validates every synthetic response with
 * CS-CHECKIN-01 but does not decode or verify any real credential.
 */
export const createCheckinDemoApi = ({
  actor,
}: {
  readonly actor?: {
    readonly role: 'checkin_operator' | 'organizer_admin';
    readonly permissions: {
      readonly confirm: boolean;
      readonly undo: boolean;
    };
  };
} = {}): ApiPort => {
  let checkedIn = false;
  let undone = false;
  const mutations = new Map<
    string,
    { readonly fingerprint: string; readonly response: unknown }
  >();

  const mutationFingerprint = (
    method: string,
    path: string,
    body: unknown,
  ): string => JSON.stringify({ method, path, body });

  const record = () => ({
    id: ids.checkin,
    occurredAt: '2026-09-11T07:45:00.000+02:00',
    station,
    undo: !undone
      ? {
          allowed: true as const,
          expiresAt: '2026-09-11T07:55:00.000+02:00',
          unavailableReason: null,
        }
      : {
          allowed: false as const,
          expiresAt: null,
          unavailableReason: 'already_undone' as const,
        },
  });

  const lookupFor = (
    outcome:
      'valid' | 'duplicate' | 'cancelled' | 'refunded' | 'blocked' | 'unknown',
  ) => {
    if (outcome === 'unknown') {
      return checkinLookupResponseSchema.parse({
        ...lookupBase,
        outcome,
        person: null,
        ticket: null,
        previousCheckin: null,
        confirmation: { state: 'unavailable' },
      });
    }
    if (outcome === 'duplicate') {
      return checkinLookupResponseSchema.parse({
        ...lookupBase,
        outcome,
        person,
        ticket,
        previousCheckin: record(),
        confirmation: { state: 'unavailable' },
      });
    }
    return checkinLookupResponseSchema.parse({
      ...lookupBase,
      outcome,
      person,
      ticket: { ...ticket, state: outcome },
      previousCheckin: null,
      confirmation: {
        state: outcome === 'valid' ? 'required' : 'unavailable',
      },
    });
  };

  return createFetchApiClient({
    maxRetries: 0,
    fetch: async (input, init) => {
      const url = urlFor(input);
      const method = methodFor(input, init);

      if (method === 'GET' && url.pathname === '/api/v1/check-in/context') {
        return json(
          checkinBootstrapResponseSchema.parse({
            serverNow: '2026-09-11T07:40:00.000+02:00',
            event: {
              id: ids.event,
              name: 'BYZON 2026 — syntetická ukázka',
              timezone: 'Europe/Prague',
            },
            station,
            device: {
              id: ids.device,
              label: 'Demo zařízení A',
              state: 'trusted',
            },
            actor: {
              displayLabel: 'Demo operátor',
              role: actor?.role ?? 'checkin_operator',
              permissions: actor?.permissions ?? {
                confirm: true,
                undo: true,
              },
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
          }),
        );
      }

      if (method === 'POST' && url.pathname === '/api/v1/check-in/search') {
        const query = checkinSearchRequestSchema
          .parse(parsedBody(init))
          .query.toLocaleLowerCase('cs');
        const matches =
          query.includes('nikdo') || query.includes('empty')
            ? []
            : [
                { person, ticket },
                {
                  person: secondPerson,
                  ticket: { referenceSuffix: 'TST2', state: 'valid' },
                },
              ];
        return json(
          checkinSearchResponseSchema.parse({
            results: matches,
            limitedTo: 5,
          }),
        );
      }

      if (method === 'POST' && url.pathname === '/api/v1/check-in/lookup') {
        const request = checkinLookupRequestSchema.parse(parsedBody(init));
        if (
          request.method !== 'manual_search' &&
          request.credential.opaqueValue === 'DEMO-ERROR'
        ) {
          return problem('INTERNAL_ERROR', 500);
        }
        if (request.method === 'manual_search') {
          return json(lookupFor(checkedIn ? 'duplicate' : 'valid'));
        }
        const code = request.credential.opaqueValue;
        const outcome =
          code === 'DEMO-VALID'
            ? checkedIn
              ? 'duplicate'
              : 'valid'
            : code === 'DEMO-DUPLICATE'
              ? 'duplicate'
              : code === 'DEMO-CANCELLED'
                ? 'cancelled'
                : code === 'DEMO-REFUNDED'
                  ? 'refunded'
                  : code === 'DEMO-BLOCKED'
                    ? 'blocked'
                    : 'unknown';
        return json(lookupFor(outcome));
      }

      if (method === 'POST' && url.pathname === '/api/v1/check-in/confirm') {
        const request = checkinConfirmRequestSchema.parse(parsedBody(init));
        const key = idempotencyKeyFor(init);
        const fingerprint = mutationFingerprint(method, url.pathname, request);
        const replay = mutations.get(key);
        if (replay) {
          return replay.fingerprint === fingerprint
            ? json(replay.response)
            : problem('IDEMPOTENCY_KEY_REUSED', 409);
        }
        if (
          request.lookupId !== ids.lookup ||
          request.stationId !== ids.station ||
          request.deviceId !== ids.device
        ) {
          return problem('CHECKIN_LOOKUP_EXPIRED', 409);
        }
        const outcome = checkedIn ? 'duplicate' : 'checked_in';
        checkedIn = true;
        undone = false;
        const response = checkinConfirmResponseSchema.parse({
          outcome,
          person,
          ticket,
          checkin: record(),
        });
        mutations.set(key, { fingerprint, response });
        return json(response);
      }

      const undoMatch = url.pathname.match(
        /^\/api\/v1\/check-in\/([^/]+)\/undo$/,
      );
      if (method === 'POST' && undoMatch) {
        const request = checkinUndoRequestSchema.parse(parsedBody(init));
        const key = idempotencyKeyFor(init);
        const fingerprint = mutationFingerprint(method, url.pathname, request);
        const replay = mutations.get(key);
        if (replay) {
          return replay.fingerprint === fingerprint
            ? json(replay.response)
            : problem('IDEMPOTENCY_KEY_REUSED', 409);
        }
        if (undoMatch[1] !== ids.checkin) {
          return problem('CHECKIN_NOT_FOUND', 404);
        }
        const response = checkinUndoResponseSchema.parse({
          outcome: undone ? 'already_undone' : 'undone',
          checkinId: ids.checkin,
          undoneAt: '2026-09-11T07:48:00.000+02:00',
        });
        checkedIn = false;
        undone = true;
        mutations.set(key, { fingerprint, response });
        return json(response);
      }

      return problem('CHECKIN_NOT_FOUND', 404);
    },
  });
};
