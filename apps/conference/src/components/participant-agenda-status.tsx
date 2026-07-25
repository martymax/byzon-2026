'use client';

import { ActionLink, Alert, Button, Skeleton, StatePanel } from '@byzon/ui';

import type { AgendaMutationFeedback } from './participant-agenda-failures';
import type {
  ParticipantAgendaResource,
  ParticipantAgendaResourceState,
} from './participant-agenda-resource';

type AgendaFailureState = Exclude<
  ParticipantAgendaResourceState,
  { readonly status: 'ready' }
>;

const failureCopy: Record<
  Exclude<AgendaFailureState['status'], 'error' | 'loading'>,
  { readonly detail: string; readonly title: string }
> = {
  offline: {
    title: 'Jste offline',
    detail:
      'Osobní agenda se v této fázi neukládá do zařízení. Připojte se a načtěte bezpečně aktuální stav ze serveru.',
  },
  authentication: {
    title: 'Je potřeba se přihlásit',
    detail: 'Po přihlášení se můžete bezpečně vrátit přímo do osobní agendy.',
  },
  session_expired: {
    title: 'Přihlášení vypršelo',
    detail: 'Obnovte přihlášení a potom znovu načtěte osobní agendu.',
  },
  permission: {
    title: 'Agenda není dostupná',
    detail:
      'K osobní agendě tohoto účtu nebo akce nemáte přístup. Soukromá data jsme ze stránky odstranili.',
  },
  disabled: {
    title: 'Osobní agenda není zapnutá',
    detail:
      'Organizátoři tuto funkci pro aktuální akci nepoužívají. Publikovaný program zůstává dostupný.',
  },
};

export const ParticipantAgendaResourceStatus = ({
  onRetry,
  state,
}: {
  readonly onRetry: () => void;
  readonly state: AgendaFailureState;
}) => {
  if (state.status === 'loading') {
    return (
      <Skeleton
        className="agenda-loading"
        label="Načítám osobní agendu"
        lines={8}
      />
    );
  }

  if (state.status === 'error') {
    return (
      <StatePanel
        action={<Button onClick={onRetry}>Zkusit znovu</Button>}
        kind="error"
        title="Agendu se nepodařilo načíst"
      >
        <p>
          Zkontrolujte připojení a zkuste požadavek znovu. Pokud potíže trvají,
          předejte podpoře pouze referenci požadavku.
        </p>
        {state.requestId ? (
          <p className="request-reference">
            Reference požadavku: <code>{state.requestId}</code>
          </p>
        ) : null}
      </StatePanel>
    );
  }

  const copy = failureCopy[state.status];
  const needsLogin =
    state.status === 'authentication' || state.status === 'session_expired';
  const canRetry = state.status === 'offline';

  return (
    <StatePanel
      action={
        needsLogin ? (
          <ActionLink href="/prihlaseni?mode=recovery&returnTo=%2Fapp%2Fagenda">
            Přihlásit se znovu
          </ActionLink>
        ) : canRetry ? (
          <Button onClick={onRetry}>Zkusit znovu</Button>
        ) : state.status === 'disabled' ? (
          <ActionLink href="/app/program" variant="secondary">
            Otevřít program
          </ActionLink>
        ) : (
          <ActionLink href="/app" variant="secondary">
            Zpět na přehled
          </ActionLink>
        )
      }
      kind={
        state.status === 'offline'
          ? 'offline'
          : needsLogin
            ? 'session-expired'
            : 'permission'
      }
      title={copy.title}
    >
      <p>{copy.detail}</p>
    </StatePanel>
  );
};

const feedbackCopy: Record<
  AgendaMutationFeedback['kind'],
  {
    readonly detail: string;
    readonly title: string;
    readonly tone: 'danger' | 'info' | 'warning';
  }
> = {
  offline: {
    title: 'Změnu nelze provést offline',
    detail:
      'Požadavek nebyl zařazen do fronty. Připojte se a odešlete stejnou změnu znovu.',
    tone: 'warning',
  },
  capacity_full: {
    title: 'Kapacita se mezitím naplnila',
    detail:
      'Místo nebylo slíbené lokálně. Zobrazený stav vychází z kanonické odpovědi serveru.',
    tone: 'warning',
  },
  closed: {
    title: 'Rezervace jsou uzavřené',
    detail:
      'Požadavek se neprovedl. Další dostupné možnosti určuje aktuální stav serveru.',
    tone: 'warning',
  },
  disabled: {
    title: 'Osobní agenda už není zapnutá',
    detail:
      'Organizátoři funkci vypnuli. Zobrazené položky už nepovažujeme za aktuální a načteme stav znovu.',
    tone: 'warning',
  },
  offer_expired: {
    title: 'Nabídka už vypršela',
    detail:
      'Místo nebylo rezervováno. Načtěte aktuální agendu a zkontrolujte další možnosti.',
    tone: 'warning',
  },
  stale: {
    title: 'Agenda se mezitím změnila',
    detail:
      'Z bezpečnostních důvodů jsme zastaralou změnu neprovedli. Načtěte aktuální stav.',
    tone: 'warning',
  },
  not_found: {
    title: 'Bod programu už není dostupný',
    detail:
      'Mohl být odebrán v novější publikaci. Načtěte aktuální osobní agendu.',
    tone: 'warning',
  },
  ticket_inactive: {
    title: 'Vstupenka není aktivní',
    detail:
      'Rezervace ani čekací listina se nezměnily. Stav vstupenky můžete zkontrolovat v aplikaci.',
    tone: 'warning',
  },
  in_progress: {
    title: 'Předchozí požadavek se ještě zpracovává',
    detail:
      'Neodesíláme novou změnu s jiným klíčem. Bezpečně zkontrolujte stejný požadavek znovu.',
    tone: 'info',
  },
  rejected: {
    title: 'Změnu nelze bezpečně zopakovat',
    detail:
      'Požadavek byl odmítnut. Načtěte aktuální agendu a vyberte z dostupných akcí.',
    tone: 'danger',
  },
  error: {
    title: 'Změnu se nepodařilo potvrdit',
    detail:
      'Výsledek nemusí být známý. Při opakování používáme stejný idempotentní požadavek, případně nejprve načteme aktuální stav.',
    tone: 'danger',
  },
};

export const ParticipantAgendaMutationFeedback = ({
  resource,
}: {
  readonly resource: ParticipantAgendaResource;
}) => {
  const feedback = resource.feedback;
  if (!feedback) return null;
  const copy = feedbackCopy[feedback.kind];
  return (
    <Alert
      action={
        <div className="agenda-feedback-actions">
          {feedback.retry === 'mutation' ? (
            <Button onClick={() => void resource.retryMutation()}>
              Zkontrolovat stejný požadavek
            </Button>
          ) : feedback.retry === 'read' ? (
            <Button onClick={resource.retry}>Načíst aktuální agendu</Button>
          ) : null}
          {feedback.retry === 'none' ? (
            <Button onClick={resource.dismissFeedback} variant="quiet">
              Zavřít zprávu
            </Button>
          ) : null}
        </div>
      }
      title={copy.title}
      tone={copy.tone}
    >
      <p>{copy.detail}</p>
      {feedback.requestId ? (
        <p className="request-reference">
          Reference požadavku: <code>{feedback.requestId}</code>
        </p>
      ) : null}
    </Alert>
  );
};
