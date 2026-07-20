import { describe, expect, it } from 'vitest';

import { generateUuidV7 } from './ids.js';

describe('UUIDv7 generation', () => {
  it('encodes the timestamp, version, and RFC variant', () => {
    const timestamp = 1_784_550_000_123;
    const uuid = generateUuidV7(
      timestamp,
      Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    );
    const hex = uuid.replaceAll('-', '');
    const decodedTimestamp = Number.parseInt(hex.slice(0, 12), 16);

    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(decodedTimestamp).toBe(timestamp);
  });

  it('rejects timestamps outside the 48-bit UUIDv7 range', () => {
    expect(() => generateUuidV7(-1)).toThrow(RangeError);
    expect(() => generateUuidV7(2 ** 48)).toThrow(RangeError);
  });
});
