import { describe, expect, it } from 'vitest';

import {
  defineTicketCodeNormalizer,
  ticketCodeDigestMatches,
  ticketCodeDigests,
} from './ticket-code.js';

const opaque = defineTicketCodeNormalizer('test-opaque-v1', (value) => value);
const eventId = '018f0000-0000-7000-8000-000000000001';
const activePepper = 'active-pepper-with-at-least-thirty-two-bytes';
const previousPepper = 'previous-pepper-with-at-least-thirty-two-bytes';

describe('ticket code HMAC infrastructure', () => {
  it('is deterministic, event-scoped and covered by a stable test vector', () => {
    const digest = ticketCodeDigests({
      eventId,
      rawCode: 'AbC-123 / ěšč',
      normalizer: opaque,
      activePepper,
    }).active;
    expect(digest).toBe(
      'f446bfbd1bc316006c84cf3886608338149d4ae96df6da660dcae968c09e68c0',
    );
    expect(
      ticketCodeDigests({
        eventId: '018f0000-0000-7000-8000-000000000002',
        rawCode: 'AbC-123 / ěšč',
        normalizer: opaque,
        activePepper,
      }).active,
    ).not.toBe(digest);
  });

  it('returns active and previous digests during rotation', () => {
    const digests = ticketCodeDigests({
      eventId,
      rawCode: 'ticket-1',
      normalizer: opaque,
      activePepper,
      previousPepper,
    });
    expect(digests.previous).toMatch(/^[0-9a-f]{64}$/);
    expect(digests.active).not.toBe(digests.previous);
  });

  it('does not silently trim, case-fold or rewrite an unknown code format', () => {
    expect(
      ticketCodeDigests({
        eventId,
        rawCode: ' ticket-1 ',
        normalizer: opaque,
        activePepper,
      }).active,
    ).not.toBe(
      ticketCodeDigests({
        eventId,
        rawCode: 'ticket-1',
        normalizer: opaque,
        activePepper,
      }).active,
    );
  });

  it('rejects weak peppers and invalid comparison values', () => {
    expect(() =>
      ticketCodeDigests({
        eventId,
        rawCode: 'ticket-1',
        normalizer: opaque,
        activePepper: 'short',
      }),
    ).toThrow(/at least 32/);
    expect(ticketCodeDigestMatches('not-a-digest', 'also-invalid')).toBe(false);
  });
});
