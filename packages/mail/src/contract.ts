import { z } from 'zod';

export const ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS = 24 * 60 * 60;
export const LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS = 30 * 60;
export type AuthEmailPurpose =
  | 'sign-in'
  | 'account-activation'
  | 'participant-invitation'
  | 'team-invitation';
export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}
export interface EmailRecipient {
  firstName?: string | null;
  emailSalutation?: string | null;
}
export interface AuthEmailInput extends EmailRecipient {
  purpose: AuthEmailPurpose;
  url: string;
  appOrigin: string;
  expiresInSeconds: number;
}
const inline = (length: number) =>
  z
    .string()
    .min(1)
    .max(length)
    .refine((s) => !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(s));
export const notificationKindSchema = z.enum([
  'reservation_confirmed',
  'reservation_cancelled',
  'waitlist_joined',
  'waitlist_left',
  'waitlist_promoted',
  'program_changed',
  'announcement',
  'rating_reminder',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;
export const notificationSessionSchema = z.object({
  id: z.uuid(),
  title: inline(512),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  room: inline(512).nullable(),
  cancelled: z.boolean().default(false),
  previous: z
    .object({
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
      room: inline(512).nullable(),
    })
    .optional(),
});
export type NotificationSession = z.infer<typeof notificationSessionSchema>;
/** Public event content only. Recipient details are resolved and checked at delivery. */
export const notificationPayloadSchema = z
  .object({
    kind: notificationKindSchema,
    eventName: inline(200),
    timezone: z
      .string()
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('cs', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
    sessions: z.array(notificationSessionSchema).max(20).default([]),
    totalChanges: z.number().int().min(0).optional(),
    reservationId: z.uuid().optional(),
    waitlistEntryId: z.uuid().optional(),
    sessionId: z.uuid().optional(),
    announcementId: z.uuid().optional(),
    title: inline(160).optional(),
    body: z.string().max(12_000).optional(),
    cancelledByOrganizer: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (
      [
        'reservation_confirmed',
        'reservation_cancelled',
        'waitlist_promoted',
      ].includes(value.kind) &&
      !value.reservationId
    )
      context.addIssue({
        code: 'custom',
        path: ['reservationId'],
        message: 'Reservation identity is required',
      });
    if (
      ['waitlist_joined', 'waitlist_left'].includes(value.kind) &&
      !value.waitlistEntryId
    )
      context.addIssue({
        code: 'custom',
        path: ['waitlistEntryId'],
        message: 'Waitlist identity is required',
      });
    if (
      value.kind === 'announcement' &&
      (!value.announcementId || !value.title || !value.body)
    )
      context.addIssue({
        code: 'custom',
        path: ['announcementId'],
        message: 'Announcement content is required',
      });
  });
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;
