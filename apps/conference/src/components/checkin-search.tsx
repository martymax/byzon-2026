'use client';

import type {
  CheckinLookupRequest,
  CheckinSearchResponse,
} from '@byzon/domain/contracts/check-in';
import { Button, FormField, Input } from '@byzon/ui';
import { useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  checkinSearchInputBounds,
  requestCheckinSearch,
} from '@/lib/checkin-api';
import styles from './checkin.module.css';

type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'waiting' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: CheckinSearchResponse }
  | {
      readonly status: 'failure';
      readonly title: string;
      readonly requestId?: string;
    };

const ticketLabel = {
  valid: 'Platná',
  cancelled: 'Zrušená',
  refunded: 'Vrácená',
  blocked: 'Blokovaná',
} as const;

export const CheckinSearch = ({
  api,
  debounceMs = 320,
  disabled = false,
  onLookup,
}: {
  readonly api: ApiPort;
  readonly debounceMs?: number;
  readonly disabled?: boolean;
  readonly onLookup: (request: CheckinLookupRequest) => void;
}) => {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const currentGeneration = generation.current;
    const canonical = query.trim();
    if (
      disabled ||
      canonical.length < checkinSearchInputBounds.minimum ||
      canonical.length > checkinSearchInputBounds.maximum
    ) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ status: 'loading' });
      void requestCheckinSearch(api, canonical, controller.signal).then(
        (result) => {
          if (generation.current !== currentGeneration) return;
          if (result.ok && result.kind === 'success') {
            setState({ status: 'ready', data: result.data });
            return;
          }
          if (result.ok || result.failure.kind === 'aborted') return;
          if (result.failure.kind === 'offline') {
            setState({
              status: 'failure',
              title: 'Vyhledávání vyžaduje online připojení.',
            });
            return;
          }
          const requestId =
            result.failure.kind === 'problem'
              ? result.failure.problem.requestId
              : result.failure.kind === 'invalid_response' ||
                  result.failure.kind === 'transport'
                ? result.failure.requestId
                : undefined;
          setState({
            status: 'failure',
            title:
              result.failure.kind === 'problem' &&
              result.failure.problem.code === 'CHECKIN_RATE_LIMITED'
                ? 'Příliš mnoho hledání. Chvíli počkejte.'
                : 'Osoby se nepodařilo bezpečně vyhledat.',
            ...(requestId ? { requestId } : {}),
          });
        },
      );
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, debounceMs, disabled, query]);

  return (
    <section aria-labelledby="person-search-title" className={styles.search}>
      <div className={styles.cardHeading}>
        <span aria-hidden="true" className={styles.numberMark}>
          1C
        </span>
        <div>
          <h2 id="person-search-title">Najít osobu</h2>
          <p>Omezené výsledky pouze s minimem identifikačních údajů.</p>
        </div>
      </div>

      <div className={styles.searchLayout}>
        <FormField
          helperText={`Zadejte alespoň ${checkinSearchInputBounds.minimum} znaky. Zobrazíme nejvýše 5 výsledků, bez celého e-mailu.`}
          label="Jméno nebo e-mail"
        >
          <Input
            autoComplete="off"
            disabled={disabled}
            maxLength={checkinSearchInputBounds.maximum}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const canonical = value.trim();
              setQuery(value);
              setState(
                canonical.length >= checkinSearchInputBounds.minimum &&
                  canonical.length <= checkinSearchInputBounds.maximum
                  ? { status: 'waiting' }
                  : { status: 'idle' },
              );
            }}
            spellCheck={false}
            type="search"
            value={query}
          />
        </FormField>

        <div
          aria-busy={
            state.status === 'waiting' || state.status === 'loading'
              ? true
              : undefined
          }
          aria-live="polite"
          className={styles.searchResults}
        >
          {state.status === 'idle' && (
            <p className={styles.searchHint}>
              Výsledek vždy ještě otevřeme k ověření. Výběr osoby check-in
              neprovede.
            </p>
          )}
          {(state.status === 'waiting' || state.status === 'loading') && (
            <p className={styles.searchHint} role="status">
              <span aria-hidden="true" className={styles.inlineSpinner} />
              {state.status === 'waiting'
                ? 'Čekám na dopsání…'
                : 'Hledám bezpečné shody…'}
            </p>
          )}
          {state.status === 'failure' && (
            <div className={styles.inlineError} role="alert">
              <strong>{state.title}</strong>
              {state.requestId && <span>ID požadavku: {state.requestId}</span>}
            </div>
          )}
          {state.status === 'ready' && state.data.results.length === 0 && (
            <p className={styles.searchHint} role="status">
              Žádná bezpečná shoda. Zkontrolujte dotaz nebo použijte kód.
            </p>
          )}
          {state.status === 'ready' && state.data.results.length > 0 && (
            <>
              <p className={styles.resultCount}>
                Nalezeno {state.data.results.length} z maximálně{' '}
                {state.data.limitedTo}
              </p>
              <ul className={styles.personList}>
                {state.data.results.map(({ person, ticket }) => (
                  <li key={person.id}>
                    <div>
                      <strong>{person.displayName}</strong>
                      <span>{person.maskedEmail}</span>
                      <span>
                        Reference •••• {ticket.referenceSuffix} ·{' '}
                        {ticketLabel[ticket.state]}
                      </span>
                    </div>
                    <Button
                      aria-label={`Vybrat a ověřit osobu ${person.displayName}`}
                      disabled={disabled}
                      onClick={() =>
                        onLookup({
                          method: 'manual_search',
                          personId: person.id,
                        })
                      }
                      size="small"
                      variant="secondary"
                    >
                      Vybrat a ověřit
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
