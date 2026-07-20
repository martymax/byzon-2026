# BYZON 2026 — redesign webu

Moderní redesign webu [byzon.cz](https://byzon.cz) pro ročník 2026. Statický web
(HTML/CSS/JS) bez runtime závislostí. Obsah, média, logo i objednávkový formulář
SimpleShop zůstávají stejné — mění se jen vzhled a UX. Kompletní analýza je
v [`ANALYZA.md`](./ANALYZA.md).

## Rychlý start (náhled)

```bash
python3 -m http.server      # poté otevři http://localhost:8000/
```

> Web používá „hezké“ URL (`/program/`, `/speaker/...`), proto je potřeba spustit přes
> server (ne otevírat soubor přímo z disku).

## Úprava obsahu

Veškerý obsah je v jednom souboru: [`data/content.json`](./data/content.json).
Po úpravě znovu vygeneruj stránky:

```bash
python3 build.py
```

Generátor aktuálně sestaví 24 stránek (homepage, program, minulé ročníky,
vstupenky, partneři, 17 detailů řečníků a 2 právní stránky) ze sdílených
komponent v [`build.py`](./build.py); navíc vytváří 404, sitemapu a robots.txt.

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
build.py                 generátor (HTML ze šablon + data/content.json)
data/content.json        zdroj obsahu (texty, řečníci, ceny, partneři, média)
assets/css/styles.css    designový systém a komponenty
assets/js/main.js        header, mobilní menu, taby, lightbox, scroll-reveal
index.html               vygenerované stránky (committed) ...
program/  byznys-konference/  simpleshop/  stante-se-partnerem/  speaker/<jmeno>/
```

## Důležité poznámky

- **SimpleShop** je vložen 1:1 (`data-simpleshopform="0MnNQ"`, `createForm("0MnNQ")`).
  Formulář se načítá z `form.simpleshop.cz` v prohlížeči návštěvníka.
- **Média** jsou odkazována na původní URL `byzon.cz/wp-content/...` (zůstávají
  identická). Pro samostatný web je stáhni do `assets/img/` a uprav `media_base`
  v `data/content.json`. Hotlinkovaná loga mají textový fallback při nedostupnosti.
- **Fonty** (Khand + Inter) se načítají z Google Fonts.

## Nasazení

Jde o statické soubory — nasaditelné kamkoli (Nginx, Netlify, Vercel, GitHub Pages,
nebo zpět do WordPressu). Stačí servírovat kořen repozitáře.

## Konferenční aplikace

Nová aplikace žije vedle veřejného webu v pnpm monorepu. Vyžaduje Node verze z
`.nvmrc` a pnpm verze uvedené v `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Kontroly aplikace spustíte přes `pnpm run ci`, browser smoke přes `pnpm test:e2e`.
Railway staging postup je v `docs/runbooks/railway-staging.md`.
