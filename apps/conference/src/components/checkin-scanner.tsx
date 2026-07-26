'use client';

import { Button, FormField, Input } from '@byzon/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { CheckinLookupRequest } from '@byzon/domain/contracts/check-in';
import { useTransitionFocus } from './use-transition-focus';
import styles from './checkin.module.css';

export interface CheckinScenarioCode {
  readonly code: string;
  readonly label: string;
}

const noScenarioCodes: readonly CheckinScenarioCode[] = Object.freeze([]);

export interface CheckinCameraSession {
  readonly attach: (video: HTMLVideoElement) => void;
  readonly stop: () => void;
}

export type CheckinCameraRequest =
  | { readonly kind: 'granted'; readonly session: CheckinCameraSession }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unsupported' };

export interface CheckinCameraPort {
  readonly isSupported: () => boolean;
  readonly request: () => Promise<CheckinCameraRequest>;
  readonly readSyntheticCredential: () => Promise<string>;
}

export const browserCheckinCamera: CheckinCameraPort = Object.freeze({
  isSupported: () =>
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === 'function',
  request: async (): Promise<CheckinCameraRequest> => {
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
          attach: (video) => {
            if (stopped) return;
            attachedVideo = video;
            video.srcObject = stream;
            void video.play().catch(() => undefined);
          },
          stop: () => {
            if (stopped) return;
            stopped = true;
            for (const track of stream.getTracks()) track.stop();
            if (attachedVideo) attachedVideo.srcObject = null;
            attachedVideo = undefined;
          },
        },
      };
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return { kind: 'denied' };
      }
      return { kind: 'unavailable' };
    }
  },
  readSyntheticCredential: async () => {
    throw new Error('Synthetic credential adapter is unavailable.');
  },
});

type CameraState =
  | 'intro'
  | 'requesting'
  | 'scanning'
  | 'cancelled'
  | 'denied'
  | 'unsupported'
  | 'unavailable';

const cameraCopy: Record<
  Exclude<CameraState, 'intro' | 'requesting' | 'scanning'>,
  { readonly title: string; readonly detail: string }
> = {
  cancelled: {
    title: 'Skenování bylo zrušeno',
    detail: 'Kamera je vypnutá. Můžete ji zkusit znovu nebo zadat kód ručně.',
  },
  denied: {
    title: 'Přístup ke kameře byl odmítnut',
    detail:
      'Povolte kameru v nastavení prohlížeče, nebo pokračujte ručním kódem.',
  },
  unsupported: {
    title: 'Kamera v tomto prohlížeči není podporovaná',
    detail: 'Použijte ruční kód nebo bezpečné vyhledání osoby.',
  },
  unavailable: {
    title: 'Kameru se nepodařilo spustit',
    detail:
      'Kamera může být používána jinou aplikací. Ruční cesta zůstává dostupná.',
  },
};

export const CheckinScanner = ({
  camera = browserCheckinCamera,
  disabled = false,
  onLookup,
  scenarioCodes = noScenarioCodes,
}: {
  readonly camera?: CheckinCameraPort;
  readonly disabled?: boolean;
  readonly onLookup: (request: CheckinLookupRequest) => void;
  readonly scenarioCodes?: readonly CheckinScenarioCode[];
}) => {
  const [cameraState, setCameraState] = useState<CameraState>('intro');
  const [manualCode, setManualCode] = useState('');
  const [manualError, setManualError] = useState<string>();
  const heading = useTransitionFocus(true);
  const session = useRef<CheckinCameraSession | undefined>(undefined);
  const video = useRef<HTMLVideoElement>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const requestLocked = useRef(false);
  const scanLocked = useRef(false);

  const stopCamera = () => {
    session.current?.stop();
    session.current = undefined;
  };

  useEffect(() => {
    mounted.current = true;
    const suspend = () => {
      generation.current += 1;
      requestLocked.current = false;
      scanLocked.current = false;
      stopCamera();
      if (mounted.current) setCameraState('cancelled');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') suspend();
    };
    window.addEventListener('pagehide', suspend);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      generation.current += 1;
      stopCamera();
      window.removeEventListener('pagehide', suspend);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (cameraState === 'scanning' && video.current) {
      session.current?.attach(video.current);
    }
  }, [cameraState]);

  const requestCamera = async () => {
    if (disabled || requestLocked.current || scanLocked.current) return;
    requestLocked.current = true;
    stopCamera();
    if (!camera.isSupported()) {
      requestLocked.current = false;
      setCameraState('unsupported');
      return;
    }
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    setCameraState('requesting');
    let result: CheckinCameraRequest;
    try {
      result = await camera.request();
    } catch {
      if (mounted.current && currentGeneration === generation.current) {
        requestLocked.current = false;
        setCameraState('unavailable');
      }
      return;
    }
    if (!mounted.current || currentGeneration !== generation.current) {
      if (result.kind === 'granted') result.session.stop();
      return;
    }
    requestLocked.current = false;
    if (result.kind !== 'granted') {
      setCameraState(result.kind);
      return;
    }
    session.current = result.session;
    setCameraState('scanning');
  };

  const cancelCamera = () => {
    generation.current += 1;
    requestLocked.current = false;
    scanLocked.current = false;
    stopCamera();
    setCameraState('cancelled');
  };

  const readSynthetic = async () => {
    if (
      disabled ||
      cameraState !== 'scanning' ||
      scanLocked.current ||
      !session.current
    ) {
      return;
    }
    scanLocked.current = true;
    const currentGeneration = generation.current;
    const activeSession = session.current;
    let opaqueValue: string;
    try {
      opaqueValue = await camera.readSyntheticCredential();
    } catch {
      if (
        mounted.current &&
        currentGeneration === generation.current &&
        session.current === activeSession
      ) {
        scanLocked.current = false;
        stopCamera();
        setCameraState('unavailable');
      }
      return;
    }
    if (
      !mounted.current ||
      currentGeneration !== generation.current ||
      session.current !== activeSession
    ) {
      return;
    }
    generation.current += 1;
    stopCamera();
    onLookup({
      method: 'camera_scan',
      credential: { adapter: 'synthetic_demo', opaqueValue },
    });
  };

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    setManualError(undefined);
    if (manualCode.length < 4 || manualCode.length > 128) {
      setManualError('Kód musí mít 4 až 128 znaků.');
      return;
    }
    if (
      manualCode !== manualCode.trim() ||
      !/^[A-Za-z0-9._:-]+$/.test(manualCode)
    ) {
      setManualError('Opište kód přesně, bez mezer a dalších znaků.');
      return;
    }
    onLookup({
      method: 'manual_code',
      credential: {
        adapter: 'synthetic_demo',
        opaqueValue: manualCode,
      },
    });
  };

  return (
    <section aria-labelledby="scanner-title" className={styles.scannerSection}>
      <header className={styles.sectionHeading}>
        <div>
          <p className={styles.overline}>KROK 1 · LOOKUP</p>
          <h1 data-route-heading id="scanner-title" ref={heading} tabIndex={-1}>
            Načíst nebo najít vstupenku
          </h1>
        </div>
        <span className={styles.lookupOnlyBadge}>Bez mutace</span>
      </header>
      <p className={styles.lead}>
        Scan pouze vyhledá syntetický záznam. Sám nikoho neodbaví; před každou
        mutací vždy uvidíte osobu a samostatné potvrzení.
      </p>

      <div className={styles.scannerGrid}>
        <article className={styles.cameraCard}>
          <div className={styles.cardHeading}>
            <span aria-hidden="true" className={styles.numberMark}>
              1A
            </span>
            <div>
              <h2>Kamera</h2>
              <p>Viditelný náhled a zaměřovací plocha.</p>
            </div>
          </div>

          {cameraState === 'intro' && (
            <div className={styles.cameraIntro}>
              <svg
                aria-hidden="true"
                className={styles.largeIcon}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                viewBox="0 0 48 48"
              >
                <rect height="28" rx="5" width="38" x="5" y="11" />
                <circle cx="24" cy="25" r="8" />
                <path d="m15 11 3-5h12l3 5" />
              </svg>
              <p>
                O oprávnění požádáme až po stisku tlačítka. Náhled se při
                opuštění stránky okamžitě zastaví.
              </p>
              <Button
                disabled={disabled}
                onClick={() => void requestCamera()}
                variant="primary"
              >
                Povolit kameru
              </Button>
            </div>
          )}

          {cameraState === 'requesting' && (
            <div
              aria-live="polite"
              className={styles.cameraIntro}
              role="status"
            >
              <span aria-hidden="true" className={styles.spinner} />
              <h3>Čekám na oprávnění…</h3>
              <p>Potvrďte systémový dialog prohlížeče.</p>
              <Button onClick={cancelCamera} variant="secondary">
                Zrušit skenování
              </Button>
            </div>
          )}

          {cameraState === 'scanning' && (
            <div className={styles.cameraStage}>
              <video
                aria-label="Živý náhled kamery"
                autoPlay
                muted
                playsInline
                ref={video}
              />
              <div
                aria-hidden="true"
                className={styles.target}
                data-camera-target
              >
                <span />
                <span />
                <span />
                <span />
              </div>
              <p className={styles.cameraInstruction}>
                Umístěte syntetický kód do rámečku
              </p>
              <div className={styles.cameraActions}>
                <Button
                  disabled={disabled}
                  onClick={() => void readSynthetic()}
                >
                  Načíst syntetický testovací kód
                </Button>
                <Button onClick={cancelCamera} variant="secondary">
                  Zrušit
                </Button>
              </div>
            </div>
          )}

          {cameraState !== 'intro' &&
            cameraState !== 'requesting' &&
            cameraState !== 'scanning' && (
              <div className={styles.cameraIntro} role="status">
                <svg
                  aria-hidden="true"
                  className={styles.largeIcon}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 48 48"
                >
                  <circle cx="24" cy="24" r="19" />
                  <path d="M16 16l16 16M32 16 16 32" />
                </svg>
                <h3>{cameraCopy[cameraState].title}</h3>
                <p>{cameraCopy[cameraState].detail}</p>
                <Button
                  disabled={disabled}
                  onClick={() => void requestCamera()}
                  variant="secondary"
                >
                  Zkusit kameru znovu
                </Button>
              </div>
            )}
        </article>

        <article className={styles.manualCard}>
          <div className={styles.cardHeading}>
            <span aria-hidden="true" className={styles.numberMark}>
              1B
            </span>
            <div>
              <h2>Ruční kód</h2>
              <p>Vždy dostupná klávesová alternativa.</p>
            </div>
          </div>
          <form className={styles.manualForm} onSubmit={submitManual}>
            <FormField
              {...(manualError ? { error: manualError } : {})}
              helperText="Kód se neukládá do prohlížeče a automaticky se neupravuje."
              label="Opaque kód vstupenky"
              required
            >
              <Input
                autoCapitalize="characters"
                autoComplete="off"
                disabled={disabled}
                enterKeyHint="search"
                maxLength={128}
                onChange={(event) => {
                  setManualCode(event.currentTarget.value);
                  setManualError(undefined);
                }}
                spellCheck={false}
                value={manualCode}
              />
            </FormField>
            <Button disabled={disabled} type="submit">
              Ověřit kód bez check-inu
            </Button>
          </form>

          {scenarioCodes.length > 0 && (
            <details className={styles.demoScenarios}>
              <summary>Testovací scénáře</summary>
              <p>
                Pouze syntetická data. Tyto hodnoty nejsou formátem reálné
                vstupenky ani credential adapterem.
              </p>
              <div className={styles.scenarioGrid}>
                {scenarioCodes.map((scenario) => (
                  <button
                    disabled={disabled}
                    key={scenario.code}
                    onClick={() => {
                      setManualCode(scenario.code);
                      setManualError(undefined);
                    }}
                    type="button"
                  >
                    <span>{scenario.label}</span>
                    <code>{scenario.code}</code>
                  </button>
                ))}
              </div>
            </details>
          )}
        </article>
      </div>
    </section>
  );
};
