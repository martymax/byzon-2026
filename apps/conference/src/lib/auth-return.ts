import { activationReturnToSchema } from '@byzon/domain/contracts';

const adminReturnToValues = [
  '/admin',
  '/admin/audit',
  '/admin/interakce',
  '/admin/nastaveni',
  '/admin/obsah',
  '/admin/oznameni',
  '/admin/reporty',
  '/admin/rezervace',
  '/admin/role',
  '/admin/ucastnici',
  '/admin/vstupenky',
] as const;

export type AdminReturnTo = (typeof adminReturnToValues)[number];
export type AuthReturnTo =
  AdminReturnTo | import('@byzon/domain/contracts').ActivationReturnTo;

const adminReturnToSet = new Set<string>(adminReturnToValues);

export const resolveAuthReturnTo = (
  value: string | readonly string[] | undefined,
  fallback: AuthReturnTo = '/app',
): AuthReturnTo => {
  if (Array.isArray(value) || typeof value !== 'string') return fallback;
  if (adminReturnToSet.has(value)) return value as AdminReturnTo;
  const participant = activationReturnToSchema.safeParse(value);
  return participant.success ? participant.data : fallback;
};
