import { createHmac, timingSafeEqual } from 'node:crypto';

declare const normalizedTicketCodeBrand: unique symbol;
export type NormalizedTicketCode = string & {
  readonly [normalizedTicketCodeBrand]: true;
};

export interface TicketCodeNormalizer {
  readonly id: string;
  normalize(rawCode: string): NormalizedTicketCode;
}

export interface TicketCodeDigests {
  active: string;
  previous?: string;
}

const assertPepper = (pepper: string) => {
  if (Buffer.byteLength(pepper, 'utf8') < 32)
    throw new Error(
      'Ticket-code peppers must contain at least 32 UTF-8 bytes.',
    );
};

export const defineTicketCodeNormalizer = (
  id: string,
  normalize: (rawCode: string) => string,
): TicketCodeNormalizer => {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id))
    throw new Error('Ticket-code normalizer id is invalid.');

  return {
    id,
    normalize(rawCode) {
      const normalized = normalize(rawCode);
      const byteLength = Buffer.byteLength(normalized, 'utf8');
      if (byteLength === 0 || byteLength > 512)
        throw new Error('Normalized ticket code must contain 1 to 512 bytes.');
      return normalized as NormalizedTicketCode;
    },
  };
};

export const hmacTicketCode = (
  eventId: string,
  normalizerId: string,
  code: NormalizedTicketCode,
  pepper: string,
) => {
  assertPepper(pepper);
  return createHmac('sha256', pepper)
    .update('byzon-ticket-code\0', 'utf8')
    .update(eventId, 'utf8')
    .update('\0', 'utf8')
    .update(normalizerId, 'utf8')
    .update('\0', 'utf8')
    .update(code, 'utf8')
    .digest('hex');
};

export const ticketCodeDigests = (input: {
  eventId: string;
  rawCode: string;
  normalizer: TicketCodeNormalizer;
  activePepper: string;
  previousPepper?: string;
}): TicketCodeDigests => {
  const code = input.normalizer.normalize(input.rawCode);
  return {
    active: hmacTicketCode(
      input.eventId,
      input.normalizer.id,
      code,
      input.activePepper,
    ),
    ...(input.previousPepper
      ? {
          previous: hmacTicketCode(
            input.eventId,
            input.normalizer.id,
            code,
            input.previousPepper,
          ),
        }
      : {}),
  };
};

export const ticketCodeDigestMatches = (left: string, right: string) => {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right))
    return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};
