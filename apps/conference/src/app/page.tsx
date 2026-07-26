import type { Metadata } from 'next';

import { LoginFlow } from '@/components/login-flow';

export const metadata: Metadata = {
  title: 'Přihlášení',
  robots: { index: false, follow: false },
};

export default function HomePage() {
  return <LoginFlow mode="recovery" presentation="login" returnTo="/app" />;
}
