'use client';

import type {
  NetworkingDirectoryProfile,
  NetworkingSettings,
} from '@byzon/domain/contracts';
import { Button, Card } from '@byzon/ui';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import {
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
  | { status: 'error' }
  | { status: 'ready'; settings: NetworkingSettings };

export const NetworkingDirectory = () => {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [profiles, setProfiles] = useState<NetworkingDirectoryProfile[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');

  const loadSettings = () => {
    void requestNetworkingSettings().then((result) => {
      if (result.ok && result.kind === 'success') {
        setState({ status: 'ready', settings: result.data });
      } else if (
        !result.ok &&
        result.failure.kind === 'problem' &&
        result.failure.problem.code === 'NETWORKING_DISABLED'
      ) {
        setState({ status: 'disabled' });
      } else {
        setState({ status: 'error' });
      }
    });
  };

  useEffect(loadSettings, []);

  useEffect(() => {
    if (state.status !== 'ready' || !state.settings.networkingEnabled) {
      return;
    }
    const parameters = new URLSearchParams();
    if (query.trim()) parameters.set('q', query.trim());
    if (filter) parameters.set('todayHunting', filter);
    void requestNetworkingDirectory(parameters.toString()).then((result) => {
      setProfiles(
        result.ok && result.kind === 'success' ? [...result.data.items] : [],
      );
    });
  }, [filter, query, state]);

  if (state.status === 'loading')
    return <p role="status">Načítám networking…</p>;
  if (state.status === 'disabled') {
    return (
      <Card>
        <h1>Networking zatím není zapnutý</h1>
        <p>
          Adresář se zpřístupní až po schválení pravidel soukromí organizátorem.
        </p>
      </Card>
    );
  }
  if (state.status === 'error')
    return <p role="alert">Networking se nepodařilo načíst.</p>;

  const { settings } = state;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setNotice('');
    const data = new FormData(event.currentTarget);
    const selected = Object.keys(hunting).filter((value) =>
      data.has(`hunt:${value}`),
    ) as NetworkingSettings['todayHunting'];
    const networkingEnabled = data.get('enabled') === 'on';
    const visibility = networkingEnabled ? 'directory' : 'hidden';
    void updateNetworkingSettings({
      expectedVersion: settings.version,
      networkingEnabled,
      introduction: String(data.get('introduction') ?? '').trim(),
      company: String(data.get('company') ?? '').trim(),
      jobTitle: String(data.get('jobTitle') ?? '').trim(),
      todayHunting: selected,
      contactEmail: String(data.get('email') ?? '').trim(),
      phone: String(data.get('phone') ?? '').trim() || null,
      linkedinUrl: String(data.get('linkedin') ?? '').trim() || null,
      emailVisibility: visibility,
      phoneVisibility: visibility,
      linkedinVisibility: visibility,
    }).then((result) => {
      setWorking(false);
      if (result.ok && result.kind === 'success') {
        setState({ status: 'ready', settings: result.data });
        setNotice(
          result.data.networkingEnabled
            ? 'Profil je viditelný v adresáři.'
            : 'Profil byl okamžitě skrytý.',
        );
      } else {
        setNotice('Nastavení se nepodařilo uložit. Načtěte profil znovu.');
      }
    });
  };

  return (
    <div className="participant-account-stack">
      <header>
        <p className="eyebrow">Dobrovolný adresář</p>
        <h1 data-route-heading tabIndex={-1}>
          Networking
        </h1>
        <p>
          Profil není vidět, dokud jej výslovně nezapnete. Po zapnutí se
          ostatním účastníkům zobrazí všechna pole, která zde vyplníte. Aplikace
          neposílá zprávy ani žádosti o spojení.
        </p>
      </header>
      <Card>
        <form onSubmit={submit}>
          <label>
            <input
              defaultChecked={settings.networkingEnabled}
              name="enabled"
              type="checkbox"
            />{' '}
            Zobrazit můj profil v adresáři
          </label>
          <label>
            Firma
            <input
              defaultValue={settings.company}
              maxLength={160}
              name="company"
            />
          </label>
          <label>
            Pozice
            <input
              defaultValue={settings.jobTitle}
              maxLength={160}
              name="jobTitle"
            />
          </label>
          <label>
            Krátké představení
            <textarea
              defaultValue={settings.introduction}
              maxLength={1000}
              name="introduction"
            />
          </label>
          <fieldset>
            <legend>Dnes hledám</legend>
            {Object.entries(hunting).map(([value, label]) => (
              <label key={value}>
                <input
                  defaultChecked={settings.todayHunting.includes(
                    value as keyof typeof hunting,
                  )}
                  name={`hunt:${value}`}
                  type="checkbox"
                />{' '}
                {label}
              </label>
            ))}
          </fieldset>
          <label>
            Kontaktní e-mail
            <input
              defaultValue={settings.contactEmail}
              name="email"
              type="email"
            />
          </label>
          <label>
            Telefon
            <input defaultValue={settings.phone ?? ''} name="phone" />
          </label>
          <label>
            LinkedIn
            <input
              defaultValue={settings.linkedinUrl ?? ''}
              name="linkedin"
              type="url"
            />
          </label>
          <p>
            Zapnutím adresáře zveřejníte ostatním účastníkům všechna výše
            vyplněná pole. Vypnutím se celý profil okamžitě skryje.
          </p>
          <Button disabled={working} type="submit">
            {working ? 'Ukládám…' : 'Uložit nastavení'}
          </Button>
          {notice ? <p role="status">{notice}</p> : null}
        </form>
      </Card>
      {settings.networkingEnabled ? (
        <Card>
          <h2>Adresář účastníků</h2>
          <label>
            Hledat podle jména nebo firmy
            <input
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              value={query}
            />
          </label>
          <label>
            Co dnes hledají
            <select
              onChange={(event) => setFilter(event.target.value)}
              value={filter}
            >
              <option value="">Vše</option>
              {Object.entries(hunting).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {profiles.length ? (
            <ul>
              {profiles.map((profile) => (
                <li key={profile.profileId}>
                  <Link href={`/app/networking/${profile.profileId}`}>
                    <strong>{profile.displayName}</strong>
                    {profile.company ? ` · ${profile.company}` : ''}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>Žádné odpovídající profily.</p>
          )}
        </Card>
      ) : null}
    </div>
  );
};

export const NetworkingProfile = ({ profileId }: { profileId: string }) => {
  const [profile, setProfile] = useState<NetworkingDirectoryProfile | null>();
  useEffect(() => {
    void requestNetworkingProfile(profileId).then((result) =>
      setProfile(result.ok && result.kind === 'success' ? result.data : null),
    );
  }, [profileId]);
  if (profile === undefined) return <p role="status">Načítám profil…</p>;
  if (profile === null) return <p role="alert">Profil není dostupný.</p>;
  return (
    <Card>
      <p className="eyebrow">Networking</p>
      <h1>{profile.displayName}</h1>
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
