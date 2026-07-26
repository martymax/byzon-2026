import Link from 'next/link';

import { OfflineExperience } from '@/components/offline-experience';

export const metadata = { title: 'Jste offline' };

export default function OfflinePage() {
  return (
    <>
      <OfflineExperience />
      <noscript>
        <section className="message-page">
          <p className="eyebrow">Bez připojení</p>
          <h1>Pro offline přehled je potřeba JavaScript.</h1>
          <Link className="button" href="/">
            Zpět na úvod
          </Link>
        </section>
      </noscript>
    </>
  );
}
