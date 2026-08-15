import type { ActivationReturnTo } from '@byzon/domain/contracts';

import { createMockRecoveryLinkToken } from './mock-recovery-link';

interface SentPreview {
  readonly href: string;
  readonly actionLabel: string;
  readonly description: string;
}

const runtimeMockToken = (): string => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `link:${suffix}`;
};

export const createRecoverySentPreview = (
  destination: ActivationReturnTo,
  isLogin: boolean,
): SentPreview => ({
  href: `/aktivace/odkaz#token=${encodeURIComponent(
    createMockRecoveryLinkToken(destination),
  )}`,
  actionLabel: isLogin
    ? 'Otevřít syntetický odkaz pro přihlášení'
    : 'Otevřít syntetický odkaz pro obnovu',
  description:
    'Odpověď je stejná pro existující i neexistující účet. V mock režimu můžete použít syntetický odkaz; nevzniklo skutečné přihlášení ani účast na akci.',
});

export const createActivationIdentitySentPreview = (): SentPreview => ({
  href: `/aktivace/odkaz#token=${encodeURIComponent(runtimeMockToken())}`,
  actionLabel: 'Otevřít syntetický jednorázový odkaz',
  description:
    'Stejnou zprávu ukazujeme bez ohledu na existenci účtu. V mock režimu můžete použít syntetický odkaz výše; nevzniklo skutečné přihlášení ani účast na akci.',
});
