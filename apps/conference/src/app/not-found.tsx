import { ActionLink } from '@byzon/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Stránka nenalezena',
  robots: { index: false, follow: false },
};

const HomeIcon = () => (
  <svg fill="none" focusable="false" viewBox="0 0 24 24">
    <path
      d="m4 10 8-6.5 8 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-9Z"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
    <path
      d="M9 20.5v-6h6v6"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  </svg>
);

export default function NotFoundPage() {
  return (
    <section className="not-found-page">
      <div className="not-found-copy">
        <p className="eyebrow">Chyba 404</p>
        <h1>Tuhle zastávku v programu nemáme.</h1>
        <p className="lead">
          Hledaná stránka neexistuje nebo se mezitím přesunula. Vraťte se na
          přehled a pokračujte v aplikaci.
        </p>
        <ActionLink href="/app" leadingIcon={<HomeIcon />}>
          Zpět do aplikace
        </ActionLink>
      </div>

      <div aria-hidden="true" className="not-found-illustration">
        <span className="not-found-code">404</span>
        <svg className="not-found-route" viewBox="0 0 440 220">
          <path
            d="M16 172C92 172 70 55 157 55c61 0 52 105 121 105 45 0 56-43 99-43"
            pathLength="1"
          />
          <circle cx="16" cy="172" r="9" />
          <path d="m369 103 21 14-21 14" />
        </svg>
        <span className="not-found-marker" />
      </div>
    </section>
  );
}
