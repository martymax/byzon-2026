# ADR-008: Databáze jako zdroj publikovaného obsahu

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

Program, řečníci, partneři a praktické informace se nesmějí ručně rozcházet mezi
`app.byzon.cz` a veřejným `byzon.cz`. Organizátor zároveň potřebuje návrh,
náhled a publikaci bez zásahu vývojáře.

## Rozhodnutí

PostgreSQL bude jediným zdrojem schváleného publikovaného programu, veřejných
profilů řečníků a partnerů, praktických informací a souvisejícího obsahu. Netýká
se to soukromých účastnických ani networkingových profilů. Draft změny nejsou
veřejné. Publish vytvoří neměnnou, verzovanou publication snapshot; aplikace a
veřejný web čtou nebo synchronizují stejnou publikovanou verzi přes bezpečné
veřejné API.

Stávající `static-site/data/content.json` zůstává během prvních etap vstupem současného
statického buildu. Později se použije jako idempotentní migrační vstup a
`static-site/build.py` dostane deterministický exportovaný snapshot.

## Důsledky

- Odpadne ruční dvojí editace stejného obsahu.
- Admin potřebuje preview, atomický publish a historii verzí.
- Oba weby zobrazí publication version a provoz sleduje případný drift.
- Neúspěšný rebuild veřejného webu je viditelný jako `sync_pending`, nikoli jako
  tichý úspěch.

## Hranice

Hosting a konkrétní rebuild trigger veřejného webu řeší `BLOCKER-WEB-01`. Do jeho
uzavření zůstává synchronizační adapter mimo produkci no-op.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §15.5, Etapa 3, Etapa 14 a `BLOCKER-WEB-01`.
