import { handleCheckinRequest } from '@/server/checkin';
import { checkinRouteDependencies } from '@/server/checkin-route-dependencies';

export const POST = (request: Request) =>
  handleCheckinRequest(request, 'confirm', checkinRouteDependencies);
