import { database } from '@/server/database';
import { readPublicContent } from '@/server/public-content';
export const GET = (
  request: Request,
  context: { params: Promise<{ slug: string }> },
) =>
  context.params.then(({ slug }) =>
    readPublicContent(request, slug, 'content', database.db),
  );
