import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ActivationIdentity } from '@/components/activation-identity';
import { resolveActivationReturnTo } from '@/lib/activation-return';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Bezpečné přihlášení',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly returnTo?: string | string[] | undefined;
  }>;
}) {
  if (!isFrontendPreviewAvailable()) notFound();
  const query = await searchParams;
  return (
    <ActivationIdentity returnTo={resolveActivationReturnTo(query.returnTo)} />
  );
}
