import { z } from 'zod';

export const adminEmailKindSchema = z.enum([
  'sign-in',
  'account-activation',
  'participant-invitation',
  'team-invitation',
  'reservation_confirmed',
  'reservation_cancelled',
  'waitlist_joined',
  'waitlist_left',
  'waitlist_promoted',
  'program_changed',
  'announcement',
  'rating_reminder',
]);
export type AdminEmailKind = z.infer<typeof adminEmailKindSchema>;
export const adminEmailQuerySchema = z.strictObject({
  search: z.string().trim().max(200).optional(),
  kind: adminEmailKindSchema.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type AdminEmailQuery = z.infer<typeof adminEmailQuerySchema>;
export const adminEmailSummarySchema = z.strictObject({
  id: z.uuid(),
  eventId: z.uuid(),
  kind: adminEmailKindSchema,
  recipient: z.string().nullable(),
  subject: z.string().nullable(),
  sentAt: z.iso.datetime({ offset: true }),
  contentAvailable: z.boolean(),
});
export type AdminEmailSummary = z.infer<typeof adminEmailSummarySchema>;
export const adminEmailListSchema = z.strictObject({
  eventId: z.uuid(),
  items: z.array(adminEmailSummarySchema).max(50),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});
export const adminEmailDetailSchema = adminEmailSummarySchema.extend({
  sender: z.string().nullable(),
  html: z.string().nullable(),
  text: z.string().nullable(),
  authLinkRedacted: z.boolean(),
});
export type AdminEmailDetail = z.infer<typeof adminEmailDetailSchema>;
