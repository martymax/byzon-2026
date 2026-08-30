import { readConferenceEnv } from '@byzon/config';

import { auth } from './auth';
import { checkinRateLimit } from './checkin-rate-limit';
import { database } from './database';

const env = readConferenceEnv(process.env);

export const checkinRouteDependencies = {
  db: database.db,
  ...(env.CHECKIN_DEVICE_ID ? { deviceId: env.CHECKIN_DEVICE_ID } : {}),
  getSession: (headers: Headers) => auth.api.getSession({ headers }),
  rateLimit: checkinRateLimit,
};
