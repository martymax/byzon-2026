import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  AccessProblem,
  type AccessProblemKind,
} from '@/components/access-problem';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: 'Přístup není dostupný',
  robots: { index: false, follow: false },
};

const accessKinds = {
  zrusen: 'revoked',
  zakazano: 'forbidden',
  'vyprsele-prihlaseni': 'session_expired',
} as const satisfies Record<string, AccessProblemKind>;

export default async function AccessProblemVariantPage({
  params,
}: {
  readonly params: Promise<{ readonly kind: string }>;
}) {
  if (!isFrontendPreviewAvailable()) notFound();
  const { kind } = await params;
  if (!Object.hasOwn(accessKinds, kind)) notFound();
  return <AccessProblem kind={accessKinds[kind as keyof typeof accessKinds]} />;
}
