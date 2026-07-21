'use client';

import { useEffect, useState } from 'react';
import type { ParticipantContent } from '@/server/participant-content';

export interface ProgramSession {
  id: string;
  dayId: string;
  roomId: string | null;
  slug: string;
  title: string;
  summary?: string | null;
  description?: string | null;
  type: string;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
}

export interface ProgramData {
  version: number;
  program: {
    days: Array<{ id: string; localDate: string; title: string }>;
    rooms: Array<{ id: string; slug: string; name: string }>;
    sessions: ProgramSession[];
  };
}

export const useJsonResource = <T,>(url: string) => {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T }
  >({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal, credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('request failed');
        return (await response.json()) as T;
      })
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [url]);
  return state;
};

export type ParticipantContentResponse = {
  version: number;
  content: ParticipantContent;
};

export const ResourceStatus = ({ status }: { status: 'loading' | 'error' }) => (
  <div
    className="resource-status"
    role={status === 'error' ? 'alert' : 'status'}
  >
    {status === 'loading'
      ? 'Načítám publikovaný obsah…'
      : 'Obsah se nepodařilo načíst. Zkontrolujte připojení a přihlášení.'}
  </div>
);
