'use client';

import { ActionLink } from '@byzon/ui';
import { createContext, useContext } from 'react';

import type { ParticipantSessionContext } from '@/lib/participant-session-context';

export const ParticipantSessionContextProvider =
  createContext<ParticipantSessionContext | null>(null);

export const useParticipantSessionContext = () =>
  useContext(ParticipantSessionContextProvider);

export const ParticipantAdminNotice = () => {
  const session = useParticipantSessionContext();
  if (!session?.isAdmin) return null;
  return (
    <aside
      className="participant-admin-notice"
      aria-label="Administrátorský přístup"
    >
      <p>
        {session.timelessTestMode
          ? 'Testovací režim je zapnutý. Časová omezení pro váš účet neplatí; změny se ukládají.'
          : 'Prohlížíte účastnickou aplikaci jako administrátor.'}
      </p>
      <ActionLink href="/app/nastaveni" variant="secondary">
        {session.timelessTestMode
          ? 'Nastavit testovací režim'
          : 'Testování funkcí'}
      </ActionLink>
      <ActionLink href="/admin" variant="secondary">
        Zpět do administrace
      </ActionLink>
    </aside>
  );
};
