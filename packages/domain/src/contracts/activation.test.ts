import { describe, expect, it } from 'vitest';

import {
  activationCachePolicy,
  activationClaimRequestSchema,
  activationClaimResponseSchema,
  activationIdentityRequestSchema,
  activationLandingProblemSchema,
  activationLandingResponseSchema,
  activationLinkRequestSchema,
  activationLinkResponseSchema,
  activationReturnToSchema,
  participantActivationReturnToSchema,
  problemTypeForCode,
} from './index.js';

const event = {
  id: '01910000-0000-7000-8000-000000000001',
  name: 'BYZON 2026',
  dateLabel: '18.–19. září 2026',
  locationLabel: 'České Budějovice',
  phase: 'activation_open',
} as const;

describe('CS-ACT-01 activation contract', () => {
  it('validates an open anonymous landing without cacheable secrets', () => {
    const response = {
      event,
      availability: {
        state: 'open',
        methods: ['manual_code', 'camera_scan', 'recovery_link'],
      },
      flow: { state: 'anonymous' },
    } as const;

    expect(activationLandingResponseSchema.parse(response)).toEqual(response);
    expect(activationCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      offline: 'read-shell-only',
      secretsInHistory: 'forbidden',
    });
  });

  it('rejects event phase mismatches and unknown response fields', () => {
    expect(
      activationLandingResponseSchema.safeParse({
        event: { ...event, phase: 'archived' },
        availability: {
          state: 'open',
          methods: ['manual_code'],
        },
        flow: { state: 'anonymous' },
      }).success,
    ).toBe(false);
    expect(
      activationLandingResponseSchema.safeParse({
        event,
        availability: {
          state: 'open',
          methods: ['manual_code'],
        },
        flow: { state: 'anonymous' },
        userEmail: 'must-not-cross@example.test',
      }).success,
    ).toBe(false);
  });

  it('requires a manual fallback whenever camera activation is offered', () => {
    expect(
      activationLandingResponseSchema.safeParse({
        event,
        availability: {
          state: 'open',
          methods: ['camera_scan'],
        },
        flow: { state: 'anonymous' },
      }).success,
    ).toBe(false);
    expect(
      activationLandingResponseSchema.safeParse({
        event,
        availability: {
          state: 'open',
          methods: ['manual_code'],
        },
        flow: { state: 'anonymous' },
      }).success,
    ).toBe(true);
  });

  it('keeps ticket codes opaque and exact', () => {
    const request = {
      code: 'TST-OPAQUE-2026',
      method: 'manual_code',
    } as const;
    expect(activationClaimRequestSchema.parse(request)).toEqual(request);
    expect(
      activationClaimRequestSchema.safeParse({
        ...request,
        code: ' TST-OPAQUE-2026 ',
      }).success,
    ).toBe(false);
    expect(
      activationClaimRequestSchema.safeParse({
        ...request,
        code: 'short',
      }).success,
    ).toBe(false);
  });

  it('never claims session or membership creation in a pending response', () => {
    const response = {
      state: 'identity_required',
      flowId: 'flow.synthetic.2026',
      expiresAt: '2026-07-25T13:00:00.000Z',
      membershipCreated: false,
      sessionCreated: false,
    } as const;
    expect(activationClaimResponseSchema.parse(response)).toEqual(response);
    expect(
      activationClaimResponseSchema.safeParse({
        ...response,
        sessionCreated: true,
      }).success,
    ).toBe(false);
  });

  it('allows only explicit same-origin return destinations', () => {
    const request = {
      flowId: 'flow.synthetic.2026',
      email: 'alex@example.test',
      returnTo: '/onboarding',
    } as const;
    expect(activationIdentityRequestSchema.parse(request)).toEqual(request);
    expect(
      activationIdentityRequestSchema.safeParse({
        ...request,
        returnTo: 'https://evil.example/app',
      }).success,
    ).toBe(false);
    expect(
      activationLinkRequestSchema.safeParse({
        token: 'token with spaces',
      }).success,
    ).toBe(false);
  });

  it.each([
    '/app',
    '/app/agenda',
    '/app/informace',
    '/app/networking',
    '/app/nastaveni',
    '/app/oznameni',
    '/app/oznameni?view=unread',
    '/app/partneri',
    '/app/profil',
    '/app/program',
    '/app/recnici',
    '/app/soukromi',
    '/app/vice',
    '/app/vstupenka',
    '/app/program/550e8400-e29b-41d4-a716-446655440000',
    '/app/program/550e8400-e29b-41d4-a716-446655440000?from=agenda',
    '/app/oznameni/01910000-0000-7000-8000-000000000011',
    '/app/networking/01910000-0000-7000-8000-000000000011',
    '/app/recnici/jana-novakova',
  ] as const)(
    'accepts the exact participant return destination %s',
    (value) => {
      expect(participantActivationReturnToSchema.parse(value)).toBe(value);
      expect(activationReturnToSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    'https://evil.example/app',
    '//evil.example/app',
    '\\\\evil.example\\app',
    '/app?next=https://evil.example',
    '/app/oznameni?view=unread&next=%2Fapp',
    '/app/oznameni?view=all',
    '/app/program#secret',
    '/app/program/../profil',
    '/app/program/%2Fprofil',
    '/app/program/%252Fprofil',
    '/app/program/550E8400-E29B-41D4-A716-446655440000',
    '/app/program/not-a-uuid',
    '/app/program/550e8400-e29b-41d4-a716-446655440000?from=program',
    '/app/program/550e8400-e29b-41d4-a716-446655440000?from=agenda&next=%2Fapp',
    '/app/program/550e8400-e29b-41d4-a716-446655440000?from=agenda#secret',
    '/app/oznameni/01910000-0000-7000-8000-000000000011?from=agenda',
    '/app/oznameni/01910000-0000-7000-8000-000000000011/extra',
    '/app/recnici/Jana-Novakova',
    `/app/recnici/${'a'.repeat(129)}`,
    '/app/recnici/jana%2Fnovakova',
  ])('rejects the non-canonical participant destination %#', (value) => {
    expect(participantActivationReturnToSchema.safeParse(value).success).toBe(
      false,
    );
    expect(activationReturnToSchema.safeParse(value).success).toBe(false);
  });

  it('keeps onboarding separate from active participant navigation', () => {
    expect(
      activationLinkResponseSchema.parse({
        state: 'active',
        continueTo: '/app/program/550e8400-e29b-41d4-a716-446655440000',
      }),
    ).toEqual({
      state: 'active',
      continueTo: '/app/program/550e8400-e29b-41d4-a716-446655440000',
    });
    expect(
      activationLinkResponseSchema.safeParse({
        state: 'active',
        continueTo: '/onboarding',
      }).success,
    ).toBe(false);
    expect(
      activationLinkResponseSchema.safeParse({
        state: 'onboarding_required',
        continueTo: '/app',
      }).success,
    ).toBe(false);
  });

  it('accepts only the landing problem taxonomy', () => {
    const problem = {
      type: problemTypeForCode('ACTIVATION_CLOSED'),
      title: 'Activation closed',
      status: 409,
      code: 'ACTIVATION_CLOSED',
      detail: 'Activation is not available.',
      requestId: 'request-activation-0001',
    } as const;
    expect(activationLandingProblemSchema.parse(problem)).toEqual(problem);
    expect(
      activationLandingProblemSchema.safeParse({
        ...problem,
        code: 'CLAIM_REJECTED',
        type: problemTypeForCode('CLAIM_REJECTED'),
        status: 400,
      }).success,
    ).toBe(false);
  });
});
