import { and, eq } from 'drizzle-orm';

import { createDatabaseClient } from './client.js';
import { generateUuidV7 } from './ids.js';
import { schema } from './index.js';

const readArgument = (name: string): string => {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  if (!value || value.length <= prefix.length) {
    throw new Error(`Missing ${prefix}<value>`);
  }
  return value.slice(prefix.length);
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const eventSlug = readArgument('event');
const stationName = readArgument('station');
const deviceLabel = readArgument('label');
if (stationName.length > 120 || deviceLabel.length > 120) {
  throw new Error('Station and device labels must have at most 120 characters');
}

const client = createDatabaseClient({
  connectionString: databaseUrl,
  max: 1,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 5_000,
  applicationName: 'byzon-provision-checkin-device',
  onUnexpectedError: (error) => process.stderr.write(`${error.name}\n`),
});

try {
  const result = await client.db.transaction(async (transaction) => {
    const event = await transaction.query.events.findFirst({
      columns: { id: true },
      where: eq(schema.events.slug, eventSlug),
    });
    if (!event) throw new Error('Event was not found');

    let station = await transaction.query.checkinStations.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.checkinStations.eventId, event.id),
        eq(schema.checkinStations.name, stationName),
      ),
    });
    if (!station) {
      const id = generateUuidV7();
      await transaction.insert(schema.checkinStations).values({
        id,
        eventId: event.id,
        name: stationName,
      });
      station = { id };
    }

    const deviceId = generateUuidV7();
    await transaction.insert(schema.operatorDevices).values({
      id: deviceId,
      eventId: event.id,
      stationId: station.id,
      label: deviceLabel,
      state: 'trusted',
    });
    return { deviceId, stationId: station.id };
  });
  process.stdout.write(
    `CHECKIN_DEVICE_ID=${result.deviceId}\nstation_id=${result.stationId}\n`,
  );
} finally {
  await client.close();
}
