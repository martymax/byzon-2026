import pino from 'pino';
import { readBaseEnv } from '@byzon/config';

const env = readBaseEnv(process.env);

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: 'conference',
    environment: env.APP_ENV,
    release: env.RELEASE_SHA,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'request.headers.authorization',
      'request.headers.cookie',
      '*.email',
      '*.phone',
      '*.token',
      '*.code',
      '*.password',
      '*.secret',
      '*.message',
      '*.profile',
    ],
    censor: '[REDACTED]',
  },
});
