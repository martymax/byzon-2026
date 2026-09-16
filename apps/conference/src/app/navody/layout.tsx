import type { ReactNode } from 'react';
import Link from 'next/link';
import { RouteFocus } from '@/components/route-focus';
import styles from './navody.module.css';

export default function GuidesLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.root}>
      <RouteFocus />
      <nav className={styles.topbar} aria-label="Navigace návodů">
        <Link href="/navody">Návody k aplikaci</Link>
        <Link href="/prihlaseni">Přihlásit se do aplikace</Link>
      </nav>
      {children}
      <footer className={styles.footer}>
        <p>
          <strong>Potřebujete pomoc?</strong> Odpovězte na e-mail s pozvánkou
          nebo napište na <a href="mailto:jsem@byzon.cz">jsem@byzon.cz</a>.
        </p>
        <p>
          Popište, na které obrazovce problém nastal. Osobní přihlašovací odkaz
          nikomu neposílejte.
        </p>
        <Link href="/navody">Všechny návody</Link>
      </footer>
    </div>
  );
}
