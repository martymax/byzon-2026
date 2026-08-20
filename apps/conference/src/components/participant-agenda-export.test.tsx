import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ParticipantAgendaCalendarExport } from './participant-agenda-export';

describe('participant agenda calendar export', () => {
  it('distinguishes an empty agenda from an export that is not integrated yet', () => {
    expect(
      renderToStaticMarkup(
        <ParticipantAgendaCalendarExport
          calendarExport={{ state: 'unavailable', reason: 'empty' }}
        />,
      ),
    ).toContain('jakmile si do osobní agendy přidáte první bod');
    expect(
      renderToStaticMarkup(
        <ParticipantAgendaCalendarExport
          calendarExport={{ state: 'unavailable', reason: 'not_ready' }}
        />,
      ),
    ).toContain('zpřístupněný v dalším kroku');
  });
});
