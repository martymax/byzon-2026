import {
  activationReturnToSchema,
  type ActivationReturnTo,
} from '@byzon/domain/contracts';

const mockLinkNoncePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const createMockLinkNonce = (): string => {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
};

const encodeCanonicalBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
};

/**
 * Builds development-only recovery tokens. The opaque UUID keeps legacy mock
 * links working; a canonical base64url payload carries only a contract-valid
 * nested route and is revalidated by the mock API handler before use.
 */
export const createMockRecoveryLinkToken = (
  destination: ActivationReturnTo,
  nonce = createMockLinkNonce(),
): string => {
  const parsedDestination = activationReturnToSchema.parse(destination);
  if (!mockLinkNoncePattern.test(nonce)) {
    throw new TypeError('Mock recovery link nonce must be a canonical UUID.');
  }

  if (parsedDestination === '/onboarding') {
    return `recovery-onboarding:${nonce}`;
  }
  if (parsedDestination === '/app') {
    return `recovery-app:${nonce}`;
  }

  return `recovery-route:${encodeCanonicalBase64Url(parsedDestination)}:${nonce}`;
};
