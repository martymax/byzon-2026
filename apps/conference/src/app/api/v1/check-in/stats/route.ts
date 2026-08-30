import { handleCheckinRequest } from '@/server/checkin';
import { checkinRouteDependencies } from '@/server/checkin-route-dependencies';

export const GET = (request: Request) =>
  handleCheckinRequest(request, 'stats', checkinRouteDependencies);
