import { AdminOverviewWorkspace } from '@/components/admin-overview-workspace';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import Link from 'next/link';

export default function AdminOverviewPage() {
  if (isFrontendPreviewAvailable()) return <AdminOverviewWorkspace />;
  return (
    <section className="app-page">
      <p className="eyebrow">Administrace</p>
      <h1>Provozní nástroje akce</h1>
      <p>
        Produkčně jsou dostupné provozní nástroje, podpora, kritická oznámení,
        rezervace a správa publikovaného obsahu.
      </p>
      <ul>
        <li>
          <Link href="/admin/vstupenky">Import účastníků</Link>
        </li>
        <li>
          <Link href="/admin/rezervace">Rezervace a kapacitní výjimky</Link>
        </li>
        <li>
          <Link href="/admin/obsah">Obsah akce</Link>
        </li>
        <li>
          <Link href="/admin/ucastnici">Podpora účastníků</Link>
        </li>
        <li>
          <Link href="/admin/oznameni">Kritická oznámení</Link>
        </li>
        <li>
          <Link href="/admin/role">Role a provozní přehled</Link>
        </li>
        <li>
          <Link href="/admin/interakce">Networking, otázky a hodnocení</Link>
        </li>
        <li>
          <Link href="/admin/audit">Audit a nastavení</Link>
        </li>
      </ul>
    </section>
  );
}
