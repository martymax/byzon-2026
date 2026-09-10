'use client';

import type {
  AdminAssetDescriptor,
  AdminAssetPurpose,
} from '@byzon/domain/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './admin-workspace.module.css';

type AssetOwner = AdminAssetDescriptor['owner'];

export interface AdminContentAssetFailure {
  readonly kind:
    | 'offline'
    | 'session_expired'
    | 'permission'
    | 'stale'
    | 'validation'
    | 'transport';
  readonly message: string;
}

export type AdminContentAssetResult<Value> =
  | { readonly ok: true; readonly data: Value }
  | { readonly ok: false; readonly failure: AdminContentAssetFailure };

export interface AdminContentAssetPort {
  readonly download?: (input: {
    readonly asset: AdminAssetDescriptor;
    readonly signal?: AbortSignal;
  }) => Promise<AdminContentAssetResult<Blob>>;
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
  onMutation,
  onBusyChange,
  onPendingChange,
  onSecurityFailure,
  port,
  purpose,
  readOnly,
}: {
  readonly eventId: string;
  readonly owner: AssetOwner;
  readonly ownerVersion: number;
  readonly onMutation?: (version: number) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onPendingChange?: (pending: boolean) => void;
  readonly onSecurityFailure?: (failure: AdminContentAssetFailure) => void;
  readonly port?: AdminContentAssetPort;
  readonly purpose: AdminAssetPurpose;
  readonly readOnly: boolean;
}) => {
  const copy = purposeCopy[purpose];
  const [asset, setAsset] = useState<AdminAssetDescriptor | null>(null);
  const [busy, setBusy] = useState<
    'read' | 'replace' | 'remove' | 'download' | null
  >(port ? 'read' : null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState('');
  const [currentOwnerVersion, setCurrentOwnerVersion] = useState(ownerVersion);
  const controller = useRef<AbortController | null>(null);

  const securityFailure = useRef(onSecurityFailure);
  useEffect(() => {
    securityFailure.current = onSecurityFailure;
  }, [onSecurityFailure]);
  const reportFailure = useCallback((failure: AdminContentAssetFailure) => {
    setError(failure.message);
    if (failure.kind === 'permission' || failure.kind === 'session_expired')
      securityFailure.current?.(failure);
  }, []);
  useEffect(() => {
    onBusyChange?.(busy !== null);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    onPendingChange?.(file !== null);
    return () => onPendingChange?.(false);
  }, [file, onPendingChange]);
  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (!port) return;
    const request = new AbortController();
    controller.current = request;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const result = await port.resolve({
        eventId,
        owner: { kind: owner.kind, id: owner.id },
        purpose,
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      setBusy((current) => (current === 'read' ? null : current));
      if (result.ok) {
        setAsset(result.data);
        setPreviewFailed(false);
        if (result.data?.preview) {
          const delay = Math.max(
            30_000,
            new Date(result.data.preview.expiresAt).getTime() -
              Date.now() -
              30_000,
          );
          timer = setTimeout(() => void refresh(), delay);
        }
      } else reportFailure(result.failure);
    };
    void refresh();
    return () => {
      request.abort();
      clearTimeout(timer);
    };
  }, [
    eventId,
    owner.id,
    owner.kind,
    ownerVersion,
    currentOwnerVersion,
    port,
    purpose,
    reportFailure,
  ]);

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
    setNotice('');
    const result = await port.replace({
      altText: altText.trim(),
      eventId,
      expectedOwnerVersion: Math.max(currentOwnerVersion, ownerVersion),
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
      setPreviewFailed(false);
      setCurrentOwnerVersion(result.data.ownerVersion);
      onMutation?.(result.data.ownerVersion);
      setProgress(100);
      setFile(null);
      setAltText('');
      if (fileInput.current) fileInput.current.value = '';
      setNotice(
        'Obrázek byl uložen. Na webu se změna projeví po zveřejnění obsahu.',
      );
    } else reportFailure(result.failure);
  };

  const remove = async () => {
    if (!port || !asset || busy || readOnly) return;
    const request = new AbortController();
    controller.current = request;
    setBusy('remove');
    setError('');
    const result = await port.remove({
      asset,
      expectedOwnerVersion: Math.max(currentOwnerVersion, ownerVersion),
      signal: request.signal,
    });
    if (request.signal.aborted) return;
    setBusy(null);
    if (result.ok) {
      setAsset(null);
      setNotice(
        'Obrázek byl odebrán z rozpracovaného obsahu. Změnu ještě zveřejněte.',
      );
      setCurrentOwnerVersion(result.data.ownerVersion);
      onMutation?.(result.data.ownerVersion);
    } else reportFailure(result.failure);
  };

  const download = async () => {
    if (!asset || !port?.download || busy) return;
    const request = new AbortController();
    controller.current = request;
    setBusy('download');
    setError('');
    const result = await port.download({ asset, signal: request.signal });
    if (request.signal.aborted) return;
    setBusy(null);
    if (!result.ok) {
      reportFailure(result.failure);
      return;
    }
    const url = URL.createObjectURL(result.data);
    const link = document.createElement('a');
    link.href = url;
    const extension = {
      'image/webp': 'webp',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/svg+xml': 'svg',
      'image/gif': 'gif',
      'image/avif': 'avif',
    }[asset.contentType];
    link.download = `${purpose === 'partner_logo' ? 'logo' : 'fotografie'}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
            onError={() => setPreviewFailed(true)}
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
              : previewFailed || asset?.status === 'failed'
                ? 'Obrázek se nepodařilo zpracovat'
                : asset
                  ? `${copy.label} je uložen${purpose === 'speaker_photo' ? 'a' : 'o'}`
                  : copy.unavailable}
          </strong>
          <span>
            {port
              ? readOnly
                ? 'Archivovaný obsah je pouze ke čtení.'
                : 'Obrázek se ukládá samostatně. Poté změnu zveřejněte spolu s obsahem.'
              : 'Nahrání se zobrazí až po připojení autorizovaného resolveru.'}
          </span>
        </p>
      </div>

      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {asset && port?.download ? (
        <button
          className={styles.secondaryButton}
          disabled={busy !== null}
          onClick={() => void download()}
          type="button"
        >
          {busy === 'download'
            ? 'Stahuji…'
            : purpose === 'partner_logo'
              ? 'Stáhnout logo'
              : 'Stáhnout fotografii'}
        </button>
      ) : null}
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
              ref={fileInput}
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
