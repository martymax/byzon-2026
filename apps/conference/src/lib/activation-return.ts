import { activationReturnToSchema } from '@byzon/domain/contracts';

export type ActivationReturnTo = '/app' | '/onboarding';

export const resolveActivationReturnTo = (
  value: string | readonly string[] | undefined,
): ActivationReturnTo => {
  if (Array.isArray(value)) return '/onboarding';
  const parsed = activationReturnToSchema.safeParse(value);
  return parsed.success ? parsed.data : '/onboarding';
};
