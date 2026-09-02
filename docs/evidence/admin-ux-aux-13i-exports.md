# AUX-13I — produkční reporty a exporty

Stav: lokální integrační řez hotový; finální `[x]` čeká na storage-backed
staging E2E po `BLOCKER-INFRA-01` a společný auth/context gate `AUX-13A`.

## Implementace a invarianty

- Produkční `/admin/reporty` načítá private/no-store historii přes typed GET,
  po vytvoření reportu ji obnoví a stabilním keyset cursorem načte další
  bounded stránku bez duplicit.
- Server vrací pouze current-event exporty po
  `personal-data:operational:export`; interní `processing` překládá na
  uživatelské `queued` a časová expirace má přednost před uloženým stavem.
- `downloadPath` vznikne jen pro neexpirovaný `ready` export se skutečným
  obsahem. Download znovu ověří current-event slug i oprávnění, odpověď je
  private/no-store a úspěšné stažení zapisuje `export.download` audit.
- Expirovaný inline artefakt se při pokusu o stažení označí `expired` a jeho
  obsah, MIME i checksum se smažou v jediném update.
- CSV buňky neutralizují formula prefixy `=`, `+`, `-`, `@` i vedoucí tab/CR
  control znaky a vždy bezpečně escapují oddělovače a uvozovky.

## Ověření

- conference TypeScript a lint prošly; server/unit sada 604 PASS, DB regrese
  je bez `TEST_DATABASE_URL` očekávaně přeskočená a připravená pro CI;
- worker CSV sada 8/8 PASS;
- browser sada 1053/1053 PASS ve phone/tablet/desktop včetně produkčního portu,
  cursor načtení, čtyř pravdivých stavů, ready-only odkazu a axe;
- PostgreSQL regrese kryje queue, bounded list a state filtr, ready download
  audit, expiraci s odstraněním obsahu, permission a wrong-current-event guard.

## Zbývající externí gate

Současný lokální adapter drží dočasný obsah v PostgreSQL a autorizovaný server
jej proxyuje. ADR-007 vyžaduje pro produkční osobní data privátní bucket,
aplikační šifrování, oddělené credentials a retenční job. Provisioning, právní
schválení a skutečný storage-backed download se proto nesmějí označit jako
hotové před uzavřením `BLOCKER-INFRA-01`.
