import type { Metadata } from 'next';
import {
  createNotificationEmail,
  notificationPayloadSchema,
} from '@byzon/mail';
import { ConferenceFeedbackDemo } from '@/components/conference-feedback';

export const metadata: Metadata = {
  title: 'Ukázka hodnocení konference',
  description:
    'Návrh e-mailu a interaktivní ukázka hodnocení BYZONu pro organizační tým.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ConferenceFeedbackDemoPage() {
  const origin = process.env.APP_BASE_URL ?? 'https://app.byzon.cz';
  const email = createNotificationEmail(
    notificationPayloadSchema.parse({
      kind: 'conference_feedback',
      eventName: 'BYZON 2026',
      timezone: 'Europe/Prague',
      feedbackId: '01940000-0000-7000-8000-000000000001',
      feedbackUrl: `${origin.replace(/\/$/, '')}/hodnoceni/demo#dotaznik`,
      reminder: false,
    }),
    {},
    origin,
  );
  return (
    <main id="main">
      <ConferenceFeedbackDemo
        emailHtml={email.html}
        emailSubject={email.subject}
      />
    </main>
  );
}
