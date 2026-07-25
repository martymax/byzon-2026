import { notFound } from 'next/navigation';

import { SessionExitControls } from '@/components/session-exit-controls';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export default function ParticipantSettingsPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  return (
    <section className="app-page account-settings-page">
      <p className="eyebrow">Účet</p>
      <h1 data-route-heading tabIndex={-1}>
        Nastavení účtu
      </h1>
      <p className="lead">
        Ověřte odhlášení a bezpečné přepnutí účtu nad syntetickými daty. Profil
        a soukromí doplní navazující účastnická etapa.
      </p>
      <SessionExitControls />
    </section>
  );
}
