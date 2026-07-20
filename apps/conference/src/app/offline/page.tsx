export const metadata = { title: 'Jste offline' };

export default function OfflinePage() {
  return (
    <section className="message-page">
      <p className="eyebrow">Bez připojení</p>
      <h1>Teď jste offline.</h1>
      <p>
        Tato část ještě není uložená v zařízení. Zkontrolujte připojení a zkuste
        stránku načíst znovu.
      </p>
      <Link className="button" href="/">
        Zkusit znovu
      </Link>
    </section>
  );
}
import Link from 'next/link';
