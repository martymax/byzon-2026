'use client';

import {
  networkingSettingsUpdateRequestSchema,
  type NetworkingDirectoryProfile,
  type NetworkingSettings,
} from '@byzon/domain/contracts';
import {
  ActionLink,
  Alert,
  Button,
  Card,
  ChoiceField,
  ErrorSummary,
  FormField,
  Input,
  Select,
  StatePanel,
  Textarea,
} from '@byzon/ui';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserInteractionsApi,
  requestNetworkingDirectory,
  requestNetworkingProfile,
  requestNetworkingSettings,
  updateNetworkingSettings,
} from '@/lib/b-interactions-api';

const hunting = {
  know_how: 'Know-how',
  team: 'Lidé do týmu',
  investors: 'Investoři',
  business_partners: 'Obchodní partneři',
  suppliers: 'Dodavatelé',
  clients: 'Klienti',
} as const;

type State =
  | { status: 'loading' }
  | { status: 'disabled' }
  | { status: 'authentication' }
  | { status: 'error' }
  | { status: 'ready'; settings: NetworkingSettings };

type EditableField =
  | 'company'
  | 'jobTitle'
  | 'participantNumber'
  | 'introduction'
  | 'todayHunting'
  | 'contactEmail'
  | 'phone'
  | 'linkedinUrl';

const fieldIds: Record<EditableField, string> = {
  company: 'networking-company',
  jobTitle: 'networking-job-title',
  participantNumber: 'networking-participant-number',
  introduction: 'networking-introduction',
  todayHunting: 'networking-today-hunting',
  contactEmail: 'networking-email',
  phone: 'networking-phone',
  linkedinUrl: 'networking-linkedin',
};

const validationMessage = (field: EditableField): string => {
  if (field === 'participantNumber') {
    return 'Zadejte 1 až 8 číslic bez mezer.';
  }
  if (field === 'contactEmail') return 'Zadejte platný kontaktní e-mail.';
  if (field === 'phone') {
    return 'Zadejte telefon v mezinárodním formátu, například +420774835456.';
  }
  if (field === 'linkedinUrl') {
    return 'Použijte úplnou HTTPS adresu profilu na linkedin.com.';
  }
  if (field === 'todayHunting') return 'Vyberte nejvýše šest možností.';
  return 'Zkontrolujte délku a odstraňte nepovolené znaky.';
};

const requestProblemCode = (result: {
  readonly ok: boolean;
  readonly failure?: unknown;
}): string | null => {
  if (result.ok || !result.failure || typeof result.failure !== 'object') {
    return null;
  }
  const failure = result.failure as {
    readonly kind?: string;
    readonly problem?: { readonly code?: string };
  };
  return failure.kind === 'session_expired'
    ? 'AUTH_SESSION_EXPIRED'
    : (failure.problem?.code ?? null);
};

const settingsStateFromResult = (
  result: Awaited<ReturnType<typeof requestNetworkingSettings>>,
): State => {
  if (result.ok && result.kind === 'success') {
    return { status: 'ready', settings: result.data };
  }
  const code = requestProblemCode(result);
  if (code === 'NETWORKING_DISABLED') return { status: 'disabled' };
  if (code === 'AUTHENTICATION_REQUIRED' || code === 'AUTH_SESSION_EXPIRED') {
    return { status: 'authentication' };
  }
  return { status: 'error' };
};

export const NetworkingDirectory = ({
  api = browserInteractionsApi,
}: {
  readonly api?: ApiPort;
}) => {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [profiles, setProfiles] = useState<NetworkingDirectoryProfile[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [query, setQuery] = useState('');
  const [participantNumberQuery, setParticipantNumberQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<
    { tone: 'success' | 'warning' | 'danger'; text: string } | undefined
  >();
  const [errors, setErrors] = useState<Partial<Record<EditableField, string>>>(
    {},
  );
  const errorContainer = useRef<HTMLDivElement>(null);

  const reloadSettings = useCallback(() => {
    setState({ status: 'loading' });
    setNotice(undefined);
    void requestNetworkingSettings(api).then((result) => {
      setState(settingsStateFromResult(result));
    });
  }, [api]);

  useEffect(() => {
    let active = true;
    void requestNetworkingSettings(api).then((result) => {
      if (active) setState(settingsStateFromResult(result));
    });
    return () => {
      active = false;
    };
  }, [api]);

  const networkingEnabled =
    state.status === 'ready' && state.settings.networkingEnabled;

  useEffect(() => {
    if (!networkingEnabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setDirectoryStatus('loading');
      const parameters = new URLSearchParams();
      if (query.trim()) parameters.set('q', query.trim());
      if (participantNumberQuery) {
        parameters.set('participantNumber', participantNumberQuery);
      }
      if (filter) parameters.set('todayHunting', filter);
      void requestNetworkingDirectory(parameters.toString(), api).then(
        (result) => {
          if (cancelled) return;
          if (result.ok && result.kind === 'success') {
            setProfiles([...result.data.items]);
            setDirectoryStatus('ready');
          } else {
            setProfiles([]);
            setDirectoryStatus('error');
          }
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, filter, networkingEnabled, participantNumberQuery, query]);

  if (state.status === 'loading') {
    return <p role="status">Načítám nastavení networkingu…</p>;
  }
  if (state.status === 'disabled') {
    return (
      <StatePanel kind="empty" title="Networking zatím není zapnutý pro akci">
        <p>
          Vaše údaje zůstávají skryté. Funkci musí nejprve povolit organizátor.
        </p>
      </StatePanel>
    );
  }
  if (state.status === 'authentication') {
    return (
      <StatePanel
        action={
          <ActionLink href="/prihlaseni?returnTo=%2Fapp%2Fnetworking">
            Poslat nový přihlašovací odkaz
          </ActionLink>
        }
        kind="error"
        title="Přihlášení vypršelo"
      >
        <p>Pro správu vlastního profilu se znovu bezpečně přihlaste.</p>
      </StatePanel>
    );
  }
  if (state.status === 'error') {
    return (
      <StatePanel
        action={<Button onClick={reloadSettings}>Zkusit znovu</Button>}
        kind="error"
        title="Networking se nepodařilo načíst"
      >
        <p>Vaše nastavení jsme nezměnili.</p>
      </StatePanel>
    );
  }

  const { settings } = state;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working) return;
    const data = new FormData(event.currentTarget);
    const selected = Object.keys(hunting).filter((value) =>
      data.has(`hunt:${value}`),
    ) as NetworkingSettings['todayHunting'];
    const enabled = data.get('enabled') === 'on';
    const visibility = enabled ? 'directory' : 'hidden';
    const parsed = networkingSettingsUpdateRequestSchema.safeParse({
      expectedVersion: settings.version,
      networkingEnabled: enabled,
      introduction: String(data.get('introduction') ?? '').trim(),
      company: String(data.get('company') ?? '').trim(),
      jobTitle: String(data.get('jobTitle') ?? '').trim(),
      participantNumber:
        String(data.get('participantNumber') ?? '').trim() || null,
      todayHunting: selected,
      contactEmail: String(data.get('email') ?? '')
        .trim()
        .toLowerCase(),
      phone: String(data.get('phone') ?? '').trim() || null,
      linkedinUrl: String(data.get('linkedin') ?? '').trim() || null,
      emailVisibility: visibility,
      phoneVisibility: visibility,
      linkedinVisibility: visibility,
    });
    if (!parsed.success) {
      const nextErrors: Partial<Record<EditableField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          typeof field === 'string' &&
          field in fieldIds &&
          !nextErrors[field as EditableField]
        ) {
          nextErrors[field as EditableField] = validationMessage(
            field as EditableField,
          );
        }
      }
      setErrors(nextErrors);
      setNotice(undefined);
      requestAnimationFrame(() =>
        errorContainer.current
          ?.querySelector<HTMLElement>('.ui-error-summary')
          ?.focus(),
      );
      return;
    }

    setErrors({});
    setWorking(true);
    setNotice(undefined);
    void updateNetworkingSettings(parsed.data, api).then((result) => {
      setWorking(false);
      if (result.ok && result.kind === 'success') {
        setProfiles([]);
        setDirectoryStatus(result.data.networkingEnabled ? 'loading' : 'idle');
        setState({ status: 'ready', settings: result.data });
        setNotice({
          tone: 'success',
          text: result.data.networkingEnabled
            ? 'Profil je uložený a viditelný v adresáři.'
            : 'Profil je uložený a okamžitě skrytý.',
        });
        return;
      }
      const code = requestProblemCode(result);
      if (code === 'PARTICIPANT_NUMBER_TAKEN') {
        setErrors({
          participantNumber:
            'Toto číslo už používá jiný účastník. Zkontrolujte číslo, které jste dostali.',
        });
        setNotice({
          tone: 'danger',
          text: 'Číslo účastníka se nepodařilo uložit.',
        });
        requestAnimationFrame(() =>
          errorContainer.current
            ?.querySelector<HTMLElement>('.ui-error-summary')
            ?.focus(),
        );
        return;
      }
      setNotice({
        tone: code === 'STALE_VERSION' ? 'warning' : 'danger',
        text:
          code === 'STALE_VERSION'
            ? 'Profil se mezitím změnil. Načtěte aktuální údaje a změny zadejte znovu.'
            : 'Nastavení se nepodařilo uložit. Vaše původní volba zůstala beze změny.',
      });
    });
  };

  const summaryErrors = (Object.keys(errors) as EditableField[]).map(
    (field) => ({ fieldId: fieldIds[field], message: errors[field]! }),
  );

  return (
    <div className="participant-account-page networking-page">
      <header className="participant-account-heading">
        <p className="eyebrow">Dobrovolný adresář</p>
        <h1 data-route-heading tabIndex={-1}>
          Networking
        </h1>
        <p className="lead">
          Sami rozhodujete, zda vás ostatní účastníci uvidí. Vypnutím se celý
          profil okamžitě skryje.
        </p>
      </header>

      <Card className="participant-account-card networking-settings-card">
        <header>
          <p className="activation-kicker">Můj veřejný profil</p>
          <h2>Nastavení viditelnosti a kontaktů</h2>
          <p>
            Před zapnutím zkontrolujte všechna pole. Zapnutím zveřejníte
            vyplněné údaje ostatním přihlášeným účastníkům BYZON 2026.
          </p>
        </header>

        {notice ? (
          <Alert title={notice.text} tone={notice.tone}>
            {notice.tone === 'warning' ? (
              <Button onClick={reloadSettings} variant="secondary">
                Načíst aktuální profil
              </Button>
            ) : null}
          </Alert>
        ) : null}

        <div ref={errorContainer}>
          <ErrorSummary errors={summaryErrors} />
        </div>

        <form
          className="participant-account-form networking-form"
          key={settings.version}
          noValidate
          onSubmit={submit}
        >
          <ChoiceField
            defaultChecked={settings.networkingEnabled}
            description="Po uložení se profil objeví v adresáři; vypnutím jej ihned skryjete."
            disabled={working}
            id="networking-enabled"
            label="Zobrazit můj profil v adresáři"
            name="enabled"
            type="checkbox"
          />

          <FormField
            {...(errors.participantNumber
              ? { error: errors.participantNumber }
              : {})}
            helperText="Volitelné. Opište číslo, které jste dostali na řízeném networkingu. Ostatní vás podle něj rychle najdou."
            label="Číslo účastníka"
          >
            <Input
              autoComplete="off"
              defaultValue={settings.participantNumber ?? ''}
              disabled={working}
              id={fieldIds.participantNumber}
              inputMode="numeric"
              maxLength={8}
              name="participantNumber"
              pattern="[0-9]{1,8}"
              type="text"
            />
          </FormField>

          <div className="onboarding-fields">
            <FormField
              {...(errors.company ? { error: errors.company } : {})}
              label="Firma"
            >
              <Input
                autoComplete="organization"
                defaultValue={settings.company}
                disabled={working}
                id={fieldIds.company}
                maxLength={160}
                name="company"
              />
            </FormField>
            <FormField
              {...(errors.jobTitle ? { error: errors.jobTitle } : {})}
              label="Pozice"
            >
              <Input
                autoComplete="organization-title"
                defaultValue={settings.jobTitle}
                disabled={working}
                id={fieldIds.jobTitle}
                maxLength={160}
                name="jobTitle"
              />
            </FormField>
          </div>

          <FormField
            {...(errors.introduction ? { error: errors.introduction } : {})}
            helperText="Krátce popište, čemu se věnujete a s kým se chcete propojit."
            label="Krátké představení"
          >
            <Textarea
              defaultValue={settings.introduction}
              disabled={working}
              id={fieldIds.introduction}
              maxLength={1000}
              name="introduction"
              rows={5}
            />
          </FormField>

          <fieldset className="networking-hunting" id={fieldIds.todayHunting}>
            <legend>Dnes hledám</legend>
            <div className="networking-choice-grid">
              {Object.entries(hunting).map(([value, label]) => (
                <ChoiceField
                  defaultChecked={settings.todayHunting.includes(
                    value as keyof typeof hunting,
                  )}
                  disabled={working}
                  key={value}
                  label={label}
                  name={`hunt:${value}`}
                  type="checkbox"
                />
              ))}
            </div>
          </fieldset>

          <div className="onboarding-fields">
            <FormField
              {...(errors.contactEmail ? { error: errors.contactEmail } : {})}
              helperText="Při zapnutém networkingu bude viditelný v adresáři."
              label="Kontaktní e-mail"
              required
            >
              <Input
                autoComplete="email"
                defaultValue={settings.contactEmail}
                disabled={working}
                id={fieldIds.contactEmail}
                inputMode="email"
                maxLength={320}
                name="email"
                type="email"
              />
            </FormField>
            <FormField
              {...(errors.phone ? { error: errors.phone } : {})}
              helperText="Volitelné, v mezinárodním formátu."
              label="Telefon"
            >
              <Input
                autoComplete="tel"
                defaultValue={settings.phone ?? ''}
                disabled={working}
                id={fieldIds.phone}
                inputMode="tel"
                maxLength={16}
                name="phone"
                type="tel"
              />
            </FormField>
          </div>

          <FormField
            {...(errors.linkedinUrl ? { error: errors.linkedinUrl } : {})}
            helperText="Volitelné. Pouze úplná HTTPS adresa profilu na linkedin.com."
            label="LinkedIn"
          >
            <Input
              autoComplete="url"
              defaultValue={settings.linkedinUrl ?? ''}
              disabled={working}
              id={fieldIds.linkedinUrl}
              maxLength={2048}
              name="linkedin"
              type="url"
            />
          </FormField>

          <div className="participant-account-actions">
            <Button
              loading={working}
              loadingLabel="Ukládám nastavení…"
              type="submit"
            >
              Uložit nastavení
            </Button>
          </div>
        </form>
      </Card>

      {settings.networkingEnabled ? (
        <Card className="participant-account-card networking-directory-card">
          <header>
            <p className="activation-kicker">Adresář účastníků</p>
            <h2>Najděte lidi pro dnešní setkání</h2>
          </header>
          <div className="networking-directory-filters">
            <FormField
              helperText="Zadejte celé číslo účastníka."
              label="Hledat podle čísla"
            >
              <Input
                autoComplete="off"
                id="networking-number-search"
                inputMode="numeric"
                maxLength={8}
                onChange={(event) =>
                  setParticipantNumberQuery(
                    event.target.value.replace(/\D/g, '').slice(0, 8),
                  )
                }
                pattern="[0-9]{1,8}"
                type="search"
                value={participantNumberQuery}
              />
            </FormField>
            <FormField label="Hledat podle jména nebo firmy">
              <Input
                id="networking-search"
                onChange={(event) => setQuery(event.target.value)}
                type="search"
                value={query}
              />
            </FormField>
            <FormField label="Co dnes hledají">
              <Select
                id="networking-filter"
                onChange={(event) => setFilter(event.target.value)}
                value={filter}
              >
                <option value="">Vše</option>
                {Object.entries(hunting).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          {directoryStatus === 'idle' || directoryStatus === 'loading' ? (
            <p role="status">Načítám adresář…</p>
          ) : directoryStatus === 'error' ? (
            <p role="alert">Adresář se nepodařilo načíst.</p>
          ) : profiles.length ? (
            <ul className="networking-directory-list">
              {profiles.map((profile) => (
                <li key={profile.profileId}>
                  <Link href={`/app/networking/${profile.profileId}`}>
                    <span className="networking-directory-name">
                      <strong>{profile.displayName}</strong>
                      {profile.participantNumber ? (
                        <span className="networking-participant-number">
                          Číslo {profile.participantNumber}
                        </span>
                      ) : null}
                    </span>
                    <span>
                      {[profile.jobTitle, profile.company]
                        .filter(Boolean)
                        .join(' · ') || 'Účastník BYZON 2026'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : directoryStatus === 'ready' ? (
            <p>Žádné odpovídající profily.</p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
};

export const NetworkingProfile = ({
  api = browserInteractionsApi,
  profileId,
}: {
  readonly api?: ApiPort;
  readonly profileId: string;
}) => {
  const [profile, setProfile] = useState<NetworkingDirectoryProfile | null>();
  useEffect(() => {
    void requestNetworkingProfile(profileId, api).then((result) =>
      setProfile(result.ok && result.kind === 'success' ? result.data : null),
    );
  }, [api, profileId]);
  if (profile === undefined) return <p role="status">Načítám profil…</p>;
  if (profile === null) return <p role="alert">Profil není dostupný.</p>;
  return (
    <Card className="networking-profile-card">
      <p className="eyebrow">Networking</p>
      <h1>{profile.displayName}</h1>
      {profile.participantNumber ? (
        <p className="networking-participant-number networking-profile-number">
          Účastník č. {profile.participantNumber}
        </p>
      ) : null}
      <p>{[profile.jobTitle, profile.company].filter(Boolean).join(' · ')}</p>
      {profile.introduction ? <p>{profile.introduction}</p> : null}
      <ul>
        {profile.todayHunting.map((value) => (
          <li key={value}>{hunting[value]}</li>
        ))}
      </ul>
      <address>
        {profile.contacts.email ? (
          <a href={`mailto:${profile.contacts.email}`}>
            {profile.contacts.email}
          </a>
        ) : null}
        {profile.contacts.phone ? (
          <a href={`tel:${profile.contacts.phone}`}>{profile.contacts.phone}</a>
        ) : null}
        {profile.contacts.linkedinUrl ? (
          <a href={profile.contacts.linkedinUrl} rel="noreferrer">
            LinkedIn
          </a>
        ) : null}
      </address>
      <Link className="text-link" href="/app/networking">
        ← Zpět do adresáře
      </Link>
    </Card>
  );
};
