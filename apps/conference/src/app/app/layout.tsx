import Link from 'next/link';
import type { ReactNode } from 'react';

export default function ParticipantLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <nav className="participant-nav" aria-label="Hlavní navigace">
        <Link href="/app/program">Program</Link>
        <Link href="/app/recnici">Řečníci</Link>
        <Link href="/app/partneri">Partneři</Link>
        <Link href="/app/informace">Informace</Link>
      </nav>
      {children}
    </>
  );
}
