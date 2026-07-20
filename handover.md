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
- Poslední publikovaný úkol: `P2-02`, commit `ca66410` na
  `origin/stage/02-database-auth`.
- `P2-03` je na commitu `2a91594` v etapové větvi i `main`, ale první Railway
  deploy odhalil runtime packaging chybu workeru. Lokální hotfix není commitnutý
  ani pushnutý.

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

## Dokončená lokální práce (`P2-03`)

- `@byzon/database` poskytuje bounded `pg` pool, Drizzle client, transakční
  wrapper a transaction-scoped advisory lock.
- Web readiness vrací `200/database=ready` jen při dostupné DB a bezpečné
  `503/database=unavailable` při výpadku. Worker DB ověří při startu a pool
  zavře při shutdownu.
- Staging env vyžaduje explicitní `DATABASE_URL`; lokální vývoj má pouze lokální
  default bez produkčních dat.
- Web Railway config spouští migraci pouze jednou; ve staging prostředí navíc
  idempotentní seed. Worker migraci nespouští.

## Otevřené body a rizika

- `support_operator` není ve schématu vytvořen, protože plán jej zakazuje bez
  potvrzené potřeby.
- P0 produktové blockery zůstávají otevřené, ale `P2-01` neblokují.
- Railway staging má služby `@byzon/conference`, `@byzon/worker` a `Postgres`.
  Uživatel potvrdil reference `DATABASE_URL` a pool limity ve webu i workeru.
- Worker na Railway nenašel `@byzon/database/dist/index.js`, protože runtime
  image nezahrnul build výstup workspace balíčku. Hotfix bundluje config i DB
  workspace kód do `apps/worker/dist/index.js` a deklaruje externí runtime
  závislosti přímo ve workeru.
- Web proces startuje, ale healthcheck končí 502; hotfix přidává bezpečný log
  konkrétní chyby DB readiness. Další deploy určí, zda jde o DNS/reference nebo
  databázovou dostupnost.

## Doporučený další krok

Po schválení commitnout a pushnout Railway packaging hotfix, fast-forwardnout
`main` a sledovat worker start a nový DB readiness log. Teprve po zeleném deployi
pokračovat `P2-04`.

## Poslední ověření

- PostgreSQL integrace: migrace, dvakrát spuštěný Node seed a 19 databázových
  testů prošly; commit/rollback/advisory lock i uzavření poolu byly ověřeny.
- Produkční conference build a worker build prošly.
- Runtime smoke: readiness s DB `200`, bez DB `503`; worker se připojil a při
  `SIGINT` pool korektně uzavřel.
- Hotfix: format, lint, typecheck, 24 unit testů a oba produkční buildy prošly;
  worker bundle neobsahuje runtime odkaz na workspace balíčky. Statický smoke
  byl přerušen při pomalém kopírování 58 nezměněných assetů z lokálního disku.
