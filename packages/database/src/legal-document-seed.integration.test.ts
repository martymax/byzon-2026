import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)(
  'legal document publication seed',
  () => {
    it('publishes both documents only in BYZON, remains idempotent and preserves newer versions', async () => {
      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Isolate the real seed from all persistent events and documents while
        // retaining the database schema and its uniqueness constraints.
        await client.query(
          'CREATE TEMP TABLE events (LIKE public.events INCLUDING ALL) ON COMMIT DROP',
        );
        await client.query(
          'CREATE TEMP TABLE legal_documents (LIKE public.legal_documents INCLUDING ALL) ON COMMIT DROP',
        );
        const eventId = crypto.randomUUID();
        const isolationId = crypto.randomUUID();
        await client.query(
          `INSERT INTO events (id, slug, name, starts_at, ends_at, timezone)
        VALUES ($1, 'byzon-2026', 'BYZON', now(), now() + interval '1 day', 'Europe/Prague'),
               ($2, 'byzon-isolation-test', 'Isolation', now(), now() + interval '1 day', 'Europe/Prague')`,
          [eventId, isolationId],
        );
        const seed = await readFile(
          new URL('../drizzle/seed/legal-documents.sql', import.meta.url),
          'utf8',
        );
        await client.query(seed);
        const first = (
          await client.query('SELECT * FROM legal_documents ORDER BY type')
        ).rows;
        expect(first).toHaveLength(2);
        expect(first.map((row) => row.type)).toEqual([
          'terms',
          'privacy_notice',
        ]);
        expect(
          first.every(
            (row) =>
              row.event_id === eventId &&
              row.is_current &&
              row.version === '1.0',
          ),
        ).toBe(true);
        expect(first[0].content).toContain('Pravidla používání aplikace');
        expect(first[1].content).toContain(
          '| Kategorie údajů | Doba uchování |',
        );
        expect(first[1].content).toContain('do 90 dnů po skončení konference');
        await client.query(seed);
        expect(
          (await client.query('SELECT * FROM legal_documents ORDER BY type'))
            .rows,
        ).toEqual(first);
        await client.query(
          "UPDATE legal_documents SET is_current = false WHERE type = 'terms'",
        );
        await client.query(
          `INSERT INTO legal_documents (id, event_id, type, version, title, content, published_at, is_current)
        VALUES ($1, $2, 'terms', '2.0', 'New terms', 'New version', now(), true)`,
          [crypto.randomUUID(), eventId],
        );
        const updated = (
          await client.query(
            'SELECT * FROM legal_documents ORDER BY type, version',
          )
        ).rows;
        await client.query(seed);
        expect(
          (
            await client.query(
              'SELECT * FROM legal_documents ORDER BY type, version',
            )
          ).rows,
        ).toEqual(updated);
      } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.end();
      }
    });
  },
);
