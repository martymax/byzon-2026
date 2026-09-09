'use client';

import { ActionLink, Card } from '@byzon/ui';
import { participantTourHref } from '@/lib/participant-tour';

export function ParticipantGuide({
  showSkip = false,
  exitHref = '/po-prihlaseni',
}: {
  readonly showSkip?: boolean;
  readonly exitHref?: string;
}) {
  return (
    <Card className="participant-guide-intro">
      <div>
        <p className="eyebrow">Průvodce přímo v aplikaci</p>
        <h2>Projděte si aplikaci krok za krokem</h2>
        <p>
          Ukážeme vám konkrétní místa v programu, agendě a dalších sekcích.
          Funkce si můžete rovnou vyzkoušet vlastním tempem.
        </p>
      </div>
      <div className="participant-guide-launch-actions">
        <ActionLink href={participantTourHref('program')}>
          Spustit průvodce v aplikaci
        </ActionLink>
        {showSkip ? (
          <ActionLink href={exitHref} variant="quiet">
            Vstoupit bez průvodce
          </ActionLink>
        ) : null}
      </div>
    </Card>
  );
}
