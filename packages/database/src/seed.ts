import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('DATABASE_URL is required to seed the database');

const seedStatements = await Promise.all(
  ['events.sql', 'legal-documents.sql'].map((filename) =>
    readFile(resolve(import.meta.dirname, '../drizzle/seed', filename), 'utf8'),
  ),
);
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  application_name: 'byzon-database-seed',
});

try {
  for (const statement of seedStatements) await pool.query(statement);
  process.stdout.write('Database seed completed.\n');
} finally {
  await pool.end();
}
