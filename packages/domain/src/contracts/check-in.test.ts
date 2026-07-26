import { describe, expect, it } from 'vitest';

import {
  CHECKIN_SEARCH_RESULT_LIMIT,
  checkinBootstrapResponseSchema,
  checkinCachePolicy,
  checkinConfirmResponseSchema,
  checkinLookupRequestSchema,
  checkinLookupResponseSchema,
  checkinPersonSummarySchema,
  checkinSearchResponseSchema,
  checkinUndoAvailabilitySchema,
  checkinUndoRequestSchema,
} from './check-in.js';

const ids = {
  event: '019f9000-0000-7000-8000-000000000001',
  station: '019f9000-0000-7000-8000-000000000002',
  device: '019f9000-0000-7000-8000-000000000003',
  person: '019f9000-0000-7000-8000-000000000004',
  lookup: '019f9000-0000-7000-8000-000000000005',
  checkin: '019f9000-0000-7000-8000-000000000006',
} as const;

const person = {
  id: ids.person,
  displayName: 'Testovací Účastník',
  maskedEmail: 't***@b***.test',
} as const;
const ticket = { referenceSuffix: 'TST1', state: 'valid' } as const;
const record = {
  id: ids.checkin,
  occurredAt: '2026-09-11T07:45:00.000+02:00',
  station: { id: ids.station, name: 'Hlavní vstup' },
  undo: {
    allowed: true,
    expiresAt: '2026-09-11T07:55:00.000+02:00',
    unavailableReason: null,
  },
} as const;

describe('CS-CHECKIN-01', () => {
  it('keeps every mutation online, explicit and idempotent', () => {
    expect(checkinCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      browserPersistence: 'forbidden',
      offlineCheckin: 'forbidden',
      authority: 'online-server',
      lookupMutation: 'none',
      confirmIdempotency: 'required',
      undoIdempotency: 'required',
    });
  });

  it('accepts a verified operator shell with a synthetic-only adapter', () => {
    expect(
      checkinBootstrapResponseSchema.parse({
        serverNow: '2026-09-11T07:40:00.000+02:00',
        event: {
          id: ids.event,
          name: 'BYZON 2026 — syntetická ukázka',
          timezone: 'Europe/Prague',
        },
        station: { id: ids.station, name: 'Hlavní vstup' },
        device: {
          id: ids.device,
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
      }).policy.offlineCheckinEnabled,
    ).toBe(false);
  });

  it('rejects a revoked device that still claims mutation permission', () => {
    const result = checkinBootstrapResponseSchema.safeParse({
      serverNow: '2026-09-11T07:40:00.000+02:00',
      event: { id: ids.event, name: 'Test', timezone: 'Europe/Prague' },
      station: { id: ids.station, name: 'Vstup' },
      device: { id: ids.device, label: 'Ztracené', state: 'revoked' },
      actor: {
        displayLabel: 'Operátor',
        role: 'organizer_admin',
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
    });
    expect(result.success).toBe(false);
  });

  it('treats credentials as opaque and never silently normalizes them', () => {
    expect(
      checkinLookupRequestSchema.safeParse({
        method: 'manual_code',
        credential: {
          adapter: 'synthetic_demo',
          opaqueValue: ' DEMO-VALID ',
        },
      }).success,
    ).toBe(false);
    const request = checkinLookupRequestSchema.parse({
      method: 'manual_code',
      credential: {
        adapter: 'synthetic_demo',
        opaqueValue: 'DEMO-VALID',
      },
    });
    expect(request.method).toBe('manual_code');
    if (request.method !== 'manual_code') return;
    expect(request.credential.opaqueValue).toBe('DEMO-VALID');
  });

  it('requires a masked email and rejects complete PII', () => {
    expect(checkinPersonSummarySchema.parse(person)).toEqual(person);
    expect(
      checkinPersonSummarySchema.safeParse({
        ...person,
        maskedEmail: 'testovaci@byzon.test',
      }).success,
    ).toBe(false);
  });

  it('keeps lookup and confirm separate and duplicate canonical', () => {
    const valid = checkinLookupResponseSchema.parse({
      lookupId: ids.lookup,
      expiresAt: '2026-09-11T07:42:00.000+02:00',
      outcome: 'valid',
      person,
      ticket,
      previousCheckin: null,
      confirmation: { state: 'required' },
    });
    expect(valid.confirmation.state).toBe('required');

    const duplicate = checkinLookupResponseSchema.parse({
      ...valid,
      outcome: 'duplicate',
      previousCheckin: record,
      confirmation: { state: 'unavailable' },
    });
    expect(duplicate.outcome).toBe('duplicate');
    if (duplicate.outcome !== 'duplicate') return;
    expect(duplicate.previousCheckin.id).toBe(ids.checkin);

    expect(
      checkinLookupResponseSchema.safeParse({
        ...valid,
        outcome: 'duplicate',
        previousCheckin: null,
        confirmation: { state: 'unavailable' },
      }).success,
    ).toBe(false);
  });

  it('accepts canonical checked-in and duplicate confirm outcomes', () => {
    for (const outcome of ['checked_in', 'duplicate'] as const) {
      expect(
        checkinConfirmResponseSchema.parse({
          outcome,
          person,
          ticket,
          checkin: record,
        }).outcome,
      ).toBe(outcome);
    }
  });

  it('bounds search disclosure to five privacy-safe rows', () => {
    const row = { person, ticket };
    expect(
      checkinSearchResponseSchema.parse({
        results: Array.from({ length: CHECKIN_SEARCH_RESULT_LIMIT }, () => row),
        limitedTo: CHECKIN_SEARCH_RESULT_LIMIT,
      }).results,
    ).toHaveLength(CHECKIN_SEARCH_RESULT_LIMIT);
    expect(
      checkinSearchResponseSchema.safeParse({
        results: Array.from(
          { length: CHECKIN_SEARCH_RESULT_LIMIT + 1 },
          () => row,
        ),
        limitedTo: CHECKIN_SEARCH_RESULT_LIMIT,
      }).success,
    ).toBe(false);
  });

  it('requires a meaningful undo reason and one canonical availability branch', () => {
    expect(checkinUndoRequestSchema.safeParse({ reason: 'Omyl' }).success).toBe(
      false,
    );
    expect(
      checkinUndoRequestSchema.parse({
        reason: 'Účastník byl označen omylem.',
      }).reason,
    ).toContain('omylem');
    expect(
      checkinUndoAvailabilitySchema.safeParse({
        allowed: false,
        expiresAt: '2026-09-11T07:55:00.000+02:00',
        unavailableReason: null,
      }).success,
    ).toBe(false);
  });
});
