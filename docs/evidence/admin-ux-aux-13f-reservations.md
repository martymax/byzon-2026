# AUX-13F — produkční integrace rezervací a kapacit

> Datum: 2026-09-02  
> Lokální stav: session-first read, capacity write a oddělené storno jsou
> zapojené; staging auth/context evidence zůstává společným gate `AUX-13A`.

## Integrovaný řez

- Nový privátní
  `GET /api/v1/admin/events/:eventId/reservation-sessions` ověřuje aktivní
  session, event scope, retenci a `reservation:any:read`. Odpověď je
  `private, no-store`, má `Vary: Authorization, Cookie` a prochází strict
  session-page schématem.
- Stabilní keyset pořadí `startsAt ASC, sessionId ASC` načítá `limit + 1`
  a vytváří opaque cursor bez offset driftu. Neznámý, duplicitní nebo
  neplatný query parametr končí `422`.
- Jedna session položka obsahuje lidský název, datum, čas, místnost,
  kapacitu, potvrzený a čekající počet i `capacityVersion`. Rezervace jsou
  SQL window funkcí omezené na 100 na aktivitu.
- Participant reference vzniká pouze z posledních znaků interního ID,
  obsahuje maskovací znak a odpověď nečte jméno, e-mail ani telefon.
  Strict kontrakt odmítá e-mail a klient navíc nečekanou raw hodnotu skryje.
- Produkční `/admin/rezervace` používá pouze nový read endpoint, skládá
  další stránky bez duplicit a poskytuje filtr dne, aktivity a kapacitního
  stavu. Souhrn poctivě popisuje dosud načtené aktivity.
- Změna kapacity dál používá kanonický session-level endpoint s
  `capacityVersion`; storno konkrétní rezervace zůstává samostatná reasoned,
  auditovaná a idempotentní operace. Stale a security failure zahodí draft.

## Oprava dokumentačního driftu

`BLOCKER-RES-03` už není blokací rezervační stránky. Hlavní plán jej
uzavřel v `P5-05` rozhodnutím, že transfer/storno vstupenky zruší aktivní
rezervace a uvolní kapacitu. Napojení tohoto dopadu na ticket transition
zůstává odpovědností `P4-09`/`AUX-13E`, nikoli klientského dopočtu.

## Oveření

- Conference unit sada: 592 testů prošlo, 115 service-backed testů bylo bez
  lokální databáze přeskočeno.
- Admin browser component soubor: 64 scénářů ve třech viewports,
  tedy 192/192; zahrnuje cursor page, PII kontrolu, axe, read-only permission,
  capacity minimum, exact retry, stale reload a security wipe.
- Chromium max-page route načetla čtyři serverové stránky do skutečných
  100 aktivit a prošla existujícím CLS/long-task/overflow gate na 1280 px;
  ostatní viewporty jsou v tomto trace záměrně přeskočené konfigurací.
- PostgreSQL integrační test připravený pro CI ověřuje permission,
  `private, no-store`, první a druhou keyset stránku, event izolaci,
  agregované počty, maskování a neplatný cursor.
- Typecheck a formátová kontrola jsou zelené; produkční build/mocks boundary
  je součástí finálního tematického gate.

## Otevřený gate

Lokální Docker daemon není dostupný, proto je PostgreSQL test v lokálním
běhu přeskočený. `AUX-13F` zůstává `[~]` do staging auth/context E2E
společného `AUX-13A`; implementace ani dokumentace tento externí gate
nepředstírá jako splněný.
