'use client';

import type {
  ApiFailure,
  IdentityBootstrapResponse,
  IdentityLegalAcknowledgement,
  IdentityLegalDocument,
  IdentityPrivacyRequestKind,
  IdentityPrivacyRequestProblem,
  IdentityPrivacyRequestStatus,
  RequestId,
} from '@byzon/domain/contracts';
import {
  ActionLink,
  Alert,
  Button,
  Card,
  ChoiceField,
  Dialog,
  StatePanel,
  StatusBadge,
} from '@byzon/ui';
import { useRef, useState } from 'react';

import type { ParticipantAccountResourceValue } from '@/components/participant-account-resource';
import { ParticipantAccountBoundary } from '@/components/participant-account-state';
import type { ApiPort } from '@/lib/api';
import {
  browserIdentityApi,
  submitIdentityPrivacyRequest,
} from '@/lib/identity-api';
import { shouldRetainMutationKey } from '@/lib/mutation-retry';
import { privateResourceInvalidationReason } from '@/lib/private-resource-events';

const documentTypeLabels = {
  terms: 'Podmínky používání',
  privacy_notice: 'Informace o soukromí',
  networking_consent: 'Dobrovolný networking',
} as const;

const decisionLabels = {
  accepted: 'Souhlas potvrzen',
  acknowledged: 'Seznámení potvrzeno',
} as const;

const formatAcknowledgedAt = (value: string, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return 'Datum je dostupné v evidenci podpory';
  }
};

const LegalDocumentCard = ({
  acknowledgement,
  document,
  timezone,
}: {
  readonly acknowledgement?: IdentityLegalAcknowledgement;
  readonly document: IdentityLegalDocument;
  readonly timezone: string;
}) => (
  <Card className="participant-legal-card">
    <div className="participant-legal-heading">
      <div>
        <p className="activation-kicker">{documentTypeLabels[document.type]}</p>
        <h3>{document.title}</h3>
      </div>
      <StatusBadge tone={acknowledgement ? 'success' : 'warning'}>
        {acknowledgement
          ? decisionLabels[acknowledgement.decision]
          : 'Bez aktuálního potvrzení'}
      </StatusBadge>
    </div>
    <p>{document.previewText}</p>
    <p className="participant-account-secondary">
      Verze {document.version}
      {document.publication === 'synthetic_preview'
        ? ' · syntetický náhled'
        : ''}
    </p>

    {document.content.kind === 'inline' ? (
      <details>
        <summary>Zobrazit celý dokument</summary>
        <div className="participant-legal-content">
          {document.content.text
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={`${document.id}-${index}`}>{paragraph}</p>
            ))}
        </div>
      </details>
    ) : (
      <a
        className="text-link"
        href={document.content.url}
        rel="noopener noreferrer"
        target="_blank"
      >
        Otevřít celý dokument v novém panelu
      </a>
    )}

    {acknowledgement ? (
      <p className="participant-legal-acknowledgement">
        {decisionLabels[acknowledgement.decision]}{' '}
        <time dateTime={acknowledgement.acknowledgedAt}>
          {formatAcknowledgedAt(acknowledgement.acknowledgedAt, timezone)}
        </time>
        . Toto je evidence aktuální verze pouze pro čtení.
      </p>
    ) : null}
  </Card>
);

type PrivacyFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'reused' }
  | { readonly kind: 'validation' }
  | { readonly kind: 'error'; readonly requestId?: RequestId };

const mapFailure = (
  failure: ApiFailure<IdentityPrivacyRequestProblem>,
): PrivacyFailure | 'session_expired' | 'permission' | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { kind: 'offline' };
    case 'session_expired':
      return 'session_expired';
    case 'problem':
      if (
        failure.problem.code === 'AUTHENTICATION_REQUIRED' ||
        failure.problem.code === 'AUTH_SESSION_EXPIRED'
      ) {
        return 'session_expired';
      }
      if (failure.problem.code === 'EVENT_ACCESS_DENIED') return 'permission';
      if (failure.problem.code === 'PRIVACY_REQUEST_UNAVAILABLE') {
        return { kind: 'unavailable' };
      }
      if (failure.problem.code === 'IDEMPOTENCY_IN_PROGRESS') {
        return { kind: 'in_progress' };
      }
      if (failure.problem.code === 'IDEMPOTENCY_KEY_REUSED') {
        return { kind: 'reused' };
      }
      if (failure.problem.code === 'VALIDATION_FAILED') {
        return { kind: 'validation' };
      }
      return { kind: 'error', requestId: failure.problem.requestId };
    case 'invalid_response':
    case 'transport':
      return {
        kind: 'error',
        ...(failure.requestId ? { requestId: failure.requestId } : {}),
      };
    case 'timeout':
      return { kind: 'error' };
  }
};

const requestCopy = {
  data_export: {
    title: 'Kopie osobních údajů',
    description:
      'Požádejte o export údajů, které se vážou k vašemu účtu a této akci.',
    action: 'Požádat o export',
    confirmTitle: 'Odeslat žádost o export?',
    confirmAction: 'Odeslat žádost',
  },
  data_deletion: {
    title: 'Smazání osobních údajů',
    description:
      'Požádejte o odstranění osobních údajů podle platných povinností a retenčních lhůt.',
    action: 'Požádat o smazání',
    confirmTitle: 'Odeslat žádost o smazání?',
    confirmAction: 'Potvrdit žádost o smazání',
  },
} as const;

const statusCopy: Record<
  Exclude<IdentityPrivacyRequestStatus, 'available'>,
  {
    readonly label: string;
    readonly detail: string;
    readonly tone: 'info' | 'success' | 'warning';
  }
> = {
  pending: {
    label: 'Žádost se zpracovává',
    detail: 'Další stejnou žádost teď není potřeba odesílat.',
    tone: 'info',
  },
  completed: {
    label: 'Žádost je dokončená',
    detail:
      'Výsledek je evidovaný serverem. Pokud něco chybí, obraťte se na podporu.',
    tone: 'success',
  },
  rejected: {
    label: 'Žádost vyžaduje podporu',
    detail:
      'Automatické zpracování nebylo možné. Podpora ověří další bezpečný postup.',
    tone: 'warning',
  },
  unavailable: {
    label: 'Žádost teď není dostupná',
    detail:
      'Tento typ žádosti nelze pro aktuální stav účtu odeslat. Kontaktujte podporu.',
    tone: 'warning',
  },
};

const createRuntimeKey = (): string => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `privacy-request:${suffix}`;
};

const PrivacyRequestCard = ({
  api,
  createIdempotencyKey,
  identity,
  kind,
  resource,
  status,
}: {
  readonly api: ApiPort;
  readonly createIdempotencyKey: () => string;
  readonly identity: IdentityBootstrapResponse;
  readonly kind: IdentityPrivacyRequestKind;
  readonly resource: ParticipantAccountResourceValue;
  readonly status: IdentityPrivacyRequestStatus;
}) => {
  const copy = requestCopy[kind];
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [deletionConfirmed, setDeletionConfirmed] = useState(false);
  const [failure, setFailure] = useState<PrivacyFailure>();
  const [outcome, setOutcome] = useState(false);
  const [working, setWorking] = useState(false);
  const [confirmedUnavailable, setConfirmedUnavailable] = useState(false);
  const locked = useRef(false);
  const attemptKey = useRef<string | undefined>(undefined);
  const failureAlert = useRef<HTMLDivElement>(null);
  const effectiveStatus =
    status === 'available' && confirmedUnavailable ? 'unavailable' : status;

  const closeConfirmation = () => {
    if (working) return;
    setConfirmationOpen(false);
    setDeletionConfirmed(false);
  };
  const submit = async () => {
    if (
      locked.current ||
      effectiveStatus !== 'available' ||
      (kind === 'data_deletion' && !deletionConfirmed)
    ) {
      return;
    }
    locked.current = true;
    setWorking(true);
    setFailure(undefined);
    setOutcome(false);
    attemptKey.current ??= createIdempotencyKey();
    try {
      const result = await submitIdentityPrivacyRequest(
        api,
        { kind },
        attemptKey.current,
      );
      if (result.ok && result.kind === 'success') {
        if (!resource.commitPrivacyRequest(result.data, kind)) {
          setFailure({
            kind: 'error',
            requestId: result.metadata.requestId,
          });
          setConfirmationOpen(false);
          setDeletionConfirmed(false);
          requestAnimationFrame(() => failureAlert.current?.focus());
          return;
        }
        attemptKey.current = undefined;
        setConfirmationOpen(false);
        setDeletionConfirmed(false);
        setOutcome(true);
        return;
      }
      if (!result.ok) {
        if (!shouldRetainMutationKey(result.failure)) {
          attemptKey.current = undefined;
        }
        const invalidation = privateResourceInvalidationReason(
          result.failure,
          result.status,
        );
        if (invalidation) {
          resource.discardPrivateData(invalidation);
          return;
        }
        const mapped = mapFailure(result.failure);
        if (mapped === 'session_expired' || mapped === 'permission') {
          resource.discardPrivateData(mapped);
          return;
        }
        if (mapped) {
          if (mapped.kind === 'unavailable') {
            setConfirmedUnavailable(true);
          }
          setFailure(mapped);
          setConfirmationOpen(false);
          setDeletionConfirmed(false);
          requestAnimationFrame(() => failureAlert.current?.focus());
        }
      }
    } catch {
      setFailure({ kind: 'error' });
      setConfirmationOpen(false);
      setDeletionConfirmed(false);
      requestAnimationFrame(() => failureAlert.current?.focus());
    } finally {
      locked.current = false;
      setWorking(false);
    }
  };

  return (
    <Card className="participant-privacy-request-card">
      <p className="activation-kicker">Žádost o soukromí</p>
      <h3>{copy.title}</h3>
      <p>{copy.description}</p>

      {effectiveStatus === 'available' ? (
        <Button
          onClick={() => {
            setFailure(undefined);
            setOutcome(false);
            setConfirmationOpen(true);
          }}
          variant={kind === 'data_deletion' ? 'danger' : 'secondary'}
        >
          {copy.action}
        </Button>
      ) : (
        <div className="participant-privacy-status">
          <StatusBadge tone={statusCopy[effectiveStatus].tone}>
            {statusCopy[effectiveStatus].label}
          </StatusBadge>
          <p>{statusCopy[effectiveStatus].detail}</p>
          {effectiveStatus === 'rejected' ||
          effectiveStatus === 'unavailable' ? (
            <a className="text-link" href={`mailto:${identity.supportEmail}`}>
              Kontaktovat podporu
            </a>
          ) : null}
        </div>
      )}

      {failure ? (
        <div ref={failureAlert} tabIndex={-1}>
          <Alert
            title={
              failure.kind === 'offline'
                ? 'Žádost vyžaduje připojení'
                : failure.kind === 'unavailable'
                  ? 'Žádost už není dostupná'
                  : failure.kind === 'in_progress'
                    ? 'Předchozí žádost se ještě zpracovává'
                    : failure.kind === 'reused'
                      ? 'Žádost nelze bezpečně zopakovat'
                      : failure.kind === 'validation'
                        ? 'Žádost server nepřijal'
                        : 'Výsledek žádosti nelze ověřit'
            }
            tone={failure.kind === 'error' ? 'danger' : 'warning'}
          >
            <p>
              {failure.kind === 'in_progress'
                ? 'Počkejte a potom zopakujte stejný bezpečný požadavek.'
                : 'Nezobrazujeme žádný nepotvrzený výsledek ani údaje jiného účtu.'}
            </p>
            {failure.kind === 'error' && failure.requestId ? (
              <p>
                Reference pro podporu: <code>{failure.requestId}</code>
              </p>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {outcome ? (
        <Alert title="Žádost byla přijata" tone="success">
          <p>
            Zobrazujeme pouze kanonický stav potvrzený serverem pro tento účet a
            tuto akci.
          </p>
        </Alert>
      ) : null}

      <Dialog
        onClose={closeConfirmation}
        open={confirmationOpen}
        title={copy.confirmTitle}
      >
        <div className="ui-confirmation participant-privacy-confirmation">
          <div>
            <p>
              {kind === 'data_deletion'
                ? 'Smazání může omezit další používání účtu. Povinné záznamy mohou zůstat po zákonnou nebo smluvní retenční dobu.'
                : 'Export může obsahovat osobní údaje. Informace o bezpečném předání poskytne podpora po zpracování.'}
            </p>
            {kind === 'data_deletion' ? (
              <ChoiceField
                checked={deletionConfirmed}
                description="Tato volba pouze potvrdí žádost; neobchází retenční ani právní povinnosti."
                label="Rozumím důsledkům a chci odeslat žádost o smazání"
                onChange={(event) =>
                  setDeletionConfirmed(event.currentTarget.checked)
                }
                type="checkbox"
              />
            ) : null}
          </div>
          <div className="ui-confirmation__actions">
            <Button
              disabled={working}
              onClick={closeConfirmation}
              variant="secondary"
            >
              Zrušit
            </Button>
            <Button
              disabled={kind === 'data_deletion' && !deletionConfirmed}
              loading={working}
              loadingLabel="Odesílám žádost…"
              onClick={() => void submit()}
              variant={kind === 'data_deletion' ? 'danger' : 'primary'}
            >
              {copy.confirmAction}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
};

export const ParticipantPrivacy = ({
  api = browserIdentityApi,
  createIdempotencyKey = createRuntimeKey,
}: {
  readonly api?: ApiPort;
  readonly createIdempotencyKey?: () => string;
}) => (
  <section className="app-page participant-account-page participant-privacy-page">
    <header className="participant-account-heading">
      <p className="eyebrow">Účet</p>
      <h1 data-route-heading tabIndex={-1}>
        Soukromí
      </h1>
      <p className="lead">
        Přečtěte si aktuální právní dokumenty, ověřte evidovaná potvrzení a
        bezpečně odešlete žádost.
      </p>
    </header>

    <ParticipantAccountBoundary loginReturnTo="/app/soukromi">
      {(identity, resource) => (
        <div className="participant-account-stack">
          <section
            aria-labelledby="participant-legal-title"
            className="participant-account-section"
          >
            <header>
              <p className="activation-kicker">Dokumenty pouze pro čtení</p>
              <h2 id="participant-legal-title">Právní dokumenty a potvrzení</h2>
              <p>
                Tato obrazovka nemění souhlasy. Případné povinné nové potvrzení
                proběhne odděleně v bezpečném průvodci.
              </p>
            </header>
            {identity.legalDocuments.length === 0 ? (
              <StatePanel
                action={
                  <a
                    className="text-link"
                    href={`mailto:${identity.supportEmail}`}
                  >
                    Kontaktovat podporu
                  </a>
                }
                kind="error"
                title="Právní dokumenty nejsou dostupné"
              >
                <p>Dokud nejsou publikované, žádné potvrzení nepožadujeme.</p>
              </StatePanel>
            ) : (
              <div className="participant-legal-list">
                {identity.legalDocuments.map((document) => (
                  <LegalDocumentCard
                    {...(() => {
                      const acknowledgement =
                        identity.legalAcknowledgements.find(
                          (record) =>
                            record.documentId === document.id &&
                            record.version === document.version,
                        );
                      return acknowledgement ? { acknowledgement } : {};
                    })()}
                    document={document}
                    key={document.id}
                    timezone={identity.event.timezone}
                  />
                ))}
              </div>
            )}
            {identity.onboarding.status === 'legal_acknowledgement_required' ||
            identity.onboarding.status === 'blocked_missing_legal_documents' ? (
              <Alert
                action={
                  <ActionLink href="/onboarding" variant="secondary">
                    Pokračovat bezpečným průvodcem
                  </ActionLink>
                }
                title="Aktuální potvrzení je potřeba doplnit"
                tone="warning"
              >
                <p>Na této read-only obrazovce souhlas nepředvyplňujeme.</p>
              </Alert>
            ) : null}
          </section>

          <section
            aria-labelledby="participant-privacy-request-title"
            className="participant-account-section"
          >
            <header>
              <p className="activation-kicker">Vaše práva</p>
              <h2 id="participant-privacy-request-title">
                Žádosti o osobní údaje
              </h2>
              <p>
                Každá žádost vyžaduje připojení a výslovné potvrzení. Výsledek
                vždy korelujeme s aktuální akcí a účtem.
              </p>
            </header>
            <div className="participant-privacy-request-grid">
              <PrivacyRequestCard
                api={api}
                createIdempotencyKey={createIdempotencyKey}
                identity={identity}
                kind="data_export"
                resource={resource}
                status={identity.privacy.exportRequest}
              />
              <PrivacyRequestCard
                api={api}
                createIdempotencyKey={createIdempotencyKey}
                identity={identity}
                kind="data_deletion"
                resource={resource}
                status={identity.privacy.deletionRequest}
              />
            </div>
          </section>

          <Card className="participant-support-card">
            <p className="activation-kicker">Podpora</p>
            <h2>Máte otázku k osobním údajům?</h2>
            <p>
              Neposílejte hesla, aktivační kódy ani obsah vstupenky. Pro
              dohledání stačí bezpečná reference, pokud ji rozhraní zobrazí.
            </p>
            <a className="text-link" href={`mailto:${identity.supportEmail}`}>
              Napsat podpoře na {identity.supportEmail}
            </a>
          </Card>
        </div>
      )}
    </ParticipantAccountBoundary>
  </section>
);
