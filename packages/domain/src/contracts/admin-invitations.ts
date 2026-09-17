import { z } from 'zod';

export const adminInvitationRoleSchema = z.enum([
  'participant',
  'speaker',
  'room_operator',
  'moderator',
  'organizer_admin',
  'checkin_operator',
]);
export type AdminInvitationRole = z.infer<typeof adminInvitationRoleSchema>;

export const adminInvitationRecipientSchema = z.strictObject({
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(257),
  email: z.string().email().max(320),
  roles: z.array(adminInvitationRoleSchema).min(1).max(6),
  invitation: z.strictObject({
    status: z.enum(['not_sent', 'sent', 'accepted']),
    lastSentAt: z.string().datetime().nullable(),
  }),
  delivery: z.enum(['participant', 'team']).nullable(),
});
export type AdminInvitationRecipient = z.infer<
  typeof adminInvitationRecipientSchema
>;

export const adminInvitationRecipientsSchema = z.strictObject({
  eventId: z.string().uuid(),
  items: z.array(adminInvitationRecipientSchema).max(200),
  nextCursor: z.string().uuid().nullable(),
});
export type AdminInvitationRecipients = z.infer<
  typeof adminInvitationRecipientsSchema
>;

export const createInvitationBatchSchema = z.strictObject({
  userIds: z
    .array(z.string().uuid())
    .min(1)
    .max(5000)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const invitationBatchCreatedSchema = z.strictObject({
  eventId: z.string().uuid(),
  batchId: z.string().uuid().nullable(),
  queued: z.number().int().nonnegative(),
  alreadyQueued: z.number().int().nonnegative(),
});
export const invitationBatchSchema = z.strictObject({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failedUserIds: z.array(z.string().uuid()).max(5000),
});
export type InvitationBatch = z.infer<typeof invitationBatchSchema>;
export const invitationBatchesSchema = z.strictObject({
  eventId: z.string().uuid(),
  batches: z.array(invitationBatchSchema).max(30),
  queuedUserIds: z.array(z.string().uuid()),
});
