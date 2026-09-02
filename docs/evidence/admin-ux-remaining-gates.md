# Admin UX — audit zbývajících gate

Datum ověření: 2026-09-02 (Europe/Prague).

## Lokální výsledek

- Všechny lokálně implementovatelné AUX UI, contract, QA a integration řezy
  byly tematicky commitnuté a sloučené do `main`.
- Poslední úplný gate: Prettier, všechny lint/typechecky, všechny workspace
  unit testy, produkční Next/worker build a production mock boundary PASS.
- Admin browser matice má 1053/1053 PASS ve phone/tablet/desktop včetně axe,
  route isolation, permission/session wipe, cursorů a exact retry scénářů.
- PostgreSQL integrační testy pro nové serverové řezy jsou připravené pro CI;
  lokálně se bez `TEST_DATABASE_URL` očekávaně přeskakují.

## Veřejný staging smoke

- `GET https://byzonconference-staging.up.railway.app/health/ready` vrátil 200,
  `environment=staging`, DB/Redis `ready` a release
  `bfead3259e5597780b1903bf0cfea510dc5d9be1`.
- Anonymní `GET /api/v1/admin/context` vrátil kontraktní 401
  `AUTHENTICATION_REQUIRED`, `cache-control: private, no-store`,
  `vary: Authorization, Cookie` a `x-content-type-options: nosniff`.
- Staging release předchází novým AUX integračním commitům. Interaktivní
  přihlášený smoke nebylo možné provést bez dostupného browser-control runtime,
  nasazení aktuálního `main` a schváleného organizer UAT účtu.

## Zbývající vstupy mimo lokální implementační oprávnění

- `AUX-00C`, `AUX-14A`–`F`, fyzický `AUX-12A`: pět pořadatelů, syntetická
  staging data, zařízení, 25 pokusů a VoiceOver/NVDA smoke.
- `AUX-13A`: deploy aktuálního `main`, přihlášený organizer a omezený actor pro
  skutečný auth/context/route matrix smoke.
- `AUX-13L`: uzavřený `BLOCKER-INFRA-01` — Railway bucket/DPA/region,
  aplikační šifrování, oddělené credentials, MIME/checksum/dimensions kontrola,
  retence a storage-backed E2E. Do té doby správně zůstává placeholder.
- `AUX-13E`: invitation/recovery handshake `P4-06`–`P4-09` pro importované
  identity. Scope 2026 záměrně nevytváří ticket credential ani transfer/storno.
- `AUX-06C`, `AUX-10F`: produktová rozhodnutí pro support akce a
  `supportMessage`; UI je do rozhodnutí fail-closed.
- `AUX-14D/E`: konkrétní oprávněné osoby a finální obsah/loga/FAQ.

Tyto body nelze bezpečně uzavřít kódem bez nového oprávnění, externího
provisioningu, produktového rozhodnutí nebo fyzické UAT evidence.
