'use client';

import type {
  ApiFailure,
  IdentityProfile,
  IdentityProfileUpdateProblem,
  RequestId,
} from '@byzon/domain/contracts';
import { identityProfileSchema } from '@byzon/domain/contracts';
import {
  ActionLink,
  Alert,
  Button,
  Card,
  ErrorSummary,
  FormField,
  Input,
  StatePanel,
} from '@byzon/ui';
import { useRef, useState, type FormEvent } from 'react';

import type { ParticipantAccountResourceValue } from '@/components/participant-account-resource';
import { ParticipantAccountBoundary } from '@/components/participant-account-state';
import { useParticipantAccountUnsavedGuard } from '@/components/participant-account-unsaved';
import { useTransitionFocus } from '@/components/use-transition-focus';
import type { ApiPort } from '@/lib/api';
import { browserIdentityApi, updateIdentityProfile } from '@/lib/identity-api';
import { privateResourceInvalidationReason } from '@/lib/private-resource-events';

type ProfileField = keyof IdentityProfile;
type ProfileErrors = Partial<Record<ProfileField, string>>;
type ProfileFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'validation' }
  | { readonly kind: 'error'; readonly requestId?: RequestId };

const fieldLabels: Record<ProfileField, string> = {
  firstName: 'Jméno',
  lastName: 'Příjmení',
  contactEmail: 'Kontaktní e-mail',
  phone: 'Telefon',
};

const canonicalProfile = (profile: IdentityProfile): IdentityProfile => ({
  firstName: profile.firstName.trim(),
  lastName: profile.lastName.trim(),
  contactEmail: profile.contactEmail.trim().toLowerCase(),
  phone: profile.phone?.trim() || null,
});

const validateProfile = (
  profile: IdentityProfile,
): { readonly profile?: IdentityProfile; readonly errors: ProfileErrors } => {
  const canonical = canonicalProfile(profile);
  const result = identityProfileSchema.safeParse(canonical);
  if (result.success) return { profile: result.data, errors: {} };
  const errors: ProfileErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (
      (field === 'firstName' ||
        field === 'lastName' ||
        field === 'contactEmail' ||
        field === 'phone') &&
      !errors[field]
    ) {
      errors[field] =
        field === 'contactEmail' || field === 'phone'
          ? field === 'phone'
            ? 'Zadejte telefon v mezinárodním formátu, například +420774835456.'
            : 'Zadejte platnou kontaktní e-mailovou adresu.'
          : `${fieldLabels[field]} nesmí být prázdné ani obsahovat nepovolené znaky.`;
    }
  }
  return { errors };
};

const mapFailure = (
  failure: ApiFailure<IdentityProfileUpdateProblem>,
):
  | ProfileFailure
  | 'refresh_profile'
  | 'session_expired'
  | 'permission'
  | null => {
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
      if (failure.problem.code === 'STALE_VERSION') return { kind: 'stale' };
      if (
        failure.problem.code === 'PROFILE_NOT_FOUND' ||
        failure.problem.code === 'PROFILE_NOT_EDITABLE'
      ) {
        return 'refresh_profile';
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

const ReadOnlyProfile = ({
  contactEmail,
  firstName,
  lastName,
  phone,
  supportEmail,
}: IdentityProfile & { readonly supportEmail: string }) => (
  <Card className="participant-account-card">
    <p className="activation-kicker">Profil pouze pro čtení</p>
    <h2>Profil spravuje organizátor</h2>
    <dl className="participant-account-details">
      <div>
        <dt>Jméno</dt>
        <dd>{firstName}</dd>
      </div>
      <div>
        <dt>Příjmení</dt>
        <dd>{lastName}</dd>
      </div>
      <div>
        <dt>Kontaktní e-mail</dt>
        <dd>{contactEmail}</dd>
      </div>
      <div>
        <dt>Telefon</dt>
        <dd>{phone ?? 'Neuveden'}</dd>
      </div>
    </dl>
    <p>
      Pokud jsou údaje chybně, napište podpoře. Tato obrazovka nepřidává
      marketingové ani networkingové údaje.
    </p>
    <a className="text-link" href={`mailto:${supportEmail}`}>
      Kontaktovat podporu
    </a>
  </Card>
);

const EditableProfile = ({
  api,
  profile,
  resource,
  version,
}: {
  readonly api: ApiPort;
  readonly profile: IdentityProfile;
  readonly resource: ParticipantAccountResourceValue;
  readonly version: number;
}) => {
  const [savedProfile, setSavedProfile] = useState(profile);
  const [draft, setDraft] = useState(profile);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [failure, setFailure] = useState<ProfileFailure>();
  const [saved, setSaved] = useState(false);
  const [working, setWorking] = useState(false);
  const locked = useRef(false);
  const errorContainer = useRef<HTMLDivElement>(null);
  const failureAlert = useRef<HTMLDivElement>(null);
  const savedHeading = useTransitionFocus(saved);
  const dirty =
    draft.firstName !== savedProfile.firstName ||
    draft.lastName !== savedProfile.lastName ||
    draft.contactEmail !== savedProfile.contactEmail ||
    draft.phone !== savedProfile.phone;

  useParticipantAccountUnsavedGuard(dirty);

  const focusErrors = () => {
    requestAnimationFrame(() =>
      errorContainer.current
        ?.querySelector<HTMLElement>('.ui-error-summary')
        ?.focus(),
    );
  };
  const focusFailure = () => {
    requestAnimationFrame(() => failureAlert.current?.focus());
  };
  const updateField = (
    field: ProfileField,
    value: IdentityProfile[ProfileField],
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFailure(undefined);
    setSaved(false);
  };
  const discardAndReload = () => {
    setDraft(savedProfile);
    setErrors({});
    setFailure(undefined);
    resource.retry();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current || !dirty) return;
    const validated = validateProfile(draft);
    if (!validated.profile) {
      setErrors(validated.errors);
      setSaved(false);
      focusErrors();
      return;
    }
    locked.current = true;
    setWorking(true);
    setFailure(undefined);
    setSaved(false);
    try {
      const result = await updateIdentityProfile(api, {
        expectedVersion: version,
        profile: validated.profile,
      });
      if (result.ok && result.kind === 'success') {
        if (!resource.commitProfile(result.data, version)) {
          setFailure({
            kind: 'error',
            requestId: result.metadata.requestId,
          });
          focusFailure();
          return;
        }
        setSavedProfile(result.data.profile);
        setDraft(result.data.profile);
        setErrors({});
        setSaved(true);
        return;
      }
      if (!result.ok) {
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
        if (mapped === 'refresh_profile') {
          resource.retry();
          return;
        }
        if (mapped) {
          setFailure(mapped);
          focusFailure();
        }
      }
    } catch {
      setFailure({ kind: 'error' });
      focusFailure();
    } finally {
      locked.current = false;
      setWorking(false);
    }
  };

  const summaryErrors = (Object.keys(errors) as ProfileField[]).map(
    (field) => ({
      fieldId: `participant-profile-${field}`,
      message: errors[field]!,
    }),
  );

  return (
    <Card className="participant-account-card participant-profile-card">
      <header>
        <p className="activation-kicker">Profilové minimum</p>
        <h2>Kontaktní údaje k akci</h2>
        <p>
          Spravujeme pouze jméno, příjmení a kontaktní e-mail. Networkingová a
          marketingová pole sem nepatří.
        </p>
      </header>

      {failure ? (
        <div ref={failureAlert} tabIndex={-1}>
          <Alert
            action={
              failure.kind === 'stale' ? (
                <Button onClick={discardAndReload} variant="secondary">
                  Zahodit změny a načíst aktuální profil
                </Button>
              ) : undefined
            }
            title={
              failure.kind === 'offline'
                ? 'Uložení vyžaduje připojení'
                : failure.kind === 'stale'
                  ? 'Profil se mezitím změnil'
                  : failure.kind === 'validation'
                    ? 'Server údaje nepřijal'
                    : 'Profil se nepodařilo uložit'
            }
            tone={failure.kind === 'error' ? 'danger' : 'warning'}
          >
            <p>
              {failure.kind === 'stale'
                ? 'Vaše rozepsané změny jsme nepřepsali. Až po potvrzení načteme kanonickou verzi ze serveru.'
                : failure.kind === 'offline'
                  ? 'Úpravy zůstávají jen v tomto formuláři. Po připojení je můžete bezpečně odeslat znovu.'
                  : 'Žádná nepotvrzená serverová data jsme do formuláře nepřevzali.'}
            </p>
            {failure.kind === 'error' && failure.requestId ? (
              <p>
                Reference pro podporu: <code>{failure.requestId}</code>
              </p>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {saved ? (
        <Alert title="Profil je uložený" tone="success">
          <p ref={savedHeading} tabIndex={-1}>
            Zobrazujeme kanonickou podobu potvrzenou serverem.
          </p>
        </Alert>
      ) : null}

      <div ref={errorContainer}>
        <ErrorSummary errors={summaryErrors} />
      </div>

      <form
        className="participant-account-form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <div className="onboarding-fields">
          <FormField
            {...(errors.firstName ? { error: errors.firstName } : {})}
            label="Jméno"
            required
          >
            <Input
              autoComplete="given-name"
              disabled={working}
              id="participant-profile-firstName"
              maxLength={128}
              onChange={(event) => updateField('firstName', event.target.value)}
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
              disabled={working}
              id="participant-profile-lastName"
              maxLength={128}
              onChange={(event) => updateField('lastName', event.target.value)}
              value={draft.lastName}
            />
          </FormField>
          <FormField
            {...(errors.contactEmail ? { error: errors.contactEmail } : {})}
            helperText="Na tuto adresu může organizátor poslat důležité informace k akci."
            label="Kontaktní e-mail"
            required
          >
            <Input
              autoComplete="email"
              disabled={working}
              id="participant-profile-contactEmail"
              inputMode="email"
              maxLength={320}
              onChange={(event) =>
                updateField('contactEmail', event.target.value)
              }
              type="email"
              value={draft.contactEmail}
            />
          </FormField>
          <FormField
            {...(errors.phone ? { error: errors.phone } : {})}
            helperText="Volitelné. Použijte mezinárodní formát, například +420774835456."
            label="Telefon"
          >
            <Input
              autoComplete="tel"
              disabled={working}
              id="participant-profile-phone"
              inputMode="tel"
              maxLength={16}
              onChange={(event) =>
                updateField('phone', event.target.value || null)
              }
              type="tel"
              value={draft.phone ?? ''}
            />
          </FormField>
        </div>
        <div className="participant-account-actions">
          <Button
            disabled={!dirty}
            loading={working}
            loadingLabel="Ukládám profil…"
            type="submit"
          >
            Uložit profil
          </Button>
          <Button
            disabled={!dirty || working}
            onClick={() => {
              setDraft(savedProfile);
              setErrors({});
              setFailure(undefined);
            }}
            variant="secondary"
          >
            Zahodit změny
          </Button>
        </div>
      </form>
    </Card>
  );
};

export const ParticipantProfile = ({
  api = browserIdentityApi,
}: {
  readonly api?: ApiPort;
}) => (
  <section className="app-page participant-account-page participant-profile-page">
    <header className="participant-account-heading">
      <p className="eyebrow">Účet</p>
      <h1 data-route-heading tabIndex={-1}>
        Profil
      </h1>
      <p className="lead">
        Zkontrolujte minimum údajů potřebných pro účast na konkrétní akci.
      </p>
    </header>

    <ParticipantAccountBoundary loginReturnTo="/app/profil">
      {(identity, resource) => {
        const management = identity.profileManagement;
        if (management.state === 'missing') {
          return (
            <StatePanel
              action={
                <ActionLink href="/onboarding">Dokončit profil</ActionLink>
              }
              kind="empty"
              title="Profil ještě není vytvořený"
            >
              <p>Profilové minimum se bezpečně vytvoří v průvodci aktivací.</p>
            </StatePanel>
          );
        }
        if (management.state === 'removed') {
          return (
            <StatePanel kind="empty" title="Profil byl odstraněn">
              <p>
                Osobní profil už nezobrazujeme. Stav žádosti najdete v části
                Soukromí.
              </p>
            </StatePanel>
          );
        }
        if (!identity.profile) {
          return (
            <StatePanel kind="error" title="Profil nelze bezpečně zobrazit">
              <p>Server nevrátil úplný kanonický profil.</p>
            </StatePanel>
          );
        }
        if (management.state === 'read_only') {
          return (
            <ReadOnlyProfile
              contactEmail={identity.profile.contactEmail}
              firstName={identity.profile.firstName}
              lastName={identity.profile.lastName}
              phone={identity.profile.phone}
              supportEmail={identity.supportEmail}
            />
          );
        }
        return (
          <EditableProfile
            api={api}
            profile={identity.profile}
            resource={resource}
            version={management.version}
          />
        );
      }}
    </ParticipantAccountBoundary>
  </section>
);
