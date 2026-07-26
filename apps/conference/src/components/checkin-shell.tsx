'use client';

import type { CheckinBootstrapResponse } from '@byzon/domain/contracts/check-in';
import { Button, StatusBadge } from '@byzon/ui';
import type { ReactNode } from 'react';

import styles from './checkin.module.css';

const roleLabel = {
  checkin_operator: 'Operátor check-inu',
  organizer_admin: 'Administrátor akce',
} as const;

const ContextIcon = ({
  kind,
}: {
  readonly kind: 'event' | 'station' | 'device' | 'role';
}) => {
  const path = {
    event: (
      <>
        <rect height="15" rx="2" width="17" x="3.5" y="5.5" />
        <path d="M7 3v5M17 3v5M3.5 10h17" />
      </>
    ),
    station: (
      <>
        <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    device: (
      <>
        <rect height="18" rx="2.5" width="12" x="6" y="3" />
        <path d="M10 6h4M11 18h2" />
      </>
    ),
    role: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </>
    ),
  } as const;

  return (
    <svg
      aria-hidden="true"
      className={styles.contextIcon}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {path[kind]}
    </svg>
  );
};

export const CheckinShell = ({
  children,
  connectivity,
  context,
  onReset,
  resetDisabled = false,
}: {
  readonly children: ReactNode;
  readonly connectivity: 'online' | 'offline';
  readonly context: CheckinBootstrapResponse;
  readonly onReset: () => void;
  readonly resetDisabled?: boolean;
}) => (
  <div className={styles.page}>
    <a className={styles.skipLink} href="#checkin-workspace">
      Přeskočit na odbavení
    </a>
    <header className={styles.topbar}>
      <div className={styles.brandBlock}>
        <span aria-hidden="true" className={styles.brandMark}>
          B
        </span>
        <div>
          <p className={styles.overline}>BYZON · CHECK-IN</p>
          <p className={styles.eventName}>{context.event.name}</p>
        </div>
      </div>
      <div className={styles.topbarActions}>
        <StatusBadge tone={connectivity === 'online' ? 'success' : 'danger'}>
          {connectivity === 'online' ? 'Online' : 'Offline'}
        </StatusBadge>
        <Button
          disabled={resetDisabled}
          onClick={onReset}
          size="small"
          variant="secondary"
        >
          Nový scan
        </Button>
      </div>
    </header>

    <aside aria-label="Kontext odbavení" className={styles.contextBar}>
      <dl className={styles.contextGrid}>
        <div>
          <dt>
            <ContextIcon kind="event" />
            Event
          </dt>
          <dd>{context.event.name}</dd>
        </div>
        <div>
          <dt>
            <ContextIcon kind="station" />
            Stanoviště
          </dt>
          <dd>{context.station.name}</dd>
        </div>
        <div>
          <dt>
            <ContextIcon kind="device" />
            Zařízení
          </dt>
          <dd>
            {context.device.label}
            <span className={styles.contextState}>
              {context.device.state === 'trusted' ? 'Ověřené' : 'Revokované'}
            </span>
          </dd>
        </div>
        <div>
          <dt>
            <ContextIcon kind="role" />
            Role
          </dt>
          <dd>
            {roleLabel[context.actor.role]}
            <span className={styles.contextState}>
              {context.actor.displayLabel}
            </span>
          </dd>
        </div>
      </dl>
    </aside>

    <div className={styles.workspace} id="checkin-workspace" tabIndex={-1}>
      {connectivity === 'offline' && (
        <div className={styles.offlineBanner} role="alert">
          <strong>Offline check-in není podporovaný.</strong>
          <span>
            Bez online autority nelze hledat ani potvrzovat vstupy. Obnovte
            připojení; žádná akce se nezařadí do fronty.
          </span>
        </div>
      )}
      {children}
    </div>

    <footer className={styles.safetyFooter}>
      <span>
        Offline check-in není podporovaný · online autorita · žádná offline
        fronta
      </span>
      <span>
        Scan pouze vyhledá záznam · syntetický credential adapter, ne reálný ·
        check-in vyžaduje potvrzení
      </span>
    </footer>
  </div>
);
