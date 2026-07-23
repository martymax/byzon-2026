import { eventRoles } from '@byzon/domain';
import { z } from 'zod';

import { validateFixture } from '../fixture-harness.js';

const FIXTURE_EVENT_PHASES = [
  'draft',
  'activation_open',
  'live',
  'ended',
  'archived',
] as const;

export const fixtureEventRoleSchema = z.enum(eventRoles);
export const fixtureEventPhaseSchema = z.enum(FIXTURE_EVENT_PHASES);

export const fixtureContextSchema = z.strictObject({
  role: fixtureEventRoleSchema,
  phase: fixtureEventPhaseSchema,
});

export type FixtureEventRole = z.infer<typeof fixtureEventRoleSchema>;
export type FixtureEventPhase = z.infer<typeof fixtureEventPhaseSchema>;
export type FixtureContext = z.infer<typeof fixtureContextSchema>;

export const fixtureEventRoles = validateFixture({
  name: 'context.roles',
  schema: z.array(fixtureEventRoleSchema).length(eventRoles.length),
  value: eventRoles,
});

export const fixtureEventPhases = validateFixture({
  name: 'context.phases',
  schema: z.array(fixtureEventPhaseSchema).length(FIXTURE_EVENT_PHASES.length),
  value: FIXTURE_EVENT_PHASES,
});

export const fixtureContextMatrix = validateFixture({
  name: 'context.matrix',
  schema: z
    .array(fixtureContextSchema)
    .length(eventRoles.length * fixtureEventPhases.length),
  value: fixtureEventPhases.flatMap((phase) =>
    eventRoles.map((role) => ({ role, phase })),
  ),
});
