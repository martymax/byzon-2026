# BYZON 2026 — redesign webu

Moderní redesign webu [byzon.cz](https://byzon.cz) pro ročník 2026. Statický web
(HTML/CSS/JS) bez runtime závislostí. Obsah, média, logo i objednávkový formulář
SimpleShop zůstávají stejné — mění se jen vzhled a UX. Kompletní analýza je
v [`ANALYZA.md`](./ANALYZA.md).

## Rychlý start (náhled)

```bash
pnpm preview:static      # poté otevři http://localhost:8000/
```

> Web používá „hezké“ URL (`/program/`, `/speaker/...`), proto je potřeba spustit přes
> server (ne otevírat soubor přímo z disku).

## Úprava obsahu

Veškerý obsah je v jednom souboru:
[`static-site/data/content.json`](./static-site/data/content.json).
Po úpravě znovu vygeneruj stránky:

```bash
pnpm build:static
```

Generátor aktuálně sestaví 24 stránek (homepage, program, minulé ročníky,
vstupenky, partneři, 17 detailů řečníků a 2 právní stránky) ze sdílených
komponent v [`static-site/build.py`](./static-site/build.py); navíc vytváří 404,
sitemapu a robots.txt.

## Nasazení na FTP

Na FTP kořen webu `byzon.cz` zkopíruj **celý obsah** složky
[`static-site/public/`](./static-site/public/) — nic dalšího z repozitáře tam
nepatří. Složka už obsahuje HTML, assety, `404.html`, `robots.txt`, `sitemap.xml`
i skrytý serverový soubor `.htaccess`.

Po každé změně obsahu nebo generátoru nejdřív spusť:

```bash
pnpm build:static
pnpm test:static
```

## Regresní kontrola veřejného webu

Po změně generátoru, obsahu nebo při úpravě repozitářového toolchainu spusťte:

```bash
python3 tests/static_site_smoke.py
```

Kontrola provede izolovaný build, porovná jej s commitnutými výstupy a ověří
kritické lokální odkazy a SimpleShop embed. Aktuální měření je v
[`docs/static-site-baseline.md`](./docs/static-site-baseline.md).

## Struktura

```
static-site/
├── build.py             generátor HTML
├── data/                zdrojový obsah a právní texty (na FTP nepatří)
└── public/              kompletní obsah určený ke zkopírování na FTP
    ├── assets/          CSS, JS, obrázky, video a veřejné dokumenty
    ├── index.html
    ├── program/
    ├── byznys-konference/
    ├── simpleshop/
    ├── stante-se-partnerem/
    └── speaker/<jmeno>/

apps/                    aplikace a worker pro app.byzon.cz (Railway)
packages/                sdílené balíčky aplikace
```

## Důležité poznámky

- **SimpleShop** je vložen 1:1 (`data-simpleshopform="0MnNQ"`, `createForm("0MnNQ")`).
  Formulář se načítá z `form.simpleshop.cz` v prohlížeči návštěvníka.
- **Média** jsou odkazována na původní URL `byzon.cz/wp-content/...` (zůstávají
  identická). Pro samostatný web je stáhni do `static-site/public/assets/img/`
  a uprav `media_base` v `static-site/data/content.json`. Hotlinkovaná loga mají
  textový fallback při nedostupnosti.
- **Fonty** (Khand + Inter) se načítají z Google Fonts.

## Konferenční aplikace

Nová aplikace žije vedle veřejného webu v pnpm monorepu. Vyžaduje Node verze z
`.nvmrc` a pnpm verze uvedené v `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev:infra
pnpm dev
```

`dev:infra` spustí verzovaný PostgreSQL 17 a Redis 8.2 pouze na lokálním
loopbacku. Redis používá AOF a `noeviction`, stejně jako vyžaduje BullMQ; služby
lze zastavit přes `pnpm dev:infra:down` bez smazání jejich volumes.

Kontroly aplikace spustíte přes `pnpm run ci`, browser smoke přes `pnpm test:e2e`.
Railway staging postup je v `docs/runbooks/railway-staging.md`.

Admin preview vstupenek používá výhradně serverové SimpleShop API credentials
`SIMPLESHOP_API_EMAIL` a `SIMPLESHOP_API_KEY`. Organizátor spouští bounded
read-only načtení ručně; aplikace posílá do SimpleShopu jen allowlistované
`GET` požadavky a vrací sanitizované schema/agregáty. `P4-02` nemá apply cestu
a nemění ticket tabulku. Test-only `SIMPLESHOP_API_BASE_URL` je ve stagingu a
produkci odmítnut. Přesný ověřený kontrakt a otevřená mapování stavů jsou v
[`ADR-015`](docs/adr/015-simpleshop-api-sync.md).

Kompletní vývojový frontend nad výhradně syntetickými daty spustíte odděleně:

```bash
pnpm dev:mock
```

Poté otevřete `http://localhost:3000/`. `dev:mock` je výhradně development
režim a je viditelně označený; všechny neobsloužené lokální API požadavky
selžou zavřeně. Produkční dependency graph používá kanonické fetch adaptery a
source i post-build kontrola odmítne mock handlery, preview porty a syntetické
fixtures.

Přehled všech průchodů, rout, syntetických vstupů, kontraktů a otevřených
integračních blokátorů je v
[`docs/frontend-implementation-report.md`](docs/frontend-implementation-report.md).
