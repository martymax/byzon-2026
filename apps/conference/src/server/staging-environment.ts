import { readConferenceEnv } from '@byzon/config';

export const isStagingEnvironment = (
  environment: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
): boolean => readConferenceEnv(environment).APP_ENV === 'staging';
