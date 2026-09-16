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
