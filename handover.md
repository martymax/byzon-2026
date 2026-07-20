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
- Poslední dokončený úkol: `P2-01` – první Drizzle schema doménového kernelu.
- Změny nejsou commitnuté ani pushnuté.

## Dokončená práce

- Přidán workspace balíček `@byzon/database` s Drizzle ORM a `pg`.
- Přidány Better Auth core tabulky `user`, `session`, `account`, `verification`.
- Přidány eventy/features, memberships/event-scoped role, právní dokumenty a
  append-only consent records, audit, outbox a idempotency keys.
- Eventové tabulky nesou `event_id`; vazba consent → legal document používá
  složený cizí klíč, který brání propojení dat různých eventů.
- Přidáno 12 schema-level testů pro event scope, Better Auth tabulky, složenou
  vazbu legal documentu a částečné/deduplication unique indexy.
- Migrace a seed jsou záměrně až `P2-02`.

## Otevřené body a rizika

- Lokální Node byl aktualizován na projektovou verzi `24.18.0`. Ze shell profilu
  byl odstraněn zastaralý natvrdo zadaný Homebrew Node `24.1.0`; CI poté prošlo
  bez engine warningu. Tato úprava prostředí není součástí Git diffu projektu.
- `support_operator` není ve schématu vytvořen, protože plán jej zakazuje bez
  potvrzené potřeby.
- P0 produktové blockery zůstávají otevřené, ale `P2-01` neblokují.

## Doporučený další krok

Předložit ověřený diff `P2-01` uživateli ke schválení commitu a pushe. Po
schválení pokračovat samostatným `P2-02` (SQL migrace, migration journal a dva
seed eventy pro izolační testy).

## Poslední ověření

- `pnpm run ci`: prošel format, lint, typecheck, 16 testů, conference/worker
  build a regresní static-site smoke.
- `@byzon/database`: 12/12 testů prošlo.
- Veřejný web: 25 HTML stran, 351 715 B HTML, 58 assetů, 57 613 828 B.
