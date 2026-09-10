import type { Metadata } from 'next';

import { MagicLinkLogin } from '../../components/magic-link-login';
import {
  POST_LOGIN_DESTINATION,
  resolveAuthReturnTo,
} from '../../lib/auth-return';
import { isStagingEnvironment } from '../../server/staging-environment';

export const metadata: Metadata = {
  title: 'Bezpečné přihlášení',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly error?: string | string[] | undefined;
    readonly mode?: string | string[] | undefined;
    readonly returnTo?: string | string[] | undefined;
  }>;
}) {
  const query = await searchParams;
  return (
    <MagicLinkLogin
      {...(isStagingEnvironment(process.env) ? { directEmailLogin: true } : {})}
      {...(query.error === 'INVALID_TOKEN' ? { invalidLink: true } : {})}
      {...(query.mode === 'recovery' ? { recovery: true } : {})}
      returnTo={resolveAuthReturnTo(query.returnTo, POST_LOGIN_DESTINATION)}
    />
  );
}
