'use client';

import {
  ActionLink,
  Alert,
  Button,
  Card,
  ChoiceField,
  ErrorSummary,
  FormField,
  Input,
  LiveRegion,
  Skeleton,
  StatePanel,
  StatusBadge,
} from '@byzon/ui';
import {
  identityOnboardingRequestSchema,
  identityProfileSchema,
  type ApiFailure,
  type IdentityBootstrapResponse,
  type IdentityLegalDocument,
  type IdentityLegalDocumentType,
  type IdentityOnboardingProblem,
  type IdentityOnboardingRequest,
  type RequestId,
} from '@byzon/domain/contracts';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';

import {
  useIdentityBootstrap,
  type IdentityBootstrapState,
} from '@/components/identity-bootstrap';
import { useTransitionFocus } from '@/components/use-transition-focus';
import type { ApiPort } from '@/lib/api';
import {
  browserIdentityApi,
  submitIdentityOnboarding,
} from '@/lib/identity-api';
import { shouldRetainMutationKey } from '@/lib/mutation-retry';

type Step = 'profile' | 'legal';
type FieldErrors = Partial<
  Record<
    'firstName' | 'lastName' | 'contactEmail' | 'terms' | 'privacy' | 'submit',
    string
  >
>;
type SubmitFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'stale_legal' }
  | { readonly kind: 'permission' }
  | { readonly kind: 'validation' }
  | { readonly kind: 'error'; readonly requestId?: RequestId };

interface Draft {
  readonly firstName: string;
  readonly lastName: string;
  readonly contactEmail: string;
  readonly termsAccepted: boolean;
  readonly privacyAcknowledged: boolean;
}

const emptyDraft: Draft = {
  firstName: '',
  lastName: '',
  contactEmail: '',
  termsAccepted: false,
  privacyAcknowledged: false,
};

const stepNumber: Record<Step, number> = {
  profile: 1,
  legal: 2,
};

const stepLabel: Record<Step, string> = {
  profile: 'Profil',
  legal: 'Právní minimum',
};

const runtimeKey = (): string => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `onboarding:${suffix}`;
};

const documentByType = (
  bootstrap: IdentityBootstrapResponse,
  type: IdentityLegalDocumentType,
): IdentityLegalDocument | undefined =>
  bootstrap.legalDocuments.find((document) => document.type === type);

const initialStep = (bootstrap: IdentityBootstrapResponse): Step => {
  switch (bootstrap.onboarding.status) {
    case 'profile_required':
      return 'profile';
    case 'legal_acknowledgement_required':
      return 'legal';
    case 'complete':
      return 'legal';
    case 'blocked_missing_legal_documents':
      return 'legal';
  }
};

const profileErrors = (draft: Draft): FieldErrors => {
  const errors: FieldErrors = {};
  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();
  const contactEmail = draft.contactEmail.trim().toLowerCase();
  const result = identityProfileSchema.safeParse({
    firstName,
    lastName,
    contactEmail,
    phone: null,
  });
  if (!result.success) {
    result.error.issues.forEach((issue) => {
      const field = issue.path[0];
      if (field === 'firstName') {
        errors.firstName = 'Zadejte platné jméno v délce nejvýše 128 znaků.';
      } else if (field === 'lastName') {
        errors.lastName = 'Zadejte platné příjmení v délce nejvýše 128 znaků.';
      } else if (field === 'contactEmail') {
        errors.contactEmail = 'Zadejte platnou e-mailovou adresu.';
      }
    });
  }
  return errors;
};

const summaryItems = (errors: FieldErrors) =>
  (
    [
      ['firstName', 'onboarding-first-name'],
      ['lastName', 'onboarding-last-name'],
      ['contactEmail', 'onboarding-email'],
      ['terms', 'onboarding-terms'],
      ['privacy', 'onboarding-privacy'],
      ['submit', 'onboarding-submit'],
    ] as const
  ).flatMap(([key, fieldId]) =>
    errors[key] ? [{ fieldId, message: errors[key] }] : [],
  );

const mapSubmitFailure = (
  failure: ApiFailure<IdentityOnboardingProblem>,
): SubmitFailure | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { kind: 'offline' };
    case 'session_expired':
      return { kind: 'session_expired' };
    case 'problem':
      switch (failure.problem.code) {
        case 'AUTHENTICATION_REQUIRED':
        case 'AUTH_SESSION_EXPIRED':
          return { kind: 'session_expired' };
        case 'EVENT_ACCESS_DENIED':
          return { kind: 'permission' };
        case 'LEGAL_CONFIGURATION_MISSING':
        case 'STALE_LEGAL_DOCUMENT':
          return { kind: 'stale_legal' };
        case 'VALIDATION_FAILED':
          return { kind: 'validation' };
        case 'REQUEST_ID_REUSED':
        case 'IDEMPOTENCY_KEY_REUSED':
        case 'IDEMPOTENCY_IN_PROGRESS':
        case 'INTERNAL_ERROR':
          return { kind: 'error', requestId: failure.problem.requestId };
      }
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

const defaultNavigate = (href: string) => window.location.assign(href);

const BootstrapFrame = ({
  bootstrap,
  children,
  headingRef,
  step,
}: {
  readonly bootstrap: IdentityBootstrapResponse;
  readonly children: ReactNode;
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly step: Step;
}) => (
  <section className="onboarding-page">
    <header className="onboarding-heading">
      <p className="eyebrow">Nastavení účasti</p>
      <h1 data-route-heading ref={headingRef} tabIndex={-1}>
        Připravte si aplikaci
      </h1>
      <p className="lead">
        Dva krátké kroky. Údaje zůstávají pouze v paměti formuláře, dokud
        onboarding výslovně nedokončíte.
      </p>
    </header>
    <div className="onboarding-context">
      <strong>{bootstrap.event.name}</strong>
      <span>{bootstrap.user.email}</span>
    </div>
    {bootstrap.dataMode === 'synthetic_preview' ? (
      <Alert title="Syntetický náhled – bez skutečného zápisu" tone="warning">
        <p>
          Právní texty, profil i volby jsou pouze testovací. Tento průchod
          nevytvoří skutečný souhlas, přihlášení ani účast na akci.
        </p>
      </Alert>
    ) : null}
    <nav aria-label="Průběh onboardingu" className="onboarding-progress">
      <ol>
        {(Object.keys(stepNumber) as Step[]).map((item) => {
          const current = item === step;
          const complete = stepNumber[item] < stepNumber[step];
          return (
            <li
              aria-current={current ? 'step' : undefined}
              className={
                current
                  ? 'onboarding-progress-current'
                  : complete
                    ? 'onboarding-progress-complete'
                    : undefined
              }
              key={item}
            >
              <span>{complete ? '✓' : stepNumber[item]}</span>
              {stepLabel[item]}
            </li>
          );
        })}
      </ol>
    </nav>
    {children}
  </section>
);

const ResourceState = ({
  bootstrap,
  retry,
}: {
  readonly bootstrap: IdentityBootstrapState;
  readonly retry: () => void;
}) => {
  if (bootstrap.status === 'loading') {
    return (
      <section className="onboarding-page">
        <p className="eyebrow">Nastavení účasti</p>
        <h1 data-route-heading tabIndex={-1}>
          Načítám onboarding
        </h1>
        <Skeleton label="Načítám bezpečný stav onboardingu" lines={5} />
      </section>
    );
  }
  const sessionExpired = bootstrap.status === 'session_expired';
  const permission = bootstrap.status === 'permission';
  const offline = bootstrap.status === 'offline';
  return (
    <section className="onboarding-page">
      <p className="eyebrow">Nastavení účasti</p>
      <h1 data-route-heading tabIndex={-1}>
        Onboarding není dostupný
      </h1>
      <StatePanel
        action={
          sessionExpired ? (
            <ActionLink href="/prihlaseni?mode=recovery&returnTo=%2Fonboarding">
              Obnovit přihlášení
            </ActionLink>
          ) : permission ? (
            <ActionLink href="/aktivace">Vrátit se k aktivaci</ActionLink>
          ) : (
            <Button onClick={retry}>Zkusit znovu</Button>
          )
        }
        kind={
          sessionExpired
            ? 'session-expired'
            : permission
              ? 'permission'
              : offline
                ? 'offline'
                : 'error'
        }
        title={
          sessionExpired
            ? 'Přihlášení vypršelo'
            : permission
              ? 'K této události nemáte přístup'
              : offline
                ? 'Dokončení vyžaduje připojení'
                : 'Stav se nepodařilo načíst'
        }
      >
        <p>
          Údaje ani právní volby jsme neuložili.
          {bootstrap.status === 'error' && bootstrap.requestId ? (
            <>
              {' '}
              Reference: <code>{bootstrap.requestId}</code>
            </>
          ) : null}
        </p>
      </StatePanel>
    </section>
  );
};

const LegalDocumentCard = ({
  document,
}: {
  readonly document: IdentityLegalDocument;
}) => (
  <Card className="onboarding-legal-card">
    <div>
      <StatusBadge
        tone={document.publication === 'published' ? 'success' : 'warning'}
      >
        {document.publication === 'published'
          ? 'Publikovaná verze'
          : 'Syntetický draft'}
      </StatusBadge>
      <h3>{document.title}</h3>
      <p>Verze {document.version}</p>
    </div>
    <details>
      <summary>Zobrazit náhled dokumentu</summary>
      <p>{document.previewText}</p>
    </details>
  </Card>
);

export const OnboardingFlow = ({
  api = browserIdentityApi,
  createIdempotencyKey = runtimeKey,
  navigate,
}: {
  readonly api?: ApiPort;
  readonly createIdempotencyKey?: () => string;
  readonly navigate?: (href: string) => void;
}) => {
  const bootstrap = useIdentityBootstrap(api);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState<Step>('profile');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<SubmitFailure>();
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const initializedRevision = useRef(0);
  const submitLocked = useRef(false);
  const mounted = useRef(true);
  const allowNavigation = useRef(false);
  const sentinelPushed = useRef(false);
  const errorContainer = useRef<HTMLDivElement>(null);
  const failureAlert = useRef<HTMLDivElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const preserveDraftAfterLegalRefresh = useRef(false);
  const requestAttempt = useRef<
    | {
        readonly fingerprint: string;
        readonly idempotencyKey: string;
      }
    | undefined
  >(undefined);
  const navigateTo = navigate ?? defaultNavigate;
  const completionHeading = useTransitionFocus(
    completed ||
      (bootstrap.state.status === 'ready' &&
        bootstrap.state.data.onboarding.status === 'complete'),
  );

  const discardDraftAndNavigate = useCallback(
    (href: string) => {
      allowNavigation.current = true;
      if (!sentinelPushed.current) {
        navigateTo(href);
        return;
      }
      sentinelPushed.current = false;
      window.addEventListener('popstate', () => navigateTo(href), {
        once: true,
      });
      window.history.back();
    },
    [navigateTo],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const guardStateKey = '__byzonOnboardingDraftGuard';
    const currentState =
      window.history.state &&
      typeof window.history.state === 'object' &&
      !Array.isArray(window.history.state)
        ? (window.history.state as Record<string, unknown>)
        : {};
    if (!dirty) {
      if (currentState[guardStateKey] === true) {
        if (sentinelPushed.current) {
          sentinelPushed.current = false;
          window.history.back();
        } else {
          const cleanState = { ...currentState };
          delete cleanState[guardStateKey];
          window.history.replaceState(cleanState, '', window.location.href);
        }
      }
      return;
    }
    allowNavigation.current = false;

    const confirmLeave = () =>
      window.confirm(
        'Opravdu chcete onboarding opustit? Neuložené údaje se zahodí.',
      );
    const guard = (event: BeforeUnloadEvent) => {
      if (allowNavigation.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    if (currentState[guardStateKey] !== true) {
      window.history.pushState(
        { ...currentState, [guardStateKey]: true },
        '',
        window.location.href,
      );
      sentinelPushed.current = true;
    }
    const guardLink = (event: MouseEvent) => {
      if (
        allowNavigation.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href]')
          : null;
      if (
        !target ||
        target.target === '_blank' ||
        target.hasAttribute('download')
      ) {
        return;
      }
      const destination = new URL(target.href, window.location.href);
      const current = new URL(window.location.href);
      if (
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search &&
        destination.hash !== current.hash
      ) {
        return;
      }
      if (confirmLeave()) {
        event.preventDefault();
        event.stopPropagation();
        const href =
          destination.origin === current.origin
            ? `${destination.pathname}${destination.search}${destination.hash}`
            : destination.href;
        discardDraftAndNavigate(href);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const guardBack = () => {
      if (allowNavigation.current) return;
      if (confirmLeave()) {
        allowNavigation.current = true;
        sentinelPushed.current = false;
        window.history.back();
        return;
      }
      window.history.pushState(
        { ...currentState, [guardStateKey]: true },
        '',
        window.location.href,
      );
    };
    window.addEventListener('beforeunload', guard);
    window.addEventListener('popstate', guardBack);
    document.addEventListener('click', guardLink, true);
    return () => {
      window.removeEventListener('beforeunload', guard);
      window.removeEventListener('popstate', guardBack);
      document.removeEventListener('click', guardLink, true);
    };
  }, [dirty, discardDraftAndNavigate]);

  useEffect(() => {
    if (
      bootstrap.state.status !== 'ready' ||
      initializedRevision.current === bootstrap.revision
    ) {
      return;
    }
    initializedRevision.current = bootstrap.revision;
    const data = bootstrap.state.data;
    if (preserveDraftAfterLegalRefresh.current) {
      preserveDraftAfterLegalRefresh.current = false;
      setDraft((current) => ({
        ...current,
        termsAccepted: false,
        privacyAcknowledged: false,
      }));
      setStep('legal');
      setErrors({});
      setDirty(true);
      requestAttempt.current = undefined;
      requestAnimationFrame(() => failureAlert.current?.focus());
      return;
    }
    const alreadyAcknowledged = data.onboarding.status === 'complete';
    setDraft({
      firstName: data.profile?.firstName ?? '',
      lastName: data.profile?.lastName ?? '',
      contactEmail: data.profile?.contactEmail ?? data.user.email,
      termsAccepted: alreadyAcknowledged,
      privacyAcknowledged: alreadyAcknowledged,
    });
    setStep(initialStep(data));
    setErrors({});
    setFailure(undefined);
    setDirty(false);
    requestAttempt.current = undefined;
  }, [bootstrap.revision, bootstrap.state]);

  useEffect(() => {
    stepHeading.current?.focus();
  }, [step]);

  const focusErrors = () => {
    requestAnimationFrame(() => {
      errorContainer.current
        ?.querySelector<HTMLElement>('.ui-error-summary')
        ?.focus();
    });
  };

  const focusFailure = () => {
    requestAnimationFrame(() => failureAlert.current?.focus());
  };

  const updateDraft = <Key extends keyof Draft>(
    key: Key,
    value: Draft[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key as keyof FieldErrors];
      delete next.submit;
      return next;
    });
    setFailure(undefined);
    setDirty(true);
  };

  if (bootstrap.state.status !== 'ready') {
    return (
      <ResourceState bootstrap={bootstrap.state} retry={bootstrap.retry} />
    );
  }

  const data = bootstrap.state.data;
  const access = data.membership.access;
  if (access.state === 'suspended' || access.state === 'revoked') {
    return (
      <section className="onboarding-page">
        <p className="eyebrow">Nastavení účasti</p>
        <h1 data-route-heading tabIndex={-1}>
          {access.state === 'suspended'
            ? 'Přístup je pozastavený'
            : 'Přístup byl zrušený'}
        </h1>
        <StatePanel
          action={<ActionLink href="/aktivace">Zpět na aktivaci</ActionLink>}
          kind="permission"
          title={
            access.state === 'suspended'
              ? 'Účast nelze dokončit'
              : 'Přístup k události byl zrušen'
          }
        >
          <p>
            Kontaktujte podporu a uveďte referenci{' '}
            <code>{access.supportReference}</code>. Nezkoušejte zakládat nový
            profil.
          </p>
        </StatePanel>
      </section>
    );
  }

  if (data.onboarding.status === 'blocked_missing_legal_documents') {
    const labels: Record<IdentityLegalDocumentType, string> = {
      terms: 'podmínky používání',
      privacy_notice: 'informace o soukromí',
    };
    return (
      <BootstrapFrame bootstrap={data} step="legal">
        <StatePanel
          action={<Button onClick={bootstrap.retry}>Zkontrolovat znovu</Button>}
          kind="stale"
          title="Aktuální právní verze není publikovaná"
        >
          <p>
            Onboarding je bezpečně zastavený. Chybí:{' '}
            {data.onboarding.missingTypes
              .map((type) => labels[type])
              .join(', ')}
            . Žádný náhradní text ani souhlas nevytváříme.
          </p>
        </StatePanel>
      </BootstrapFrame>
    );
  }

  if (completed || data.onboarding.status === 'complete') {
    return (
      <BootstrapFrame
        bootstrap={data}
        headingRef={completionHeading}
        step="legal"
      >
        <StatePanel
          action={<ActionLink href="/app">Otevřít aplikaci</ActionLink>}
          kind="empty"
          title="Nastavení je dokončené"
        >
          <p>
            V syntetickém režimu byl pouze nasimulován výsledek. Nevzniklo
            skutečné přihlášení, účast na akci ani právní záznam.
          </p>
        </StatePanel>
      </BootstrapFrame>
    );
  }

  const terms = documentByType(data, 'terms');
  const privacy = documentByType(data, 'privacy_notice');
  if (!terms || !privacy) {
    return (
      <BootstrapFrame bootstrap={data} step="legal">
        <StatePanel
          action={<Button onClick={bootstrap.retry}>Zkontrolovat znovu</Button>}
          kind="stale"
          title="Právní konfigurace není úplná"
        >
          <p>
            Bez aktuálních podmínek a informací o soukromí nelze pokračovat.
          </p>
        </StatePanel>
      </BootstrapFrame>
    );
  }

  const goFromProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = profileErrors(draft);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      focusErrors();
      return;
    }
    setDraft((current) => ({
      ...current,
      firstName: current.firstName.trim(),
      lastName: current.lastName.trim(),
      contactEmail: current.contactEmail.trim().toLowerCase(),
    }));
    setErrors({});
    setStep('legal');
  };

  const goFromLegal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    if (!draft.termsAccepted) {
      nextErrors.terms = 'Potvrďte aktuální verzi podmínek.';
    }
    if (!draft.privacyAcknowledged) {
      nextErrors.privacy = 'Potvrďte seznámení s informacemi o soukromí.';
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      focusErrors();
      return;
    }
    void submitOnboarding();
  };

  const createRequest = (): IdentityOnboardingRequest | null => {
    if (!draft.termsAccepted || !draft.privacyAcknowledged) {
      return null;
    }
    const candidate = {
      profile: {
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        contactEmail: draft.contactEmail.trim().toLowerCase(),
        phone: null,
      },
      legal: {
        termsDocumentId: terms.id,
        termsAccepted: true,
        privacyNoticeDocumentId: privacy.id,
        privacyAcknowledged: true,
      },
    };
    const parsed = identityOnboardingRequestSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  };

  const submitOnboarding = async () => {
    if (submitLocked.current) return;
    const request = createRequest();
    const nextErrors: FieldErrors = {};
    if (Object.keys(nextErrors).length > 0 || !request) {
      if (Object.keys(nextErrors).length === 0) {
        nextErrors.submit = 'Zkontrolujte všechny kroky onboardingu.';
      }
      setErrors(nextErrors);
      focusErrors();
      return;
    }

    submitLocked.current = true;
    setErrors({});
    setFailure(undefined);
    setSubmitting(true);
    const fingerprint = JSON.stringify(request);
    if (requestAttempt.current?.fingerprint !== fingerprint) {
      requestAttempt.current = {
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }
    try {
      const result = await submitIdentityOnboarding(
        api,
        request,
        requestAttempt.current.idempotencyKey,
      );
      if (!mounted.current) return;
      if (result.ok && result.kind === 'success') {
        const acknowledgements = new Map(
          result.data.acknowledgements.map((record) => [record.type, record]),
        );
        const returnedTerms = acknowledgements.get('terms');
        const returnedPrivacy = acknowledgements.get('privacy_notice');
        const acknowledgementsMatch =
          returnedTerms?.documentId === terms.id &&
          returnedTerms.version === terms.version &&
          returnedTerms.decision === 'accepted' &&
          returnedPrivacy?.documentId === privacy.id &&
          returnedPrivacy.version === privacy.version &&
          returnedPrivacy.decision === 'acknowledged';
        if (
          result.data.profile.firstName !== request.profile.firstName ||
          result.data.profile.lastName !== request.profile.lastName ||
          result.data.profile.contactEmail !== request.profile.contactEmail ||
          result.data.profile.phone !== request.profile.phone ||
          !acknowledgementsMatch
        ) {
          setFailure({
            kind: 'error',
            requestId: result.metadata.requestId,
          });
          setErrors({});
          focusFailure();
          return;
        }
        requestAttempt.current = undefined;
        setDirty(false);
        setCompleted(true);
        return;
      }
      if (!result.ok) {
        const mapped = mapSubmitFailure(result.failure);
        if (!shouldRetainMutationKey(result.failure)) {
          requestAttempt.current = undefined;
        }
        if (mapped) {
          setFailure(mapped);
          if (mapped.kind === 'stale_legal') {
            preserveDraftAfterLegalRefresh.current = true;
            setDraft((current) => ({
              ...current,
              termsAccepted: false,
              privacyAcknowledged: false,
            }));
            setStep('legal');
            bootstrap.retry();
          } else {
            setErrors({});
            focusFailure();
          }
        }
      }
    } catch {
      if (mounted.current) {
        setFailure({ kind: 'error' });
        setErrors({});
        focusFailure();
      }
    } finally {
      submitLocked.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const confirmExit = () => {
    if (
      !dirty ||
      window.confirm(
        'Opravdu chcete onboarding opustit? Neuložené údaje se zahodí.',
      )
    ) {
      discardDraftAndNavigate('/aktivace');
    }
  };

  const errorSummary = (
    <div ref={errorContainer}>
      <ErrorSummary errors={summaryItems(errors)} />
    </div>
  );

  return (
    <BootstrapFrame bootstrap={data} step={step}>
      <LiveRegion>
        Krok {stepNumber[step]} ze 2: {stepLabel[step]}
      </LiveRegion>
      {failure?.kind === 'stale_legal' ? (
        <div data-form-failure ref={failureAlert} tabIndex={-1}>
          <Alert title="Právní verze se změnila" tone="warning">
            <p>
              Načetli jsme aktuální dokumenty. Staré volby byly zrušené a je
              potřeba je zkontrolovat znovu.
            </p>
          </Alert>
        </div>
      ) : null}
      {failure && failure.kind !== 'stale_legal' ? (
        <div data-form-failure ref={failureAlert} tabIndex={-1}>
          <Alert
            title={
              failure.kind === 'offline'
                ? 'Jste offline'
                : failure.kind === 'session_expired'
                  ? 'Přihlášení vypršelo'
                  : failure.kind === 'permission'
                    ? 'Přístup už není dostupný'
                    : failure.kind === 'validation'
                      ? 'Server údaje odmítl'
                      : 'Dokončení se nepodařilo'
            }
            tone={failure.kind === 'error' ? 'danger' : 'warning'}
          >
            <p>
              {failure.kind === 'offline'
                ? 'Připojte se a odešlete stejný požadavek znovu.'
                : failure.kind === 'session_expired'
                  ? 'Obnovte přihlášení bezpečným odkazem a potom pokračujte.'
                  : failure.kind === 'permission'
                    ? 'K této události už nemáte oprávnění.'
                    : failure.kind === 'validation'
                      ? 'Zkontrolujte formulář a zkuste jej odeslat znovu.'
                      : failure.requestId
                        ? `Server vrátil nekonzistentní výsledek. Nic nepředstíráme. Podpoře předejte pouze referenci ${failure.requestId}.`
                        : 'Zopakujte bezpečně stejný požadavek.'}
            </p>
            {failure.kind === 'session_expired' ? (
              <ActionLink href="/prihlaseni?mode=recovery&returnTo=%2Fonboarding">
                Obnovit přihlášení
              </ActionLink>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {step === 'profile' ? (
        <form className="onboarding-card" noValidate onSubmit={goFromProfile}>
          <header>
            <p className="activation-kicker">Krok 1 ze 2</p>
            <h2 ref={stepHeading} tabIndex={-1}>
              Základní profil
            </h2>
            <p>
              Vyplňte pouze údaje potřebné pro účast. Nic se průběžně neukládá.
            </p>
          </header>
          {errorSummary}
          <div className="onboarding-fields">
            <FormField
              {...(errors.firstName ? { error: errors.firstName } : {})}
              label="Jméno"
              required
            >
              <Input
                autoComplete="given-name"
                id="onboarding-first-name"
                maxLength={128}
                name="firstName"
                onChange={(event) =>
                  updateDraft('firstName', event.currentTarget.value)
                }
                value={draft.firstName}
              />
            </FormField>
            <FormField
              {...(errors.lastName ? { error: errors.lastName } : {})}
              label="Příjmení"
              required
            >
              <Input
                autoComplete="family-name"
                id="onboarding-last-name"
                maxLength={128}
                name="lastName"
                onChange={(event) =>
                  updateDraft('lastName', event.currentTarget.value)
                }
                value={draft.lastName}
              />
            </FormField>
            <FormField
              {...(errors.contactEmail ? { error: errors.contactEmail } : {})}
              helperText="Na tento e-mail se váže pouze váš syntetický náhled účasti."
              label="Kontaktní e-mail"
              required
            >
              <Input
                autoComplete="email"
                id="onboarding-email"
                inputMode="email"
                maxLength={320}
                name="contactEmail"
                onChange={(event) =>
                  updateDraft('contactEmail', event.currentTarget.value)
                }
                type="email"
                value={draft.contactEmail}
              />
            </FormField>
          </div>
          <div className="activation-form-actions">
            <Button onClick={confirmExit} type="button" variant="quiet">
              Ukončit
            </Button>
            <Button type="submit">Pokračovat</Button>
          </div>
        </form>
      ) : null}

      {step === 'legal' ? (
        <form className="onboarding-card" noValidate onSubmit={goFromLegal}>
          <header>
            <p className="activation-kicker">Krok 2 ze 2</p>
            <h2 ref={stepHeading} tabIndex={-1}>
              Právní minimum
            </h2>
            <p>Každá volba odkazuje na přesnou verzi.</p>
          </header>
          {errorSummary}
          <div className="onboarding-legal-list">
            <LegalDocumentCard document={terms} />
            <ChoiceField
              checked={draft.termsAccepted}
              id="onboarding-terms"
              label={`Souhlasím s podmínkami, verze ${terms.version}`}
              onChange={(event) =>
                updateDraft('termsAccepted', event.currentTarget.checked)
              }
              required
              type="checkbox"
            />
            <LegalDocumentCard document={privacy} />
            <ChoiceField
              checked={draft.privacyAcknowledged}
              id="onboarding-privacy"
              label={`Potvrzuji seznámení s informacemi o soukromí, verze ${privacy.version}`}
              onChange={(event) =>
                updateDraft('privacyAcknowledged', event.currentTarget.checked)
              }
              required
              type="checkbox"
            />
          </div>
          <div className="activation-form-actions">
            <Button
              onClick={() => setStep('profile')}
              type="button"
              variant="secondary"
            >
              Zpět
            </Button>
            <Button
              id="onboarding-submit"
              loading={submitting}
              loadingLabel="Dokončuji…"
              type="submit"
            >
              Dokončit onboarding
            </Button>
          </div>
          <p className="onboarding-submit-note">
            Odeslání je online-only. Při neurčitém výpadku můžete bezpečně
            zopakovat stejný požadavek.
          </p>
        </form>
      ) : null}
    </BootstrapFrame>
  );
};
