import { eq } from 'drizzle-orm';
import {
  schema,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';

import { ApiProblemError } from './api/problem';

type EventStatusDatabase = Pick<Database | DatabaseTransaction, 'query'>;

export const requireWritableAdminEvent = async (
  db: EventStatusDatabase,
  eventId: string,
): Promise<void> => {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: { status: true },
  });
  if (!event)
    throw new ApiProblemError({
      status: 404,
      code: 'CONTENT_NOT_FOUND',
      title: 'Content not found',
      detail: 'The content resource is not available.',
    });
  if (event.status === 'archived')
    throw new ApiProblemError({
      status: 409,
      code: 'ADMIN_INVALID_TRANSITION',
      title: 'Archived event is read-only',
      detail: 'Archived events are read-only.',
    });
};
