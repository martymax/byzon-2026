import type { Metadata } from 'next';

import { MagicLinkLogin } from '../components/magic-link-login';
import {
  POST_LOGIN_DESTINATION,
  resolveAuthReturnTo,
} from '../lib/auth-return';

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
    <MagicLinkLogin
      returnTo={resolveAuthReturnTo(query?.returnTo, POST_LOGIN_DESTINATION)}
    />
  );
}
