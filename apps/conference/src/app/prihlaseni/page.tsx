import type { Metadata } from 'next';

import { MagicLinkLogin } from '../../components/magic-link-login';
import { resolveAuthReturnTo } from '../../lib/auth-return';

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
  const query = await searchParams;
  return <MagicLinkLogin returnTo={resolveAuthReturnTo(query.returnTo)} />;
}
