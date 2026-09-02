import { adminReadProblemSchema } from '@byzon/domain/contracts';
import { describe, expect, it } from 'vitest';

import {
  readAdminReservationSessions,
  type AdminReservationDependencies,
} from './admin-reservations';

const eventId = '019fb200-0000-7000-8000-000000000001';
const adminId = '019fb200-0000-7000-8000-000000000004';
const origin = 'http://localhost:3000';

const dependencies = (
  authenticated: boolean,
): AdminReservationDependencies => ({
  db: {} as AdminReservationDependencies['db'],
  allowedOrigin: origin,
  getSession: async () => (authenticated ? { user: { id: adminId } } : null),
});

describe('admin reservation-session read transport', () => {
  it('authenticates before rejecting an opaque cursor', async () => {
    const request = new Request(
      `${origin}/api/v1/admin/events/${eventId}/reservation-sessions?cursor=invalid`,
    );
    const anonymous = await readAdminReservationSessions(
      request,
      eventId,
      dependencies(false),
    );
    expect(anonymous.status).toBe(401);
    expect(adminReadProblemSchema.parse(await anonymous.json()).code).toBe(
      'AUTHENTICATION_REQUIRED',
    );

    const invalid = await readAdminReservationSessions(
      request,
      eventId,
      dependencies(true),
    );
    expect(invalid.status).toBe(422);
    expect(adminReadProblemSchema.parse(await invalid.json()).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(invalid.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each(['?limit=0', '?limit=51', '?limit=25&limit=10', '?unknown=value'])(
    'rejects unsupported session-page query %s',
    async (query) => {
      const response = await readAdminReservationSessions(
        new Request(
          `${origin}/api/v1/admin/events/${eventId}/reservation-sessions${query}`,
        ),
        eventId,
        dependencies(true),
      );
      expect(response.status).toBe(422);
      expect(adminReadProblemSchema.parse(await response.json()).code).toBe(
        'VALIDATION_FAILED',
      );
    },
  );
});
