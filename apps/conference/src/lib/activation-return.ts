import {
  activationReturnToSchema,
  type ActivationReturnTo,
} from '@byzon/domain/contracts';

export type { ActivationReturnTo } from '@byzon/domain/contracts';

export const resolveActivationReturnTo = (
  value: string | readonly string[] | undefined,
  fallback: ActivationReturnTo = '/onboarding',
): ActivationReturnTo => {
  if (Array.isArray(value)) return fallback;
  const parsed = activationReturnToSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
};
