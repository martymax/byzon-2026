import { GuideScreenshot } from '../../../components/guide-screenshot';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { guidePath, roleGuides } from '@byzon/mail/guides';
import { guideContent } from '../../../lib/public-guides';
import styles from '../navody.module.css';

type Props = { params: Promise<{ role: string }> };
export const dynamicParams = false;
export const generateStaticParams = () =>
  roleGuides.map(({ slug }) => ({ role: slug }));
const findGuide = (slug: string) =>
  roleGuides.find((guide) => guide.slug === slug);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = findGuide((await params).role);
  if (!guide) notFound();
  return {
    title: `Návod: ${guide.title}`,
    description: guide.description,
    alternates: { canonical: `https://app.byzon.cz${guidePath(guide.slug)}` },
  };
}

export default async function RoleGuidePage({ params }: Props) {
  const guide = findGuide((await params).role);
  if (!guide) notFound();
  const content = guideContent(guide.slug);
  return (
    <>
      <header className={styles.heading}>
        <Link className={styles.back} href="/navody">
          Všechny návody
        </Link>
        <h1 data-route-heading tabIndex={-1}>
          {guide.title} <span>v aplikaci BYZON</span>
        </h1>
        <p>{content.introduction}</p>
        <p className={styles.publicNote}>
          Veřejný návod · Bez přihlášení · Odkaz lze sdílet
        </p>
      </header>
      <div className={styles.readingLayout}>
        <aside className={styles.contents}>
          <nav aria-label="Obsah návodu">
            <h2>V tomto návodu</h2>
            <a href="#rychly-start">Rychlý start</a>
            {content.sections.map((section) => (
              <a key={section.id} href={`#${section.id}`}>
                {section.title}
              </a>
            ))}
            <a href="#dalsi-kroky">Přihlášení a další návody</a>
          </nav>
        </aside>
        <article
          className={styles.article}
          aria-label={`Návod pro roli ${guide.title}`}
        >
          <section id="rychly-start" className={styles.quickStart}>
            <h2>Rychlý start</h2>
            <ol>
              {content.start.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <Link href="/navody#prvni-prihlaseni" className={styles.textLink}>
              Jak funguje první přihlášení
            </Link>
          </section>
          {content.sections.map((section) => (
            <section
              id={section.id}
              key={section.id}
              className={styles.chapter}
            >
              <h2>{section.title}</h2>
              {section.intro ? <p>{section.intro}</p> : null}
              <ol>
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {section.screenshot ? (
                <GuideScreenshot screenshot={section.screenshot} />
              ) : null}
              {section.note ? (
                <p className={styles.note}>{section.note}</p>
              ) : null}
              {section.link ? (
                <Link
                  className={styles.textLink}
                  href={section.link.href}
                  prefetch={false}
                >
                  {section.link.label}{' '}
                  <span className={styles.loginHint}>(po přihlášení)</span>
                </Link>
              ) : null}
            </section>
          ))}
          <section id="dalsi-kroky" className={styles.chapter}>
            <h2>Máte připraveno?</h2>
            <p>
              Otevřete osobní odkaz z pozvánky nebo se přihlaste svým e-mailem.
              Dostupné nástroje závisejí na přidělených oprávněních a nastavení
              konference.
            </p>
            <Link
              className={styles.primaryLink}
              href={`/prihlaseni?returnTo=${encodeURIComponent(content.destination)}`}
              prefetch={false}
            >
              Přihlásit se do aplikace
            </Link>
            <Link className={styles.textLink} href="/navody#caste-otazky">
              Potíže s přihlášením nebo chybějící rolí
            </Link>
            <h3 className={styles.relatedHeading}>Hodit se vám může také</h3>
            <nav className={styles.related} aria-label="Související návody">
              {content.related.map((slug) => {
                const related = roleGuides.find((item) => item.slug === slug)!;
                return (
                  <Link href={guidePath(slug)} key={slug}>
                    {related.title}
                  </Link>
                );
              })}
            </nav>
          </section>
        </article>
      </div>
    </>
  );
}
