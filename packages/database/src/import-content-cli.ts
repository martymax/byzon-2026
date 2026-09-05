import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

import { createDatabaseClient } from './client.js';
import { importContentJson } from './content-import.js';

const { values } = parseArgs({
  options: {
    'event-slug': { type: 'string' },
    source: { type: 'string' },
    'repository-root': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'allow-published-update': { type: 'boolean', default: false },
  },
  strict: true,
});
const eventSlug = values['event-slug'];
if (!eventSlug) throw new Error('--event-slug is required');
const repositoryRoot = resolve(
  values['repository-root'] ?? resolve(import.meta.dirname, '../../..'),
);
const sourceFile = resolve(
  values.source ?? resolve(repositoryRoot, 'static-site/data/content.json'),
);
if (values['dry-run']) {
  const report = await importContentJson({
    db: undefined as never,
    eventSlug,
    sourceFile,
    repositoryRoot,
    dryRun: true,
    allowPublishedUpdate: values['allow-published-update'],
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error('DATABASE_URL is required unless --dry-run is used');
  const client = createDatabaseClient({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    applicationName: 'byzon-content-import',
    onUnexpectedError: (error) => {
      process.stderr.write(`Unexpected database error: ${String(error)}\n`);
    },
  });
  try {
    const report = await importContentJson({
      db: client.db,
      eventSlug,
      sourceFile,
      repositoryRoot,
      allowPublishedUpdate: values['allow-published-update'],
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await client.close();
  }
}
