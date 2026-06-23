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

Generátor sestaví všech 17 stránek (homepage, program, minulé ročníky, vstupenky,
partneři + 12 detailů řečníků) ze sdílených komponent v [`build.py`](./build.py).

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
