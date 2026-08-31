import { parseArgs } from 'node:util';

import {
  AdminBootstrapError,
  bootstrapOrganizerAdmin,
} from './admin-bootstrap.js';
import { createDatabaseClient } from './client.js';

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      'create-user': { type: 'boolean', default: false },
      'event-slug': { type: 'string' },
      'user-email': { type: 'string' },
    },
    strict: true,
  });
  const eventSlug = values['event-slug'];
  const userEmail = values['user-email'];
  if (!eventSlug || !userEmail) {
    throw new AdminBootstrapError(
      'INVALID_INPUT',
      'Usage: db:bootstrap-admin --event-slug <slug> --user-email <email> [--create-user]',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new AdminBootstrapError(
      'INVALID_INPUT',
      'DATABASE_URL is required to bootstrap an organizer admin.',
    );
  }

  const client = createDatabaseClient({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    applicationName: 'byzon-admin-bootstrap-cli',
    onUnexpectedError: () => {
      process.stderr.write('Unexpected database pool error.\n');
    },
  });

  try {
    const result = await bootstrapOrganizerAdmin(client.db, {
      createUserIfMissing: values['create-user'],
      eventSlug,
      userEmail,
    });
    const auditSuffix = result.requestId
      ? `; audit request ${result.requestId}`
      : '';
    process.stdout.write(
      `Organizer admin bootstrap ${result.status} for event ID ${result.eventId}; user ${result.userCreated ? 'created' : 'existing'}${auditSuffix}.\n`,
    );
  } finally {
    await client.close();
  }
};

try {
  await main();
} catch (error) {
  const message =
    error instanceof AdminBootstrapError
      ? error.message
      : 'Organizer admin bootstrap failed unexpectedly.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
