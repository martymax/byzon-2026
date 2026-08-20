import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { importContentJson, slugify } from './content-import.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('content import preparation', () => {
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
      assets: 28,
      speakers: 20,
      partners: 7,
      eventDays: 2,
      sessions: 67,
      skippedSessions: 1,
    });
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_time',
          value: '24:00 - ?',
        }),
        expect.objectContaining({
          code: 'unmapped_field',
          detail: expect.stringContaining('physical room'),
        }),
        expect.objectContaining({ code: 'unmapped_person' }),
        expect.objectContaining({ code: 'unknown_type', value: 'shared' }),
        expect.objectContaining({
          code: 'unknown_type',
          path: 'program.days[0].stages[1].events[14].type',
          value: 'social',
        }),
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
  });
});
