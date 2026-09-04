import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { z } from 'zod';

export const AGENDA_CALENDAR_TICKET_TTL_MS = 60_000;

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_SECRET_BYTES = 32;
const MAX_TOKEN_LENGTH = 1_024;
const CLOCK_SKEW_MS = 5_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const KEY_SALT = Buffer.from('byzon-2026-calendar-download-ticket', 'utf8');
const KEY_INFO = Buffer.from('agenda-calendar-ticket-v1', 'utf8');
const AUTHENTICATED_CONTEXT = Buffer.from(
  'byzon-2026:agenda-calendar-ticket:v1',
  'utf8',
);

const uuidSchema = z.string().uuid();
const safePositiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const ticketPayloadSchema = z.strictObject({
  formatVersion: z.literal(FORMAT_VERSION),
  purpose: z.literal('agenda-calendar-download'),
  userId: uuidSchema,
  eventId: uuidSchema,
  agendaVersion: safePositiveIntegerSchema,
  publicationVersion: safePositiveIntegerSchema,
  issuedAt: safePositiveIntegerSchema,
  expiresAt: safePositiveIntegerSchema,
});

export type AgendaCalendarTicketClaims = Pick<
  z.infer<typeof ticketPayloadSchema>,
  'agendaVersion' | 'eventId' | 'publicationVersion' | 'userId'
>;

interface IssueAgendaCalendarTicketInput extends AgendaCalendarTicketClaims {
  now: Date;
  secret: string;
}

interface ReadAgendaCalendarTicketInput {
  now: Date;
  secret: string;
  token: string;
}

const requireSecret = (secret: string): void => {
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw new TypeError('Agenda calendar ticket secret is too short');
  }
};

const ticketKey = (secret: string): Buffer => {
  requireSecret(secret);
  return Buffer.from(hkdfSync('sha256', secret, KEY_SALT, KEY_INFO, 32));
};

export const issueAgendaCalendarTicket = (
  input: IssueAgendaCalendarTicketInput,
): string => {
  const issuedAt = input.now.getTime();
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) {
    throw new TypeError('Agenda calendar ticket time is invalid');
  }
  const payload = ticketPayloadSchema.parse({
    formatVersion: FORMAT_VERSION,
    purpose: 'agenda-calendar-download',
    userId: input.userId,
    eventId: input.eventId,
    agendaVersion: input.agendaVersion,
    publicationVersion: input.publicationVersion,
    issuedAt,
    expiresAt: issuedAt + AGENDA_CALENDAR_TICKET_TTL_MS,
  });
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', ticketKey(input.secret), iv);
  cipher.setAAD(AUTHENTICATED_CONTEXT);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    'base64url',
  );
};

export const readAgendaCalendarTicket = (
  input: ReadAgendaCalendarTicketInput,
): AgendaCalendarTicketClaims | null => {
  if (
    input.token.length === 0 ||
    input.token.length > MAX_TOKEN_LENGTH ||
    !TOKEN_PATTERN.test(input.token)
  ) {
    return null;
  }
  const now = input.now.getTime();
  if (!Number.isSafeInteger(now) || now <= 0) return null;

  try {
    const sealed = Buffer.from(input.token, 'base64url');
    if (sealed.length <= IV_BYTES + TAG_BYTES) return null;
    const iv = sealed.subarray(0, IV_BYTES);
    const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = sealed.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      ticketKey(input.secret),
      iv,
    );
    decipher.setAAD(AUTHENTICATED_CONTEXT);
    decipher.setAuthTag(tag);
    const payload = ticketPayloadSchema.parse(
      JSON.parse(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
          'utf8',
        ),
      ),
    );
    if (
      payload.expiresAt - payload.issuedAt !== AGENDA_CALENDAR_TICKET_TTL_MS ||
      payload.issuedAt > now + CLOCK_SKEW_MS ||
      payload.expiresAt <= now
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      eventId: payload.eventId,
      agendaVersion: payload.agendaVersion,
      publicationVersion: payload.publicationVersion,
    };
  } catch {
    return null;
  }
};
