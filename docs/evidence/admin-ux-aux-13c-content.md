# AUX-13C — produkční integrace obsahu

> Datum: 2026-09-02  
> Lokální stav: produkční route a port integrovány; staging auth/context E2E
> zůstává společným gate `AUX-13A` / `GAP-AUX-SHELL-01`.

## Integrovaný řez

- `/admin/obsah` v produkční větvi nevytváří druhý event context přes
  participant `loadCurrentEvent`. `AdminContentProductionWorkspace` čte event
  ID, timezone, phase a permissions výhradně z ověřeného admin shell contextu.
- Shell před vykreslením uplatní `organizer_admin` a `program:manage` gate.
  Archiv nebo chybějící write permission drží workspace read-only.
- Content list/save/archive a publication preview/publish používají výchozí
  produkční fetch port. Produkční wrapper nepřijímá ani neinjektuje preview
  port nebo fixture.
- Permission/session failure z content portu invaliduje celý shell security
  scope, abortuje staré requesty a skryje načtený obsah.
- Produkční i preview větev používají stejný admin shell, page header a
  `AdminContentWorkspace`; liší se pouze datovým adapterem pod explicitním
  development/test guardem.

## Bezpečnostní a produkční hranice

`check-production-mock-boundary.mjs` syntakticky povoluje právě jeden dynamický
import demo workspace uvnitř pozitivního development/test guardu. Produkční
build následně skenuje server, static i standalone artefakty a odmítne preview
marker, test-support, MSW nebo mock source cestu.

Existující integrační sada serveru pokrývá event-scoped CRUD a audit,
speaker assignment, cross-origin a participant denial, unsafe URL/time vstup,
kolizi používaného dne, deterministický human publication preview, atomický
publish, stale draft/version a deduplikovaný outbox. Lokálně nebyla spuštěna
PostgreSQL sada, protože Docker daemon není dostupný; testy zůstávají součástí
CI/staging gate.

## Otevřený gate

`AUX-13C` nelze označit `[x]`, dokud `AUX-13A` nedoloží staging přihlášení,
admin context a route permission E2E na skutečné session. Asset resolver a
upload nejsou součástí tohoto řezu a zůstávají fail-closed v `AUX-13L`.
