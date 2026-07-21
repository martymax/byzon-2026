'use client';
import { useState } from 'react';
export const PublicationControl = ({ eventId }: { eventId: string }) => {
  const [status, setStatus] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const preview = async () => {
    const response = await fetch(
      `/api/v1/admin/events/${eventId}/publication`,
      { cache: 'no-store' },
    );
    if (!response.ok) {
      setStatus('Náhled nelze sestavit.');
      return;
    }
    const data = (await response.json()) as {
      version: number;
      checksumSha256: string;
    };
    setVersion(data.version);
    setStatus(
      `Náhled verze ${data.version}, kontrolní součet ${data.checksumSha256.slice(0, 12)}…`,
    );
  };
  const publish = async () => {
    if (version === null) return;
    const response = await fetch(
      `/api/v1/admin/events/${eventId}/publication`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedPreviousVersion: version - 1 }),
      },
    );
    setStatus(
      response.ok
        ? `Verze ${version} byla atomicky publikována.`
        : 'Publikace selhala; obnovte náhled.',
    );
    if (response.ok) setVersion(null);
  };
  return (
    <section className="publication-control">
      <h2>Publikace</h2>
      <p aria-live="polite">
        {status || 'Nejprve sestavte náhled aktuálního draftu.'}
      </p>
      <div className="link-row">
        <button type="button" onClick={() => void preview()}>
          Sestavit náhled
        </button>
        <button
          type="button"
          disabled={version === null}
          onClick={() => void publish()}
        >
          Publikovat
        </button>
      </div>
    </section>
  );
};
