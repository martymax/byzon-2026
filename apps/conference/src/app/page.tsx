import type { Metadata } from 'next';

import { MagicLinkLogin } from '../components/magic-link-login';
import { resolveAuthReturnTo } from '../lib/auth-return';

export const metadata: Metadata = {
  title: 'Přihlášení',
  robots: { index: false, follow: false },
};

export default async function HomePage({
  searchParams,
}: {
  readonly searchParams?: Promise<{
    readonly returnTo?: string | string[] | undefined;
  }>;
}) {
  const query = searchParams ? await searchParams : undefined;
  return (
    <MagicLinkLogin returnTo={resolveAuthReturnTo(query?.returnTo, '/app')} />
  );
}
