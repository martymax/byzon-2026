import type { Metadata } from 'next';
import { ConferenceFeedback } from '@/components/conference-feedback';

export const metadata: Metadata = {
  title: 'Jaký byl váš BYZON?',
  description:
    'Vaše zkušenost nám pomůže připravit lepší BYZON. Hodnocení bez přihlašování.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function ConferenceFeedbackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main id="main">
      <ConferenceFeedback token={token} />
    </main>
  );
}
