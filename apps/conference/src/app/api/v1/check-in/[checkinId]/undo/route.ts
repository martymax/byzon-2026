import { handleCheckinRequest } from '@/server/checkin';
import { checkinRouteDependencies } from '@/server/checkin-route-dependencies';

export const POST = (
  request: Request,
  context: { params: Promise<{ checkinId: string }> },
) =>
  context.params.then(({ checkinId }) =>
    handleCheckinRequest(
      request,
      { undoCheckinId: checkinId },
      checkinRouteDependencies,
    ),
  );
