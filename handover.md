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
- Nejnovější schválený implementační úkol je `P2-06`; stav implementace a
  ověření je zaznamenaný níže.
- Railway packaging hotfix je commit `02e3b43`; je pushnutý do
  `origin/stage/02-database-auth`, fast-forwardnutý do `main` a pushnutý do
  `origin/main`.
- Railway conference readiness je po hotfixi a doplnění konfigurace zelená:
  `status=ready`, `environment=staging`, release
  `02e3b43fb1c37c72a70305ef14931ec29ea6e2d2` a `database=ready`.

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

## Dokončená práce (`P2-03`)

- `@byzon/database` poskytuje bounded `pg` pool, Drizzle client, transakční
  wrapper a transaction-scoped advisory lock.
- Web readiness vrací `200/database=ready` jen při dostupné DB a bezpečné
  `503/database=unavailable` při výpadku. Worker DB ověří při startu a pool
  zavře při shutdownu.
- Staging env vyžaduje explicitní `DATABASE_URL`; lokální vývoj má pouze lokální
  default bez produkčních dat.
- Web Railway config spouští migraci pouze jednou; ve staging prostředí navíc
  idempotentní seed. Worker migraci nespouští.
- Worker hotfix bundluje workspace config a databázový kód do samostatného
  `apps/worker/dist/index.js`, takže Railway runtime nepotřebuje chybějící
  `@byzon/database/dist/index.js`.
- Conference Railway služba používá `/railway.web.json`, poslouchá na
  `0.0.0.0:8080` a má `NODE_ENV=production`, `APP_ENV=staging`, staging URL a
  `RELEASE_SHA=${{RAILWAY_GIT_COMMIT_SHA}}`.

## Otevřené body a rizika

- `support_operator` není ve schématu vytvořen, protože plán jej zakazuje bez
  potvrzené potřeby.
- P0 produktové blockery zůstávají otevřené, ale `P2-01` neblokují.
- Railway staging má služby `@byzon/conference`, `@byzon/worker` a `Postgres`.
  Uživatel potvrdil reference `DATABASE_URL` a pool limity ve webu i workeru.
- Původní Railway 502 webu je vyřešený. `GET /health/ready` na
  `https://byzonconference-staging.up.railway.app` vrací `200` a potvrzuje
  dostupnou databázi.
- Railway CLI potvrdilo staging worker ve stavu `SUCCESS`; neběží v restart
  loopu.
- PostgreSQL IDOR test načetl oba seed eventy `byzon-2026` a
  `byzon-isolation-test`, takže staging seed je potvrzený.

## Doporučený další krok

Pokračovat `P2-07`: admin bootstrap role pouze explicitním seedem/CLI, nikdy
veřejným endpointem.

## Dokončená práce (`P2-06`)

- Přidána čistá onboarding state machine pro povinný eventový profil, aktuální
  verze podmínek/privacy notice a samostatnou networking volbu.
- Přidána tabulka `participant_profiles` a deduplikační index pro consent records
  z opakovaného requestu; dopředná migrace je `0001_strong_venus.sql`.
- Conference server dokončuje onboarding v transakci serializované per-user
  advisory lockem, s event membership kontrolou, feature flagem, append-only
  consent records a auditní stopou bez jména/e-mailu.
- PostgreSQL integrace na izolované lokální DB prošla: 24 databázových testů a
  12 conference testů včetně retry, cross-event odmítnutí, opt-in/opt-out a nové
  aktuální právní verze.
- Globální `pnpm run ci` prošlo: format, lint, typecheck, běžné testy, produkční
  conference/worker build a smoke test statického veřejného webu.
- GitHub Actions `application` job nově spouští PostgreSQL 17, migraci a seed;
  readiness E2E proto nečeká na chybějící DB a PostgreSQL integrační testy běží
  i v CI.
- Finální právní texty se neseedují; testovací právní fixtures jsou označené jako
  draft a produkční networking zůstává blokovaný `BLOCKER-LEGAL-01`.

## Dokončená práce (`P2-05`)

- `@byzon/domain` obsahuje explicitní event role, permission matrix a fail-closed
  podmínky pro vlastnictví, networking opt-in/spojení, přidělené bloky/místnosti
  a auditovanou admin výjimku; `support_operator` zůstává záměrně mimo model.
- Conference server načítá aktivní membership a nerevokované role výhradně z DB
  pro zadané `actor.userId` a `eventId`; odmítnutí používá neenumerující chybu.
- Přidán PostgreSQL integrační test, který stejnému uživateli nedovolí přenést
  admin roli do izolačního eventu a odmítne suspendovanou membership.
- Unit testy, typecheck, lint, format check a produkční conference build prošly.
- PostgreSQL IDOR test byl spuštěn proti Railway staging DB přes Railway-managed
  connection proměnnou bez vypsání credentialů; oba scénáře prošly a syntetický
  uživatel byl po testu odstraněn.
- Commit `7e0a234` je pushnutý do `origin/stage/02-database-auth`.
- Ruční upload deployment conference `9cdaa2ce-7b11-4466-a97a-3a5f928a30cf`
  zůstal na Railway ve stavu `INITIALIZING` bez přiřazeného buildu; je zastavený
  a dosavadní zdravý staging release `85666aa` zůstal aktivní a ready.

## Dokončená lokální práce (`P2-04`)

- Přidán Better Auth `1.6.23` s Drizzle adapterem nad existujícími core auth
  tabulkami a Next.js handlerem `/api/auth/[...all]`.
- Magic link expiruje za pět minut, v DB se ukládá hashovaně, Better Auth jej
  spotřebuje atomicky a callback/origin je omezen na `APP_BASE_URL`.
- Fake auth mail provider drží doručené odkazy pouze v paměti a nic neloguje;
  produkční mail provider zůstává navazující integrační prací.
- `BETTER_AUTH_SECRET` je povinný minimálně 32 znaků ve staging/production;
  lokální vývoj používá výslovně neprodukční default.

## Poslední ověření

- PostgreSQL integrace: migrace, dvakrát spuštěný Node seed a 19 databázových
  testů prošly; commit/rollback/advisory lock i uzavření poolu byly ověřeny.
- Produkční conference build a worker build prošly.
- Runtime smoke: readiness s DB `200`, bez DB `503`; worker se připojil a při
  `SIGINT` pool korektně uzavřel.
- Hotfix: format, lint, typecheck, 24 unit testů a oba produkční buildy prošly;
  worker bundle neobsahuje runtime odkaz na workspace balíčky. Statický smoke
  byl přerušen při pomalém kopírování 58 nezměněných assetů z lokálního disku.
- Railway conference ověření po deployi: `/health/ready` vrací `200`, staging
  release `02e3b43fb1c37c72a70305ef14931ec29ea6e2d2` a
  `dependencies.database=ready`.
- `P2-04`: lint, typecheck, 27 unit/schema testů a produkční web build prošly.
- V izolované PostgreSQL prošla migrace, všech 19 databázových testů a všech 5
  conference testů včetně magic-link integrace: raw token nebyl uložen, první
  použití vydalo session cookie a opakované použití bylo odmítnuto.
- Railway release hotfix načítá `RAILWAY_GIT_COMMIT_SHA` přímo jako fallback
  pro chybějící nebo prázdný `RELEASE_SHA`; ruční neprázdný override má nadále
  přednost. Regresní config testy kryjí všechny tři varianty.
