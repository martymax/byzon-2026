'use client';

import {
  ActionLink,
  Alert,
  Button,
  Skeleton,
  StatePanel,
  StatusBadge,
} from '@byzon/ui';
import {
  activationClaimRequestSchema,
  type ActivationClaimProblem,
  type ActivationClaimResponse,
  type ApiFailure,
  type RequestId,
} from '@byzon/domain/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserActivationApi,
  submitActivationClaim,
} from '@/lib/activation-api';
import { useActivationEntry } from '@/components/activation-entry';

export interface ActivationCameraSession {
  readonly attach: (video: HTMLVideoElement) => void;
  readonly stop: () => void;
}

export type ActivationCameraRequest =
  | {
      readonly kind: 'granted';
      readonly session: ActivationCameraSession;
    }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unsupported' };

export interface ActivationCameraPort {
  readonly isSupported: () => boolean;
  readonly request: () => Promise<ActivationCameraRequest>;
  readonly readSyntheticCode: () => Promise<string>;
}

const createSyntheticCameraCode = (): string => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `camera:${suffix}`;
};

export const browserActivationCamera: ActivationCameraPort = Object.freeze({
  isSupported: () =>
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === 'function',
  request: async (): Promise<ActivationCameraRequest> => {
    if (
      typeof window === 'undefined' ||
      !window.isSecureContext ||
      typeof navigator.mediaDevices?.getUserMedia !== 'function'
    ) {
      return { kind: 'unsupported' };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
      let stopped = false;
      let attachedVideo: HTMLVideoElement | undefined;
      return {
        kind: 'granted',
        session: {
          attach: (video: HTMLVideoElement) => {
            if (stopped) return;
            attachedVideo = video;
            video.srcObject = stream;
            void video.play().catch(() => undefined);
          },
          stop: () => {
            if (stopped) return;
            stopped = true;
            for (const track of stream.getTracks()) track.stop();
            if (attachedVideo) {
              attachedVideo.srcObject = null;
              attachedVideo = undefined;
            }
          },
        },
      };
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return { kind: 'denied' };
      }
      if (
        name === 'NotFoundError' ||
        name === 'NotReadableError' ||
        name === 'OverconstrainedError'
      ) {
        return { kind: 'unavailable' };
      }
      return { kind: 'unavailable' };
    }
  },
  readSyntheticCode: async () => createSyntheticCameraCode(),
});

type ScannerFailure =
  | { readonly kind: 'rejected' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'error'; readonly requestId?: RequestId };

type ScannerState =
  | { readonly status: 'intro' }
  | { readonly status: 'requesting' }
  | { readonly status: 'scanning' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'denied' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'claiming' }
  | { readonly status: 'failure'; readonly failure: ScannerFailure }
  | {
      readonly status: 'success';
      readonly outcome: ActivationClaimResponse;
    };

const mapClaimFailure = (
  failure: ApiFailure<ActivationClaimProblem>,
): ScannerFailure | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { kind: 'offline' };
    case 'session_expired':
      return { kind: 'session_expired' };
    case 'problem':
      if (
        failure.problem.code === 'CLAIM_REJECTED' ||
        failure.problem.code === 'ACTIVATION_CLOSED'
      ) {
        return { kind: 'rejected' };
      }
      if (failure.problem.code === 'CLAIM_RATE_LIMITED') {
        return { kind: 'rate_limited' };
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

const createIdempotencyKey = (): string => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `camera-claim-${suffix}`;
};

const ManualFallback = () => (
  <ActionLink href="/aktivace/kod" variant="secondary">
    Zadat kód ručně
  </ActionLink>
);

export const ActivationScanner = ({
  api = browserActivationApi,
  camera = browserActivationCamera,
  createClaimKey = createIdempotencyKey,
}: {
  readonly api?: ApiPort;
  readonly camera?: ActivationCameraPort;
  readonly createClaimKey?: () => string;
}) => {
  const router = useRouter();
  const [state, setState] = useState<ScannerState>({ status: 'intro' });
  const mounted = useRef(true);
  const session = useRef<ActivationCameraSession | undefined>(undefined);
  const requestGeneration = useRef(0);
  const claimLocked = useRef(false);

  const stopCamera = () => {
    session.current?.stop();
    session.current = undefined;
  };

  useEffect(() => {
    mounted.current = true;
    const suspendCamera = () => {
      requestGeneration.current += 1;
      session.current?.stop();
      session.current = undefined;
      if (mounted.current) setState({ status: 'cancelled' });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') suspendCamera();
    };
    window.addEventListener('pagehide', suspendCamera);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
      session.current?.stop();
      session.current = undefined;
      window.removeEventListener('pagehide', suspendCamera);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const requestCamera = async () => {
    if (state.status === 'requesting' || state.status === 'claiming') return;
    stopCamera();
    claimLocked.current = false;
    if (!camera.isSupported()) {
      setState({ status: 'unsupported' });
      return;
    }

    setState({ status: 'requesting' });
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    try {
      const result = await camera.request();
      if (!mounted.current || requestGeneration.current !== generation) {
        if (result.kind === 'granted') result.session.stop();
        return;
      }
      if (result.kind === 'granted') {
        session.current = result.session;
        setState({ status: 'scanning' });
        return;
      }
      setState({ status: result.kind });
    } catch {
      if (mounted.current) setState({ status: 'unavailable' });
    }
  };

  const cancel = () => {
    requestGeneration.current += 1;
    claimLocked.current = false;
    stopCamera();
    setState({ status: 'cancelled' });
  };

  const submitSyntheticScan = async () => {
    if (state.status !== 'scanning' || claimLocked.current) return;
    claimLocked.current = true;
    setState({ status: 'claiming' });
    try {
      const code = await camera.readSyntheticCode();
      stopCamera();
      const parsed = activationClaimRequestSchema.safeParse({
        code,
        method: 'camera_scan',
      });
      if (!parsed.success) {
        claimLocked.current = false;
        setState({ status: 'failure', failure: { kind: 'error' } });
        return;
      }
      const result = await submitActivationClaim(
        api,
        parsed.data,
        createClaimKey(),
      );
      if (!mounted.current) return;
      if (result.ok && result.kind === 'success') {
        setState({ status: 'success', outcome: result.data });
        return;
      }
      if (!result.ok) {
        const failure = mapClaimFailure(result.failure);
        if (failure) {
          claimLocked.current = false;
          setState({ status: 'failure', failure });
        }
      } else {
        claimLocked.current = false;
        setState({ status: 'failure', failure: { kind: 'error' } });
      }
    } catch {
      stopCamera();
      if (mounted.current) {
        claimLocked.current = false;
        setState({ status: 'failure', failure: { kind: 'error' } });
      }
    }
  };

  if (state.status === 'success') {
    const recovery = state.outcome.state === 'recovery_required';
    return (
      <section className="activation-form-page">
        <p className="eyebrow">Aktivace · další krok</p>
        <h1 data-route-heading tabIndex={-1}>
          {recovery ? 'Obnovte svůj přístup' : 'Ověřte svou identitu'}
        </h1>
        <StatePanel
          action={
            <Button onClick={() => router.push('/prihlaseni')}>
              {recovery ? 'Pokračovat k obnově' : 'Pokračovat k ověření'}
            </Button>
          }
          kind="empty"
          title="Syntetický QR byl přijat"
        >
          <p>
            Kamera ani QR se neuložily. Ukázka nevytvořila skutečný účet,
            membership ani přihlášenou relaci.
          </p>
        </StatePanel>
      </section>
    );
  }

  const busy = state.status === 'requesting' || state.status === 'claiming';

  return (
    <section className="activation-form-page activation-scanner">
      <header>
        <div className="activation-section-heading">
          <div>
            <p className="eyebrow">Aktivace · kamera</p>
            <h1 data-route-heading tabIndex={-1}>
              Načtěte QR ze vstupenky
            </h1>
          </div>
          <StatusBadge tone="warning">Mock QR</StatusBadge>
        </div>
        <p className="lead">
          O přístup ke kameře požádáme až po vašem potvrzení. Obraz ani kód
          neukládáme.
        </p>
      </header>

      {state.status === 'denied' ? (
        <StatePanel
          action={<ManualFallback />}
          kind="permission"
          title="Přístup ke kameře byl odmítnut"
        >
          <p>
            Oprávnění můžete změnit v nastavení prohlížeče nebo pokračovat
            ručním zadáním.
          </p>
        </StatePanel>
      ) : null}

      {state.status === 'unsupported' ? (
        <StatePanel
          action={<ManualFallback />}
          kind="empty"
          title="Kamera na tomto zařízení není dostupná"
        >
          <p>Pro aktivaci použijte bezpečné ruční zadání kódu.</p>
        </StatePanel>
      ) : null}

      {state.status === 'unavailable' ? (
        <StatePanel
          action={<ManualFallback />}
          kind="error"
          title="Kameru se nepodařilo spustit"
        >
          <p>
            Může ji používat jiná aplikace. Zkuste to znovu nebo zadejte kód
            ručně.
          </p>
        </StatePanel>
      ) : null}

      {state.status === 'cancelled' ? (
        <StatePanel
          action={<ManualFallback />}
          kind="empty"
          title="Skenování bylo bezpečně ukončeno"
        >
          <p>Kamera je vypnutá a můžete zvolit jinou cestu.</p>
        </StatePanel>
      ) : null}

      {state.status === 'failure' ? (
        <Alert
          title={
            state.failure.kind === 'offline'
              ? 'Aktivace vyžaduje připojení'
              : state.failure.kind === 'session_expired'
                ? 'Přihlášení vypršelo'
                : state.failure.kind === 'rate_limited'
                  ? 'Příliš mnoho pokusů'
                  : state.failure.kind === 'rejected'
                    ? 'QR nelze použít'
                    : 'Aktivaci se nepodařilo dokončit'
          }
          tone={
            state.failure.kind === 'error' || state.failure.kind === 'rejected'
              ? 'danger'
              : 'warning'
          }
        >
          {state.failure.kind === 'rejected' ? (
            'Kód nelze použít. Zvolte ruční zadání nebo obnovu přístupu.'
          ) : state.failure.kind === 'rate_limited' ? (
            'Chvíli počkejte a potom spusťte nový vědomý pokus.'
          ) : state.failure.kind === 'offline' ? (
            'QR se bez spojení se serverem nesmí ověřovat ani ukládat.'
          ) : state.failure.kind === 'session_expired' ? (
            'Pokračujte bezpečným přihlášením. QR ani kód se do návratu nepřenese.'
          ) : (
            <>
              Zkuste to znovu. Podpoře případně předejte pouze
              {state.failure.requestId ? (
                <>
                  {' '}
                  referenci <code>{state.failure.requestId}</code>
                </>
              ) : (
                ' obecný popis potíží'
              )}
              .
            </>
          )}
        </Alert>
      ) : null}

      {state.status === 'scanning' || state.status === 'claiming' ? (
        <div className="activation-camera-stage">
          <video
            aria-label="Živý náhled kamery"
            autoPlay
            muted
            playsInline
            ref={(video) => {
              if (video) session.current?.attach(video);
            }}
          />
          <div className="activation-camera-reticle" aria-hidden="true" />
          <p aria-live="polite">
            {state.status === 'claiming'
              ? 'Ověřuji syntetický QR…'
              : 'Namiřte kameru na QR. V ukázce dokončete načtení tlačítkem.'}
          </p>
        </div>
      ) : null}

      {state.status === 'intro' ? (
        <div className="activation-camera-explainer">
          <h2>Než kameru zapnete</h2>
          <ul>
            <li>Prohlížeč zobrazí vlastní žádost o oprávnění.</li>
            <li>Žádný obraz, snímek ani QR neukládáme.</li>
            <li>Kameru můžete kdykoli vypnout a zadat kód ručně.</li>
          </ul>
        </div>
      ) : null}

      <div className="activation-form-actions activation-scanner-actions">
        {state.status === 'intro' ||
        state.status === 'cancelled' ||
        state.status === 'denied' ||
        state.status === 'unavailable' ||
        state.status === 'failure' ? (
          <Button disabled={busy} onClick={() => void requestCamera()}>
            {state.status === 'intro'
              ? 'Povolit kameru'
              : 'Zkusit kameru znovu'}
          </Button>
        ) : null}
        {state.status === 'requesting' ? (
          <Button disabled loading loadingLabel="Čekám na oprávnění…">
            Povolit kameru
          </Button>
        ) : null}
        {state.status === 'scanning' ? (
          <Button onClick={() => void submitSyntheticScan()}>
            Načíst syntetický QR
          </Button>
        ) : null}
        {state.status === 'claiming' ? (
          <Button disabled loading loadingLabel="Ověřuji QR…">
            Načíst syntetický QR
          </Button>
        ) : null}
        {state.status === 'requesting' ||
        state.status === 'scanning' ||
        state.status === 'claiming' ? (
          <Button onClick={cancel} variant="quiet">
            Zrušit skenování
          </Button>
        ) : null}
        {state.status === 'failure' &&
        state.failure.kind === 'session_expired' ? (
          <ActionLink href="/prihlaseni?returnTo=%2Faktivace">
            Obnovit přihlášení
          </ActionLink>
        ) : null}
        {state.status !== 'unsupported' &&
        state.status !== 'denied' &&
        state.status !== 'cancelled' &&
        state.status !== 'unavailable' ? (
          <ManualFallback />
        ) : null}
        <ActionLink href="/aktivace" variant="quiet">
          Zpět
        </ActionLink>
      </div>

      <aside className="preview-disclaimer" aria-label="Omezení mock scanneru">
        V mock režimu QR nedekódujeme. Tlačítko vytvoří jednorázovou syntetickou
        hodnotu pouze v paměti a odešle ji stejným validovaným API portem.
      </aside>
    </section>
  );
};

const ScannerGateShell = ({ children }: { readonly children: ReactNode }) => (
  <section className="activation-form-page">
    <header>
      <p className="eyebrow">Aktivace · kamera</p>
      <h1 data-route-heading tabIndex={-1}>
        Připravuji bezpečný scanner
      </h1>
    </header>
    {children}
  </section>
);

export const ActivationScannerGate = ({
  api = browserActivationApi,
  camera = browserActivationCamera,
}: {
  readonly api?: ApiPort;
  readonly camera?: ActivationCameraPort;
}) => {
  const gate = useActivationEntry(api);

  if (gate.status === 'loading') {
    return (
      <ScannerGateShell>
        <Skeleton label="Ověřuji dostupnost scanneru" lines={5} />
      </ScannerGateShell>
    );
  }

  if (gate.status === 'offline') {
    return (
      <ScannerGateShell>
        <StatePanel
          action={<Button onClick={gate.retry}>Zkusit znovu</Button>}
          kind="offline"
          title="Aktivace vyžaduje připojení"
        >
          <p>Kameru bez ověření aktuálního stavu aktivace nespustíme.</p>
        </StatePanel>
      </ScannerGateShell>
    );
  }

  if (gate.status === 'session_expired') {
    return (
      <ScannerGateShell>
        <StatePanel
          action={
            <ActionLink href="/prihlaseni?returnTo=%2Faktivace">
              Obnovit přihlášení
            </ActionLink>
          }
          kind="session-expired"
          title="Přihlášení vypršelo"
        >
          <p>Po přihlášení začnete znovu bez přenosu QR nebo ticket kódu.</p>
        </StatePanel>
      </ScannerGateShell>
    );
  }

  if (gate.status === 'error') {
    return (
      <ScannerGateShell>
        <StatePanel
          action={<Button onClick={gate.retry}>Zkusit znovu</Button>}
          kind="error"
          title="Dostupnost scanneru se nepodařilo ověřit"
        >
          <p>
            Kameru jsme nespustili.
            {gate.requestId ? (
              <>
                {' '}
                Reference: <code>{gate.requestId}</code>
              </>
            ) : null}
          </p>
        </StatePanel>
      </ScannerGateShell>
    );
  }

  if (gate.status === 'closed') {
    return (
      <ScannerGateShell>
        <StatePanel
          action={
            <ActionLink href="/aktivace/kod" variant="secondary">
              Zadat kód ručně
            </ActionLink>
          }
          kind="empty"
          title="Scanner teď není dostupný"
        >
          <p>Aktivace není otevřená. Kamera zůstala vypnutá.</p>
        </StatePanel>
      </ScannerGateShell>
    );
  }

  const { availability, flow } = gate.data;
  const cameraAllowed =
    availability.state === 'open' &&
    availability.methods.includes('camera_scan') &&
    availability.methods.includes('manual_code');
  if (!cameraAllowed) {
    return (
      <ScannerGateShell>
        <StatePanel
          action={
            <ActionLink href="/aktivace/kod" variant="secondary">
              Zadat kód ručně
            </ActionLink>
          }
          kind="empty"
          title="Aktivace kamerou není dostupná"
        >
          <p>Pro tento průchod zvolte nabízenou ruční cestu.</p>
        </StatePanel>
      </ScannerGateShell>
    );
  }

  if (flow.state !== 'anonymous') {
    return (
      <ScannerGateShell>
        <StatePanel
          action={
            <ActionLink href="/aktivace">Zkontrolovat aktivaci</ActionLink>
          }
          kind={flow.state === 'suspended' ? 'permission' : 'stale'}
          title="Kameru není potřeba spouštět"
        >
          <p>
            Aktivace už má bezpečný navazující stav. Pokračujte přes hlavní
            aktivační obrazovku.
          </p>
        </StatePanel>
      </ScannerGateShell>
    );
  }

  return <ActivationScanner api={api} camera={camera} />;
};
