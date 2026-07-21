import { eq } from 'drizzle-orm';
import { schema } from '@byzon/database';

import { database } from './database';

export const CURRENT_EVENT_SLUG = 'byzon-2026';

export const loadCurrentEventId = async (): Promise<string | null> => {
  const event = await database.db.query.events.findFirst({
    where: eq(schema.events.slug, CURRENT_EVENT_SLUG),
    columns: { id: true },
  });
  return event?.id ?? null;
};
