import { eq } from 'drizzle-orm';
import { createDatabaseClient } from './client.js';
import { inspectProgramReadiness } from './program-readiness.js';
import { events } from './schema/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const client = createDatabaseClient({
  connectionString,
  max: 2,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 5000,
  applicationName: 'byzon-program-readiness',
  onUnexpectedError: () => {
    process.stderr.write('Database connection failed\n');
  },
});
try {
  const event = await client.db.query.events.findFirst({
    columns: { id: true },
    where: eq(events.slug, process.argv[2] ?? 'byzon-2026'),
  });
  if (!event) throw new Error('Event not found');
  const report = await inspectProgramReadiness(client.db, event.id);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
} finally {
  await client.close();
}
