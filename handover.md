# BYZON 2026 – handover

> Poslední aktualizace: 20. července 2026

## Pokyny pro pokračování

Před prací přečti `AI_IMPLEMENTATION_PLAN.md`, související ADR a `README.md`.
Ověř větev, stav a log; cizí změny neměň. Po každém kroku aktualizuj tento
soubor. Commit ani push nedělej bez explicitního schválení uživatelem.

## Aktuální stav

- Aktivní etapa: `02-database-auth`.
- Pracovní větev: `stage/02-database-auth`, založená z `main` na `db2d1c8`.
- Etapa 1 je sloučená do `main`; uživatel potvrdil úspěšný Railway deploy, proto
  je `P1-11` uzavřen.
- Poslední publikovaný úkol: `P2-01`, commit `0f60f34` na
  `origin/stage/02-database-auth`.
- Dokončený lokální úkol: `P2-02` – první migrace a event seed; změny nejsou
  commitnuté ani pushnuté.

## Dokončená práce

- Přidán workspace balíček `@byzon/database` s Drizzle ORM a `pg`.
- Přidány Better Auth core tabulky `user`, `session`, `account`, `verification`.
- Přidány eventy/features, memberships/event-scoped role, právní dokumenty a
  append-only consent records, audit, outbox a idempotency keys.
- Eventové tabulky nesou `event_id`; vazba consent → legal document používá
  složený cizí klíč, který brání propojení dat různých eventů.
- Přidáno 12 schema-level testů pro event scope, Better Auth tabulky, složenou
  vazbu legal documentu a částečné/deduplication unique indexy.
- `P2-01` neobsahoval databázovou migraci; ta vzniká v navazujícím `P2-02`.

## Dokončená lokální práce

- `P2-02` přidává Drizzle Kit config, první verzovanou SQL migraci, snapshot a
  migration journal.
- Idempotentní seed zakládá draft `byzon-2026` a archivovaný
  `byzon-isolation-test`; opakované spuštění nepřepisuje provozní stav.
- Před první migrací byly doplněny všechny feature flags z §7.5 a odstraněny
  databázové UUIDv4 defaulty. Identifikátory bude generovat server jako UUIDv7.

## Otevřené body a rizika

- `support_operator` není ve schématu vytvořen, protože plán jej zakazuje bez
  potvrzené potřeby.
- P0 produktové blockery zůstávají otevřené, ale `P2-01` neblokují.

## Doporučený další krok

Předložit ověřený diff `P2-02` uživateli ke schválení commitu a pushe.
Následující úkol je `P2-03` – connection pooling a transakční helpery.

## Poslední ověření

- `P2-01`: `pnpm run ci` prošel na Node `24.18.0` bez engine warningu.
- `P2-02`: `pnpm run ci` prošel; z celkem 21 testů bylo 17 databázových.
- První migrace a dvakrát spuštěný seed prošly proti dočasnému PostgreSQL;
  výsledkem byly přesně dva eventy a dva řádky feature flags.
