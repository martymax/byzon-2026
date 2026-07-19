# ADR-002: Next.js App Router, React a strict TypeScript

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

Mobilně orientovaná PWA potřebuje serverově vykreslované veřejné obrazovky,
autentizované UI, stabilní HTTP API a přístup k browserovým offline funkcím.
Musí fungovat v běžném mobilním prohlížeči bez povinné instalace. Provoz má
zůstat v jednom webovém runtime bez dalšího aplikačního serveru.

## Rozhodnutí

Conference web použije aktuální vzájemně kompatibilní stabilní verze Next.js s
App Routerem, Reactu a TypeScriptu. TypeScript bude v strict režimu včetně
`noUncheckedIndexedAccess` a `exactOptionalPropertyTypes`. Next.js Route Handlers
obslouží webové API a produkční build použije `output: "standalone"`.

Read-first obrazovky mají používat Server Components. Client Components jsou
určené pro skutečnou interakci nebo browser API, ne jako výchozí způsob renderu.

## Důsledky

- UI a serverové vstupy mohou sdílet typované kontrakty, nikoli databázové entity.
- Stabilní `/api/v1` kontrakt zůstává povinný i pro formuláře dostupné přes UI.
- Frameworkové a React major upgrady vyžadují kompatibilitní review.
- Přesná čísla verzí se zvolí a uzamknou lockfilem až při scaffoldingu `P1-02`.

## Hranice

Worker neběží uvnitř Next.js request procesu. Samostatný Express server,
GraphQL nebo vlastní password auth vyžadují nové rozhodnutí.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §7.1, §7.6, §12 a `P1-02`.
