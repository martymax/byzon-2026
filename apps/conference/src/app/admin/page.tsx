import type { Metadata } from 'next';
import { AdminOverviewWorkspace } from '@/components/admin-overview-workspace';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import Link from 'next/link';

export const metadata: Metadata = {
  title: { absolute: 'Přehled akce | Administrace BYZON' },
};

export default function AdminOverviewPage() {
  if (isFrontendPreviewAvailable()) return <AdminOverviewWorkspace />;
  return (
    <section className="app-page">
      <p className="eyebrow">Administrace</p>
      <h1>Provozní nástroje akce</h1>
      <p>
        Jsou zde dostupné provozní nástroje, účastníci, kritická oznámení,
        rezervace a správa publikovaného obsahu.
      </p>
      <ul>
        <li>
          <Link href="/admin/vstupenky">Aktualizace vstupenek</Link>
        </li>
        <li>
          <Link href="/admin/rezervace">Rezervace a kapacitní výjimky</Link>
        </li>
        <li>
          <Link href="/admin/obsah">Obsah akce</Link>
        </li>
        <li>
          <Link href="/admin/ucastnici">Účastníci</Link>
        </li>
        <li>
          <Link href="/admin/oznameni">Kritická oznámení</Link>
        </li>
        <li>
          <Link href="/admin/role">Tým a oprávnění</Link>
        </li>
        <li>
          <Link href="/admin/interakce">Networking, otázky a hodnocení</Link>
        </li>
        <li>
          <Link href="/admin/audit">Historie změn</Link>
        </li>
      </ul>
    </section>
  );
}
