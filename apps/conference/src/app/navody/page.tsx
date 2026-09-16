import { GuideScreenshot } from '../../components/guide-screenshot';
import type { Metadata } from 'next';
import Link from 'next/link';
import { guidePath, roleGuides } from '@byzon/mail/guides';
import { gettingStarted, guideFaqs } from '../../lib/public-guides';
import styles from './navody.module.css';

export const metadata: Metadata = {
  title: 'Návody k aplikaci',
  description:
    'Veřejné návody BYZON pro účastníky, moderátory, řečníky, vedoucí aktivit a organizátory. Bez přihlášení.',
  alternates: { canonical: 'https://app.byzon.cz/navody' },
};

export default function GuidesPage() {
  return (
    <>
      <header className={styles.heading}>
        <h1 data-route-heading tabIndex={-1}>
          Váš průvodce
          <br />
          <span>aplikací BYZON.</span>
        </h1>
        <p>
          Vyberte svou roli a připravte se na konferenci. Od první rezervace po
          poslední otázku z publika.
        </p>
        <p className={styles.publicNote}>
          Všechny návody jsou dostupné bez přihlášení. Odkaz můžete sdílet i
          uložit na později.
        </p>
      </header>
      <section aria-labelledby="role-heading" className={styles.section}>
        <h2 id="role-heading">Co budete na BYZONu dělat?</h2>
        <div className={styles.roleList}>
          {roleGuides.map((guide) => (
            <Link
              key={guide.role}
              href={guidePath(guide.slug)}
              className={styles.roleLink}
            >
              <h3>{guide.title}</h3>
              <p>{guide.description}</p>
              <span aria-hidden="true">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  focusable="false"
                >
                  <path d="M4 12h16m-6-6 6 6-6 6" />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section
        id="prvni-prihlaseni"
        aria-labelledby="start-heading"
        className={styles.section}
      >
        <h2 id="start-heading">Poprvé v aplikaci</h2>
        <ol className={styles.startSteps}>
          {gettingStarted.map((step) => (
            <li key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
        <GuideScreenshot screenshot="prihlaseni" />
        <Link className={styles.textLink} href="/prihlaseni">
          Přejít k přihlášení
        </Link>
      </section>
      <section
        id="caste-otazky"
        aria-labelledby="faq-heading"
        className={styles.section}
      >
        <h2 id="faq-heading">Když si nevíte rady</h2>
        <div className={styles.faq}>
          {guideFaqs.map((faq) => (
            <details key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
