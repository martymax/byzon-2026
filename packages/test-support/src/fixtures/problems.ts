import {
  defineApiProblemSchema,
  problemTypeForCode,
  sessionExpiredProblemSchema,
} from '@byzon/domain/contracts';

import { defineFixtureFactory } from '../fixture-harness.js';

const internalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);

export const baseProblemFixtureFactory = defineFixtureFactory({
  name: 'problem.internal-error',
  schema: internalErrorProblemSchema,
  defaults: {
    type: problemTypeForCode('INTERNAL_ERROR'),
    title: 'Internal server error',
    status: 500,
    code: 'INTERNAL_ERROR',
    detail: 'The request could not be completed.',
    requestId: 'fixture-request-0001',
  },
});

export const baseProblemFixture = baseProblemFixtureFactory.base;

export const sessionExpiredProblemFixtureFactory = defineFixtureFactory({
  name: 'problem.session-expired',
  schema: sessionExpiredProblemSchema,
  defaults: {
    type: problemTypeForCode('AUTH_SESSION_EXPIRED'),
    title: 'Session expired',
    status: 401,
    code: 'AUTH_SESSION_EXPIRED',
    detail: 'Sign in to continue.',
    requestId: 'fixture-request-0002',
  },
});

export const sessionExpiredProblemFixture =
  sessionExpiredProblemFixtureFactory.base;
