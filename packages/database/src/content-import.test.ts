import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  importContentJson,
  sessionDescription,
  slugify,
} from './content-import.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('content import preparation', () => {
  it('includes the full annotation, takeaways and closing in the app description', () => {
    expect(
      sessionDescription({
        slug: 'workshop',
        annotation: ['První odstavec.', 'Druhý odstavec.'],
        takeaways_title: 'Co si z workshopu odnesete',
        takeaways: ['Strukturu 1:1.', 'Vlastní plán.'],
        closing: 'Závěrečný odstavec.',
      }),
    ).toBe(
      'První odstavec.\n\nDruhý odstavec.\n\nCo si z workshopu odnesete\n\n• Strukturu 1:1.\n\n• Vlastní plán.\n\nZávěrečný odstavec.',
    );
    expect(sessionDescription({ slug: 'talk', annotation: ['Anotace.'] })).toBe(
      'Anotace.',
    );
    expect(sessionDescription()).toBeUndefined();
    expect(sessionDescription({ slug: 'placeholder' })).toBeUndefined();
  });

  it('normalizes stable Czech slugs', () => {
    expect(slugify('Předsálí Clarion')).toBe('predsali-clarion');
  });

  it('validates the complete source and reports unsafe mappings without writing', async () => {
    const report = await importContentJson({
      db: undefined as never,
      eventSlug: 'byzon-2026',
      sourceFile: resolve(repositoryRoot, 'static-site/data/content.json'),
      repositoryRoot,
      dryRun: true,
    });

    expect(report.counts).toMatchObject({
      assets: 41,
      speakers: 24,
      partners: 16,
      rooms: 9,
      eventDays: 2,
      sessions: 82,
      coachingSessions: 26,
      replacedSessions: 11,
      skippedSessions: 1,
    });
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_time',
          value: '24:00 - ?',
        }),
        expect.objectContaining({ code: 'unmapped_person' }),
        expect.objectContaining({ code: 'unknown_type', value: 'shared' }),
        expect.objectContaining({
          code: 'unknown_type',
          path: 'program.days[0].stages[1].events[15].type',
          value: 'social',
        }),
        expect.objectContaining({
          code: 'unmapped_field',
          path: 'program.days[1].stages[0].events[6].span',
          value: 'all',
        }),
        expect.objectContaining({
          code: 'unmapped_field',
          path: 'program.days[1].stages[0].events[6].compact',
          value: true,
        }),
      ]),
    );
    expect(report.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_field',
          path: expect.stringMatching(/^partners\.logos\[\d+\]\.websiteUrl$/),
        }),
      ]),
    );
  });
});
