import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCoachingSchedule } from './coaching-schedule.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('P5-06 coaching schedule', () => {
  it('preserves the reconciled Google Sheet columns and availability', async () => {
    const schedule = await loadCoachingSchedule(repositoryRoot);
    const radim = schedule.slots.filter(({ coachKey }) => coachKey === 'radim');
    const stana = schedule.slots.filter(({ coachKey }) => coachKey === 'stana');

    expect(schedule).toMatchObject({
      capacity: 1,
      durationMinutes: 30,
      localDate: '2026-09-18',
      timezone: 'Europe/Prague',
      sourceVerifiedAt: '2026-08-21',
    });
    expect(schedule.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(radim).toHaveLength(12);
    expect(stana).toHaveLength(14);
    expect(radim.map(({ time }) => time)).not.toContain('12:45 - 13:15');
    expect(radim.map(({ time }) => time)).not.toContain('15:45 - 16:15');
    expect(radim.map(({ time }) => time)).not.toContain('16:15 - 16:45');
    expect(stana.map(({ time }) => time)).not.toContain('12:45 - 13:15');
    expect(stana.map(({ time }) => time)).toEqual(
      expect.arrayContaining(['15:45 - 16:15', '16:15 - 16:45']),
    );
    expect(new Set(schedule.slots.map(({ slug }) => slug)).size).toBe(26);
    expect(
      schedule.slots.every(({ sourcePath }) =>
        /^Pátek!G\d+:I\d+#(?:radim|stana)$/.test(sourcePath),
      ),
    ).toBe(true);
  });
});
