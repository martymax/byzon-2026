import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { slugify } from './content-import.js';

interface SourceEvent {
  slug: string;
  questionMode: string;
  speakerSlugs: string[];
  title: string;
  time: string;
  meta?: string;
  detail?: string;
}
interface Source {
  speakers: { list: Array<{ slug: string; name: string }> };
  sessions: { list: Array<{ slug: string; speakers: string[] }> };
  program: {
    days: Array<{
      date: string;
      stages: Array<{ name: string; events: SourceEvent[] }>;
    }>;
  };
}
interface Entry {
  sessionSlug: string;
  sourcePath: string;
  localDate: string;
  roomSlug: string;
  time: string;
  title: string;
  speakerSlugs: string[];
}
interface Inventory {
  eventSlug: string;
  status: string;
  expectedSessionCount: number;
  sessions: Entry[];
  excludedSessions: Entry[];
}

const source = JSON.parse(
  await readFile(
    new URL('../../../static-site/data/content.json', import.meta.url),
    'utf8',
  ),
) as Source;
const inventory = JSON.parse(
  await readFile(
    new URL('../data/question-session-inventory-2026.json', import.meta.url),
    'utf8',
  ),
) as Inventory;

// This is a reviewed source inventory, not a runtime name-based eligibility rule.
// Changing the content or this allowlist requires explicit scope reconciliation.
describe('AQ-00 reviewed Q&A inventory', () => {
  it('contains exactly the 17 reviewed Friday stage sessions', () => {
    expect(inventory.eventSlug).toBe('byzon-2026');
    expect(inventory.status).toBe('scope_confirmed_runtime_disabled');
    expect(inventory.expectedSessionCount).toBe(17);
    expect(inventory.sessions).toHaveLength(17);
    expect(new Set(inventory.sessions.map((row) => row.sessionSlug)).size).toBe(
      17,
    );
    expect(inventory.sessions.map((row) => row.sourcePath)).toEqual([
      ...[2, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17].map(
        (index) => `program.days[0].stages[0].events[${index}]`,
      ),
      ...[2, 3, 4, 6, 7, 8].map(
        (index) => `program.days[0].stages[1].events[${index}]`,
      ),
    ]);
  });

  it.each(inventory.sessions)(
    'reconciles $sessionSlug with canonical content',
    (row) => {
      const match =
        /^program\.days\[(\d+)\]\.stages\[(\d+)\]\.events\[(\d+)\]$/.exec(
          row.sourcePath,
        );
      expect(match).not.toBeNull();
      const day = source.program.days[Number(match![1])]!;
      const stage = day.stages[Number(match![2])]!;
      const event = stage.events[Number(match![3])]!;
      expect(day.date).toBe('18. září 2026');
      expect(row.localDate).toBe('2026-09-18');
      expect(['BYZON Stage', 'Leadership Stage']).toContain(stage.name);
      expect(row.roomSlug).toBe(slugify(stage.name));
      // Session identity stays stable when an announced title changes.
      expect(event.slug).toBe(row.sessionSlug);
      expect(event.questionMode).toBe('moderated_follow_up');
      expect(event.speakerSlugs).toEqual(row.speakerSlugs);
      expect(row.title).toBe(event.title);
      expect(row.time).toBe(event.time);
      const detail = source.sessions.list.find(
        (item) => item.slug === event.detail,
      );
      const nameSlugs = source.speakers.list
        .filter((speaker) =>
          [
            event.title,
            ...(event.meta?.split(',').map((name) => name.trim()) ?? []),
          ].includes(speaker.name),
        )
        .map((speaker) => speaker.slug);
      expect(row.speakerSlugs.length).toBeGreaterThan(0);
      expect([...row.speakerSlugs].sort()).toEqual([...nameSlugs].sort());
      if (detail) {
        expect([...row.speakerSlugs].sort()).toEqual(
          [...detail.speakers].sort(),
        );
      }
    },
  );

  it('excludes the explicitly rejected networking intro and EB21', () => {
    expect(inventory.excludedSessions.map((row) => row.sourcePath)).toEqual([
      'program.days[0].stages[0].events[3]',
      'program.days[0].stages[1].events[10]',
    ]);
    for (const excluded of inventory.excludedSessions) {
      expect(
        inventory.sessions.some(
          (row) => row.sessionSlug === excluded.sessionSlug,
        ),
      ).toBe(false);
    }
  });
});

it('backfills exactly the approved inventory with event, time and room guards', async () => {
  const sql = await readFile(
    new URL('../drizzle/0028_private_question_follow_ups.sql', import.meta.url),
    'utf8',
  );
  const rows = [...sql.matchAll(/^    \('([^']+)', 'program\.days/gm)].map(
    (match) => match[1],
  );
  expect(rows).toEqual(inventory.sessions.map((row) => row.sessionSlug));
  expect(sql).toContain("e.slug = 'byzon-2026'");
  expect(sql).toContain('s.starts_at = a.starts_at AND s.ends_at = a.ends_at');
  expect(sql).toContain('r.slug = a.room_slug');
  expect(
    sql.indexOf('CREATE UNIQUE INDEX "questions_event_session_id_unique"'),
  ).toBeLessThan(
    sql.indexOf('ADD CONSTRAINT "question_answers_question_event_session_fk"'),
  );
});
