'use client';
import type { AdminContentItem } from '../lib/admin-content-api';
import {
  emptyProgramFilters,
  type ProgramFilters,
} from '../lib/admin-program-filters';
import styles from './admin-workspace.module.css';
const types: Record<string, string> = {
  talk: 'Přednáška',
  panel: 'Panel',
  workshop: 'Workshop',
  mastermind: 'Mastermind',
  coaching: 'Koučink',
  networking: 'Networking',
  break: 'Přestávka',
  meal: 'Jídlo',
  gala: 'Gala',
  other: 'Jiné',
};
const label = (item: AdminContentItem) =>
  String(
    item.title ??
      item.name ??
      [item.firstName, item.lastName].filter(Boolean).join(' ') ??
      item.id,
  );
export function AdminProgramFilters({
  value,
  onChange,
  references,
  count,
  total,
  timezone,
}: {
  value: ProgramFilters;
  onChange: (value: ProgramFilters) => void;
  references: {
    days: readonly AdminContentItem[];
    rooms: readonly AdminContentItem[];
    venues: readonly AdminContentItem[];
    speakers: readonly AdminContentItem[];
  };
  count: number;
  total: number;
  timezone: string;
}) {
  const select = (
    key: keyof ProgramFilters,
    name: string,
    options: readonly (readonly [string, string])[],
  ) => (
    <label className={styles.field}>
      <span>{name}</span>
      <select
        value={value[key]}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
      >
        <option value="">Vše</option>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const options = (items: readonly AdminContentItem[]) =>
    items.map((item) => [item.id, label(item)] as const);
  const active = Object.values(value).filter(Boolean).length;
  return (
    <section className={styles.programFilters} aria-label="Filtrování programu">
      <div className={styles.programFilterGrid}>
        <label className={styles.field}>
          <span>Hledat podle názvu</span>
          <input
            type="search"
            value={value.title}
            placeholder="Název bodu programu"
            onChange={(event) =>
              onChange({ ...value, title: event.target.value })
            }
          />
        </label>
        {select('dayId', 'Den', options(references.days))}
        {select('roomId', 'Stage / místnost', [
          ['__none', 'Bez místnosti'],
          ...options(references.rooms),
        ])}
        {select('speakerId', 'Řečník', [
          ['__none', 'Bez řečníka'],
          ...options(references.speakers),
        ])}
        {select('type', 'Typ bodu programu', Object.entries(types))}
      </div>
      <details>
        <summary>Další filtry</summary>
        <div className={styles.programFilterGrid}>
          {select('venueId', 'Místo konání', options(references.venues))}
          {select('status', 'Stav záznamu', [
            ['draft', 'Rozpracovaný'],
            ['published', 'Publikovaný'],
            ['cancelled', 'Zrušený'],
            ['archived', 'Archivovaný'],
          ])}
          {select('publicationState', 'Zveřejnění', [
            ['published', 'Ve zveřejněné verzi'],
            ['unpublished', 'Nezveřejněno'],
            ['archived', 'Archiv'],
          ])}
          {select('questionMode', 'Podpora Q&A', [
            ['moderated_follow_up', 'Podporuje Q&A'],
            ['disabled', 'Bez Q&A'],
          ])}
          {(
            [
              ['startsFrom', 'Začátek od'],
              ['startsTo', 'Začátek do'],
              ['endsFrom', 'Konec od'],
              ['endsTo', 'Konec do'],
            ] as const
          ).map(([key, name]) => (
            <label className={styles.field} key={key}>
              <span>{name}</span>
              <input
                type="time"
                value={value[key]}
                onChange={(event) =>
                  onChange({ ...value, [key]: event.target.value })
                }
              />
            </label>
          ))}
        </div>
        <p className={styles.helper}>
          Časy jsou v pásmu {timezone}. Bez zvoleného dne platí pro všechny dny.
        </p>
      </details>
      <div className={styles.actionRow}>
        <p role="status">
          Zobrazeno {count} z {total} bodů
          {active ? ` · Aktivní filtry: ${active}` : ''}
        </p>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={!active}
          onClick={() => onChange({ ...emptyProgramFilters })}
        >
          Vymazat filtry
        </button>
      </div>
    </section>
  );
}
