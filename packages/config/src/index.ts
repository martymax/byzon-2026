import { z } from 'zod';

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']),
  APP_BASE_URL: z.url(),
  PUBLIC_SITE_URL: z.url(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  RELEASE_SHA: z.string().min(1).default('local'),
});

const workerEnvSchema = baseEnvSchema.extend({
  WORKER_CONCURRENCY_EMAIL: z.coerce.number().int().positive().default(2),
  WORKER_CONCURRENCY_DEFAULT: z.coerce.number().int().positive().default(4),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
const developmentDefaults = {
  NODE_ENV: 'development',
  APP_ENV: 'development',
  APP_BASE_URL: 'http://localhost:3000',
  PUBLIC_SITE_URL: 'http://localhost:8000',
} as const;

const withDevelopmentDefaults = (
  input: NodeJS.ProcessEnv | Record<string, unknown>,
) =>
  input.APP_ENV === 'staging' || input.APP_ENV === 'production'
    ? input
    : { ...developmentDefaults, ...input };

export const readBaseEnv = (
  input: NodeJS.ProcessEnv | Record<string, unknown>,
): BaseEnv => baseEnvSchema.parse(withDevelopmentDefaults(input));
export const readConferenceEnv = readBaseEnv;
export const readWorkerEnv = (
  input: NodeJS.ProcessEnv | Record<string, unknown>,
) => workerEnvSchema.parse(withDevelopmentDefaults(input));

// Výslovný allowlist; serverové proměnné se do klientského bundlu nekopírují.
export const clientEnv = Object.freeze({});
