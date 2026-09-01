'use client';

import type {
  AdminAssetDescriptor,
  AdminAssetPurpose,
} from '@byzon/domain/contracts';
import { useEffect, useRef, useState } from 'react';

import styles from './admin-workspace.module.css';

type AssetOwner = AdminAssetDescriptor['owner'];

export interface AdminContentAssetFailure {
  readonly kind:
    'offline' | 'permission' | 'stale' | 'validation' | 'transport';
  readonly message: string;
}

export type AdminContentAssetResult<Value> =
  | { readonly ok: true; readonly data: Value }
  | { readonly ok: false; readonly failure: AdminContentAssetFailure };

export interface AdminContentAssetPort {
  readonly resolve: (input: {
    readonly eventId: string;
    readonly owner: AssetOwner;
    readonly purpose: AdminAssetPurpose;
    readonly signal?: AbortSignal;
  }) => Promise<AdminContentAssetResult<AdminAssetDescriptor | null>>;
  readonly replace: (input: {
    readonly altText: string;
    readonly eventId: string;
    readonly expectedOwnerVersion: number;
    readonly file: File;
    readonly onProgress: (progress: number) => void;
    readonly owner: AssetOwner;
    readonly purpose: AdminAssetPurpose;
    readonly signal?: AbortSignal;
  }) => Promise<
    AdminContentAssetResult<{
      readonly asset: AdminAssetDescriptor;
      readonly ownerVersion: number;
    }>
  >;
  readonly remove: (input: {
    readonly asset: AdminAssetDescriptor;
    readonly expectedOwnerVersion: number;
    readonly signal?: AbortSignal;
  }) => Promise<AdminContentAssetResult<{ readonly ownerVersion: number }>>;
}

const purposeCopy = {
  speaker_photo: {
    label: 'Fotografie řečníka',
    unavailable: 'Fotografie řečníka zatím není dostupná',
    placeholder: 'Foto',
    maximum: 5 * 1_024 * 1_024,
  },
  partner_logo: {
    label: 'Logo partnera',
    unavailable: 'Logo partnera zatím není dostupné',
    placeholder: 'Logo',
    maximum: 3 * 1_024 * 1_024,
  },
} as const;

export const AdminContentAssetField = ({
  eventId,
  owner,
  ownerVersion,
  port,
  purpose,
  readOnly,
}: {
  readonly eventId: string;
  readonly owner: AssetOwner;
  readonly ownerVersion: number;
  readonly port?: AdminContentAssetPort;
  readonly purpose: AdminAssetPurpose;
  readonly readOnly: boolean;
}) => {
  const copy = purposeCopy[purpose];
  const [asset, setAsset] = useState<AdminAssetDescriptor | null>(null);
  const [busy, setBusy] = useState<'read' | 'replace' | 'remove' | null>(
    port ? 'read' : null,
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState('');
  const [currentOwnerVersion, setCurrentOwnerVersion] = useState(ownerVersion);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!port) return;
    const request = new AbortController();
    controller.current = request;
    void port
      .resolve({ eventId, owner, purpose, signal: request.signal })
      .then((result) => {
        if (request.signal.aborted) return;
        setBusy(null);
        if (result.ok) setAsset(result.data);
        else setError(result.failure.message);
      });
    return () => request.abort();
  }, [eventId, owner, port, purpose]);

  const replace = async () => {
    if (!port || busy || readOnly) return;
    if (!file || file.size === 0) {
      setError('Vyberte obrázek k nahrání.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Použijte obrázek JPEG, PNG nebo WebP.');
      return;
    }
    if (file.size > copy.maximum) {
      setError(
        `Soubor je příliš velký. Limit je ${Math.round(copy.maximum / 1_024 / 1_024)} MB.`,
      );
      return;
    }
    if (!altText.trim()) {
      setError('Doplňte alternativní popis obrázku.');
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setBusy('replace');
    setProgress(0);
    setError('');
    const result = await port.replace({
      altText: altText.trim(),
      eventId,
      expectedOwnerVersion: currentOwnerVersion,
      file,
      onProgress: setProgress,
      owner,
      purpose,
      signal: request.signal,
    });
    if (request.signal.aborted) return;
    setBusy(null);
    if (result.ok) {
      setAsset(result.data.asset);
      setCurrentOwnerVersion(result.data.ownerVersion);
      setProgress(100);
      setFile(null);
      setAltText('');
    } else setError(result.failure.message);
  };

  const remove = async () => {
    if (!port || !asset || busy || readOnly) return;
    const request = new AbortController();
    controller.current = request;
    setBusy('remove');
    setError('');
    const result = await port.remove({
      asset,
      expectedOwnerVersion: currentOwnerVersion,
      signal: request.signal,
    });
    if (request.signal.aborted) return;
    setBusy(null);
    if (result.ok) {
      setAsset(null);
      setCurrentOwnerVersion(result.data.ownerVersion);
    } else setError(result.failure.message);
  };

  return (
    <section
      aria-busy={busy !== null}
      aria-label={copy.label}
      className={`${styles.assetField} ${styles.contentWide}`}
    >
      <div className={styles.assetPreview}>
        {asset?.status === 'ready' && asset.preview ? (
          // The resolver returns only a short-lived authorized preview URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={asset.altText}
            referrerPolicy="no-referrer"
            src={asset.preview.url}
          />
        ) : (
          <div aria-hidden="true">{copy.placeholder}</div>
        )}
        <p>
          <strong>
            {busy === 'read'
              ? 'Načítám bezpečný náhled…'
              : asset?.status === 'failed'
                ? 'Obrázek se nepodařilo zpracovat'
                : asset
                  ? 'Bezpečný náhled je dostupný'
                  : copy.unavailable}
          </strong>
          <span>
            {port
              ? readOnly
                ? 'Archivovaný obsah je pouze ke čtení.'
                : 'Náhled je krátkodobý a v prohlížeči se trvale neukládá.'
              : 'Nahrání se zobrazí až po připojení autorizovaného resolveru.'}
          </span>
        </p>
      </div>

      {error ? <p role="alert">{error}</p> : null}
      {busy === 'replace' ? (
        <label className={styles.assetProgress}>
          <span>Nahrávání obrázku: {progress} %</span>
          <progress max="100" value={progress} />
        </label>
      ) : null}

      {port && !readOnly ? (
        <div className={styles.assetForm}>
          <label className={styles.field}>
            <span>Obrázek</span>
            <input
              accept="image/jpeg,image/png,image/webp"
              disabled={busy !== null}
              name="assetFile"
              onChange={(event) => {
                event.stopPropagation();
                setFile(event.target.files?.[0] ?? null);
              }}
              type="file"
            />
            <small>
              JPEG, PNG nebo WebP; nejvýše {copy.maximum / 1_024 / 1_024} MB.
            </small>
          </label>
          <label className={styles.field}>
            <span>Alternativní popis</span>
            <input
              disabled={busy !== null}
              maxLength={300}
              name="assetAlt"
              onChange={(event) => {
                event.stopPropagation();
                setAltText(event.target.value);
              }}
              value={altText}
            />
            <small>Stručně popište, co je na obrázku.</small>
          </label>
          <div className={styles.actionRow}>
            <button
              className={styles.secondaryButton}
              disabled={busy !== null}
              onClick={() => void replace()}
              type="button"
            >
              {asset ? 'Nahradit obrázek' : 'Nahrát obrázek'}
            </button>
            {asset ? (
              <button
                className={styles.dangerButton}
                disabled={busy !== null}
                onClick={() => void remove()}
                type="button"
              >
                Odstranit obrázek
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
};

export const createAdminContentAssetPreviewPort = (): AdminContentAssetPort => {
  const assets = new Map<string, AdminAssetDescriptor>();
  const ownerVersions = new Map<string, number>();
  let serial = 20;
  const key = (owner: AssetOwner, purpose: AdminAssetPurpose) =>
    `${owner.kind}:${owner.id}:${purpose}`;
  return {
    resolve: async ({ owner, purpose, signal }) =>
      signal?.aborted
        ? {
            ok: false,
            failure: { kind: 'transport', message: 'Požadavek byl zrušen.' },
          }
        : { ok: true, data: assets.get(key(owner, purpose)) ?? null },
    replace: async ({
      altText,
      eventId,
      file,
      onProgress,
      owner,
      purpose,
      signal,
      expectedOwnerVersion,
    }) => {
      if (signal?.aborted)
        return {
          ok: false,
          failure: { kind: 'transport', message: 'Požadavek byl zrušen.' },
        };
      const assetKey = key(owner, purpose);
      const currentOwnerVersion = ownerVersions.get(assetKey) ?? 1;
      if (expectedOwnerVersion !== currentOwnerVersion)
        return {
          ok: false,
          failure: {
            kind: 'stale',
            message:
              'Obsah se mezitím změnil. Načtěte aktuální stav a zkuste to znovu.',
          },
        };
      onProgress(35);
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
      onProgress(100);
      serial += 1;
      const descriptor: AdminAssetDescriptor = {
        assetId: `019fca00-0000-7000-8000-${String(serial).padStart(12, '0')}`,
        eventId,
        owner,
        purpose,
        contentType: file.type as AdminAssetDescriptor['contentType'],
        byteSize: file.size,
        altText,
        version: 1,
        status: 'ready',
        preview: {
          url: `https://preview.example.test/assets/${serial}`,
          expiresAt: '2026-09-02T12:05:00.000+02:00',
          width: 800,
          height: 800,
        },
      };
      const nextOwnerVersion = currentOwnerVersion + 1;
      assets.set(assetKey, descriptor);
      ownerVersions.set(assetKey, nextOwnerVersion);
      return {
        ok: true,
        data: { asset: descriptor, ownerVersion: nextOwnerVersion },
      };
    },
    remove: async ({ asset, expectedOwnerVersion, signal }) => {
      if (signal?.aborted)
        return {
          ok: false,
          failure: { kind: 'transport', message: 'Požadavek byl zrušen.' },
        };
      const assetKey = key(asset.owner, asset.purpose);
      const currentOwnerVersion = ownerVersions.get(assetKey) ?? 1;
      if (expectedOwnerVersion !== currentOwnerVersion)
        return {
          ok: false,
          failure: {
            kind: 'stale',
            message:
              'Obsah se mezitím změnil. Načtěte aktuální stav a zkuste to znovu.',
          },
        };
      const nextOwnerVersion = currentOwnerVersion + 1;
      assets.delete(assetKey);
      ownerVersions.set(assetKey, nextOwnerVersion);
      return { ok: true, data: { ownerVersion: nextOwnerVersion } };
    },
  };
};
