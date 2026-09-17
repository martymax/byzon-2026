import type { Metadata } from 'next';
import { Button } from '@byzon/ui';
import { redirect } from 'next/navigation';
import styles from './page.module.css';

import {
  MAGIC_LINK_FIELDS,
  MAGIC_LINK_VERIFY_PATH,
} from '../../../lib/magic-link-confirmation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Dokončit přihlášení',
  robots: { index: false, follow: false },
  referrer: 'origin',
};

export default async function ConfirmLoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  if (typeof query.token !== 'string' || !query.token) {
    redirect('/prihlaseni?error=INVALID_TOKEN');
  }

  return (
    <section className="activation-form-page">
      <header>
        <h1 data-route-heading tabIndex={-1}>
          Dokončete přihlášení
        </h1>
        <p className="lead">
          Do konferenční aplikace BYZON vstoupíte stisknutím tlačítka níže.
        </p>
      </header>
      <form
        className={styles.actions}
        action={MAGIC_LINK_VERIFY_PATH}
        method="post"
      >
        {MAGIC_LINK_FIELDS.map((field) =>
          typeof query[field] === 'string' ? (
            <input
              key={field}
              type="hidden"
              name={field}
              value={query[field]}
            />
          ) : null,
        )}
        <Button type="submit">Dokončit přihlášení</Button>
      </form>
      <p>
        Používáte BYZON z plochy nebo Docku a odkaz se otevřel v prohlížeči?
        Otevřete aplikaci jejím zástupcem a zvolte přihlášení kódem. Kód z
        e-mailu pak zadáte přímo v aplikaci.
      </p>
    </section>
  );
}
