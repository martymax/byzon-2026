import { z } from 'zod';

const redisFamilySchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value.length > 0 ? Number(value) : value,
  z.union([z.literal(0), z.literal(4), z.literal(6)]),
);

const redisUrlSchema = z.string().refine((value) => {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'redis:' || parsed.protocol === 'rediss:') &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}, 'REDIS_URL must be a Redis URL');

const railwayPlaceholderToUndefined = (value: unknown): unknown =>
  value === '' || value === '__FILL_IN_RAILWAY__' ? undefined : value;

const optionalMailValue = (maximum: number) =>
  z.preprocess(
    railwayPlaceholderToUndefined,
    z
      .string()
      .min(1)
      .max(maximum)
      .refine(
        (value) => !/[\r\n\u0000]/.test(value),
        'Mail configuration contains unsafe control characters',
      )
      .optional(),
  );

const optionalMailUrl = z.preprocess(
  railwayPlaceholderToUndefined,
  z
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    }, 'Mail API URL must use HTTP or HTTPS')
    .optional(),
);

const mailEnvSchema = {
  MAIL_PROVIDER: z.preprocess(
    railwayPlaceholderToUndefined,
    z.enum(['sink', 'resend', 'mailpit']).optional(),
  ),
  MAIL_API_KEY: optionalMailValue(1_024),
  MAILPIT_API_URL: optionalMailUrl,
  MAILPIT_API_USERNAME: optionalMailValue(128),
  MAILPIT_API_PASSWORD: optionalMailValue(1_024),
  MAIL_FROM: optionalMailValue(320),
  MAIL_REPLY_TO: optionalMailValue(320),
} as const;

const validateMailEnvironment = (
  value: {
    readonly APP_ENV: 'development' | 'test' | 'staging' | 'production';
    readonly MAIL_PROVIDER?: 'sink' | 'resend' | 'mailpit' | undefined;
    readonly MAIL_API_KEY?: string | undefined;
    readonly MAILPIT_API_URL?: string | undefined;
    readonly MAILPIT_API_USERNAME?: string | undefined;
    readonly MAILPIT_API_PASSWORD?: string | undefined;
    readonly MAIL_FROM?: string | undefined;
    readonly MAIL_REPLY_TO?: string | undefined;
  },
  context: z.RefinementCtx,
) => {
  const mailValues = [
    value.MAIL_API_KEY,
    value.MAILPIT_API_URL,
    value.MAILPIT_API_USERNAME,
    value.MAILPIT_API_PASSWORD,
    value.MAIL_FROM,
    value.MAIL_REPLY_TO,
  ];
  if (
    value.MAIL_PROVIDER === undefined &&
    mailValues.some((candidate) => candidate !== undefined)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['MAIL_PROVIDER'],
      message: 'MAIL_PROVIDER is required when mail settings are present',
    });
  }
  if (
    value.MAIL_PROVIDER === 'resend' &&
    [value.MAIL_API_KEY, value.MAIL_FROM, value.MAIL_REPLY_TO].some(
      (candidate) => candidate === undefined,
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['MAIL_PROVIDER'],
      message: 'Resend requires MAIL_API_KEY, MAIL_FROM and MAIL_REPLY_TO',
    });
  }
  if (
    value.MAIL_PROVIDER === 'mailpit' &&
    [
      value.MAILPIT_API_URL,
      value.MAILPIT_API_USERNAME,
      value.MAILPIT_API_PASSWORD,
      value.MAIL_FROM,
      value.MAIL_REPLY_TO,
    ].some((candidate) => candidate === undefined)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['MAIL_PROVIDER'],
      message:
        'Mailpit requires MAILPIT_API_URL, MAILPIT_API_USERNAME, MAILPIT_API_PASSWORD, MAIL_FROM and MAIL_REPLY_TO',
    });
  }
  if (value.MAIL_PROVIDER === 'mailpit' && value.APP_ENV !== 'staging') {
    context.addIssue({
      code: 'custom',
      path: ['MAIL_PROVIDER'],
      message: 'Mailpit is restricted to the staging environment',
    });
  }
  if (
    value.MAIL_PROVIDER === 'sink' &&
    (value.APP_ENV === 'staging' || value.APP_ENV === 'production')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['MAIL_PROVIDER'],
      message: 'The in-memory mail sink is forbidden outside dev/test',
    });
  }
};

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']),
  APP_BASE_URL: z.url(),
  PUBLIC_SITE_URL: z.url(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  RELEASE_SHA: z.string().min(1).default('local'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(?:ql)?:\/\//, 'DATABASE_URL must be a PostgreSQL URL'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(50).default(10),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),
  REDIS_URL: redisUrlSchema,
  REDIS_FAMILY: redisFamilySchema.default(0),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(30_000)
    .default(3_000),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(30_000)
    .default(2_000),
});

const workerEnvSchema = baseEnvSchema
  .extend({
    ...mailEnvSchema,
    WORKER_CONCURRENCY_EMAIL: z.coerce.number().int().positive().default(2),
    WORKER_CONCURRENCY_DEFAULT: z.coerce.number().int().positive().default(4),
  })
  .superRefine(validateMailEnvironment);

const conferenceEnvSchema = baseEnvSchema
  .extend({
    ...mailEnvSchema,
    BETTER_AUTH_SECRET: z.string().min(32),
    RATE_LIMIT_SUBJECT_SECRET: z.string().min(32),
    SIMPLESHOP_API_EMAIL: z.email().max(320).optional(),
    SIMPLESHOP_API_KEY: z.string().min(1).max(1_024).optional(),
    SIMPLESHOP_API_BASE_URL: z.url().optional(),
    CHECKIN_DEVICE_ID: z.uuid().optional(),
  })
  .superRefine((value, context) => {
    validateMailEnvironment(value, context);
    if (
      (value.SIMPLESHOP_API_EMAIL === undefined) !==
      (value.SIMPLESHOP_API_KEY === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SIMPLESHOP_API_EMAIL'],
        message: 'SimpleShop API credentials must be configured together',
      });
    }
    if (
      value.SIMPLESHOP_API_BASE_URL !== undefined &&
      (value.APP_ENV === 'staging' || value.APP_ENV === 'production')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SIMPLESHOP_API_BASE_URL'],
        message: 'SimpleShop API base URL override is test-only',
      });
    }
  });

export type BaseEnv = z.infer<typeof baseEnvSchema>;
const developmentDefaults = {
  NODE_ENV: 'development',
  APP_ENV: 'development',
  APP_BASE_URL: 'http://localhost:3000',
  PUBLIC_SITE_URL: 'http://localhost:8000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/byzon',
  REDIS_URL: 'redis://127.0.0.1:6379',
  BETTER_AUTH_SECRET: 'local-only-better-auth-secret-change-me',
  RATE_LIMIT_SUBJECT_SECRET: 'local-only-rate-limit-subject-secret-change-me',
} as const;

const withDevelopmentDefaults = (
  input: NodeJS.ProcessEnv | Record<string, unknown>,
) => {
  const withDefaults =
    input.APP_ENV === 'staging' || input.APP_ENV === 'production'
      ? input
      : { ...developmentDefaults, ...input };

  const explicitRelease =
    typeof input.RELEASE_SHA === 'string' && input.RELEASE_SHA.length > 0
      ? input.RELEASE_SHA
      : undefined;
  const railwayRelease =
    typeof input.RAILWAY_GIT_COMMIT_SHA === 'string' &&
    input.RAILWAY_GIT_COMMIT_SHA.length > 0
      ? input.RAILWAY_GIT_COMMIT_SHA
      : undefined;

  return {
    ...withDefaults,
    RELEASE_SHA: explicitRelease ?? railwayRelease ?? withDefaults.RELEASE_SHA,
  };
};

export const readBaseEnv = (
  input: NodeJS.ProcessEnv | Record<string, unknown>,
): BaseEnv => baseEnvSchema.parse(withDevelopmentDefaults(input));
export const readConferenceEnv = (
  input: NodeJS.ProcessEnv | Record<string, unknown>,
) => conferenceEnvSchema.parse(withDevelopmentDefaults(input));
export const readWorkerEnv = (
  input: NodeJS.ProcessEnv | Record<string, unknown>,
) => workerEnvSchema.parse(withDevelopmentDefaults(input));

// Výslovný allowlist; serverové proměnné se do klientského bundlu nekopírují.
export const clientEnv = Object.freeze({});
