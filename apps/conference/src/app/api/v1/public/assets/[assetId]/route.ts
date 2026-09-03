import { schema } from '@byzon/database';
import { and, eq, isNull } from 'drizzle-orm';

import { database } from '@/server/database';
import { readPublicAsset } from '@/server/public-assets';

export const GET = (
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> =>
  context.params.then(({ assetId }) =>
    readPublicAsset(assetId, async (id) => {
      const asset = await database.db.query.assets.findFirst({
        where: and(
          eq(schema.assets.id, id),
          eq(schema.assets.isPublic, true),
          eq(schema.assets.status, 'ready'),
          isNull(schema.assets.deletedAt),
        ),
        columns: { bucketKey: true, eventId: true },
      });
      return asset ?? null;
    }),
  );
