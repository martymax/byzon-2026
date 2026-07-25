import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ActivationIdentity } from '@/components/activation-identity';
import { RecoveryForm } from '@/components/recovery-form';
import { resolveActivationReturnTo } from '@/lib/activation-return';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { resolveLoginMode } from '@/lib/login-mode';

export const metadata: Metadata = {
  title: 'Bezpečné přihlášení',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly returnTo?: string | string[] | undefined;
    readonly mode?: string | string[] | undefined;
  }>;
}) {
  if (!isFrontendPreviewAvailable()) notFound();
  const query = await searchParams;
  const mode = resolveLoginMode(query.mode);
  const returnTo = resolveActivationReturnTo(
    query.returnTo,
    mode === 'identity' ? '/onboarding' : '/app',
  );
  if (mode === 'recovery' || mode === 'switch') {
    return <RecoveryForm mode={mode} returnTo={returnTo} />;
  }
  return <ActivationIdentity returnTo={returnTo} />;
}
