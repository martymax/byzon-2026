import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('DATABASE_URL is required to seed the database');

const seedSql = await readFile(
  resolve(import.meta.dirname, '../drizzle/seed/events.sql'),
  'utf8',
);
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  application_name: 'byzon-database-seed',
});

try {
  await pool.query(seedSql);
  process.stdout.write('Database seed completed.\n');
} finally {
  await pool.end();
}
