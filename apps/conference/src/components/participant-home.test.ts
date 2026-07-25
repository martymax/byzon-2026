import { participantProgramFixtures } from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';

import {
  participantHomePhaseCopy,
  selectHomeProgramSessions,
} from './participant-home-model';

const program = participantProgramFixtures.happy!.program;

describe('participant home view model', () => {
  it('defines one or zero dominant actions for every event phase', () => {
    expect(Object.keys(participantHomePhaseCopy)).toEqual([
      'draft',
      'activation_open',
      'live',
      'ended',
      'archived',
    ]);
    expect(participantHomePhaseCopy.draft.cta).toBeNull();
    expect(participantHomePhaseCopy.activation_open.cta).toBe(
      'Prohlédnout program',
    );
    expect(participantHomePhaseCopy.live.cta).toBe('Otevřít celý program');
    expect(participantHomePhaseCopy.ended.cta).toBe('Prohlédnout program');
    expect(participantHomePhaseCopy.archived.cta).toBeNull();
  });

  it('shows only upcoming published sessions before the event', () => {
    expect(
      selectHomeProgramSessions({
        now: '2026-07-25T08:00:00.000Z',
        phase: 'activation_open',
        program,
        timezone: 'Europe/Prague',
      }).map(({ id }) => id),
    ).toEqual(program.sessions.map(({ id }) => id));
  });

  it('uses the event local day and published times during the event', () => {
    expect(
      selectHomeProgramSessions({
        now: '2026-09-18T07:30:00.000Z',
        phase: 'live',
        program,
        timezone: 'Europe/Prague',
      }).map(({ title }) => title),
    ).toEqual(['Otevření konference']);
  });

  it('does not invent current sessions after the event or for invalid time data', () => {
    expect(
      selectHomeProgramSessions({
        now: '2026-09-20T08:00:00.000Z',
        phase: 'ended',
        program,
        timezone: 'Europe/Prague',
      }),
    ).toEqual([]);
    expect(
      selectHomeProgramSessions({
        now: 'invalid',
        phase: 'live',
        program,
        timezone: 'Europe/Prague',
      }),
    ).toEqual([]);
  });
});
