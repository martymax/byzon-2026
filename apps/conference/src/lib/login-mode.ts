import { z } from 'zod';

export const loginModeSchema = z.enum(['identity', 'recovery', 'switch']);
export type LoginMode = z.infer<typeof loginModeSchema>;

export const resolveLoginMode = (
  value: string | string[] | undefined,
): LoginMode => {
  if (Array.isArray(value)) return 'identity';
  const parsed = loginModeSchema.safeParse(value ?? 'identity');
  return parsed.success ? parsed.data : 'identity';
};
