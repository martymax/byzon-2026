import { z } from 'zod';
const id = z.string().uuid();
const ids = z
  .array(id)
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length);
export const programAccessSelectionSchema = z.discriminatedUnion('preset', [
  z.strictObject({ preset: z.literal('coach'), roomId: id }),
  z.strictObject({
    preset: z.literal('activity_leader'),
    speakerProfileId: id,
  }),
  z.strictObject({ preset: z.literal('speaker'), speakerProfileId: id }),
  z.strictObject({ preset: z.literal('moderator'), sessionIds: ids }),
]);
export const programAccessPreviewRequestSchema = z.strictObject({
  participantId: id,
  selection: programAccessSelectionSchema,
  operation: z.enum(['apply', 'revoke']),
});
export const programAccessMutationSchema =
  programAccessPreviewRequestSchema.extend({
    expectedVersion: z.number().int().positive(),
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(8).max(500),
  });
export const programAccessPersonSchema = z.strictObject({
  participantId: id,
  displayName: z.string().min(1).max(257),
  maskedEmail: z.string().max(320),
  membershipStatus: z.enum(['active', 'suspended', 'revoked']),
  invitationStatus: z.enum(['not_sent', 'sent', 'accepted']),
  source: z.enum(['manual', 'simpleshop']),
  baselineReady: z.boolean(),
});
export const programAccessSearchSchema = z.strictObject({
  query: z.string().trim().min(2).max(120),
});
export const programAccessSearchResponseSchema = z.strictObject({
  eventId: id,
  items: z.array(programAccessPersonSchema).max(20),
});
export const programAccessOptionsSchema = z.strictObject({
  eventId: id,
  speakers: z
    .array(
      z.strictObject({ id, name: z.string(), linkedUserId: id.nullable() }),
    )
    .max(300),
  rooms: z.array(z.strictObject({ id, name: z.string() })).max(100),
  sessions: z
    .array(
      z.strictObject({
        id,
        title: z.string(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        roomName: z.string().nullable(),
      }),
    )
    .max(300),
});
export const programAccessRoleSchema = z.strictObject({
  role: z.enum(['speaker', 'room_operator', 'moderator']),
  sessionIds: z.array(id).max(100),
  roomIds: z.array(id).max(100),
  revoke: z.boolean(),
});
export const programAccessPreviewSchema = z.strictObject({
  eventId: id,
  participant: programAccessPersonSchema,
  assignmentsVersion: z.number().int().positive(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  roles: z.array(programAccessRoleSchema).max(3),
  sessions: z
    .array(
      z.strictObject({
        id,
        title: z.string(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        roomName: z.string().nullable(),
      }),
    )
    .max(100),
  speakerProfileId: id.nullable(),
  speakerVersion: z.number().int().positive().nullable(),
  operation: z.enum(['apply', 'revoke']),
});
export const programAccessMutationResponseSchema = z.strictObject({
  eventId: id,
  assignmentsVersion: z.number().int().positive(),
  outcome: z.enum(['applied', 'revoked']),
  auditId: id,
});
export type ProgramAccessSelection = z.infer<
  typeof programAccessSelectionSchema
>;
export type ProgramAccessPreviewRequest = z.infer<
  typeof programAccessPreviewRequestSchema
>;
export type ProgramAccessPreview = z.infer<typeof programAccessPreviewSchema>;
export type ProgramAccessOptions = z.infer<typeof programAccessOptionsSchema>;
export type ProgramAccessPerson = z.infer<typeof programAccessPersonSchema>;
