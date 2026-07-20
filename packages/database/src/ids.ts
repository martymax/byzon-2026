const UUID_V7_MAX_TIMESTAMP = 2 ** 48 - 1;

const hexByte = (value: number): string => value.toString(16).padStart(2, '0');

export const generateUuidV7 = (
  timestamp = Date.now(),
  random = crypto.getRandomValues(new Uint8Array(10)),
): string => {
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > UUID_V7_MAX_TIMESTAMP
  ) {
    throw new RangeError('UUIDv7 timestamp is outside the 48-bit range');
  }
  if (random.length !== 10) {
    throw new RangeError('UUIDv7 requires exactly 10 random bytes');
  }

  const bytes = new Uint8Array(16);
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Math.floor(timestamp / 2 ** ((5 - index) * 8)) & 0xff;
  }
  bytes.set(random, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = [...bytes].map(hexByte).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
