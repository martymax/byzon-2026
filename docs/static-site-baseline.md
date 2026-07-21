# P0-07: Baseline veřejného statického webu

> Změřeno 20. července 2026 na větvi `stage/00-foundation` před zavedením
> monorepa. Hodnoty popisují commitnutý výstup `pnpm build:static` ve složce
> `static-site/public/`.

## Baseline

| Metrika | Hodnota |
| --- | ---: |
| HTML výstupy generátoru včetně 404 | 25 |
| Ostatní generované soubory | 2 (`sitemap.xml`, `robots.txt`) |
| Velikost generovaných HTML | 351 715 B |
| Největší stránka | `static-site/public/program/index.html`, 72 062 B |
| Lokální assety bez `.DS_Store` | 58 |
| Velikost lokálních assetů | 57 613 828 B |
| Největší asset | `static-site/public/assets/video/byzon-2025.mp4`, přibližně 14 MiB |
| Profily řečníků | 17 |
| Právní stránky | 2 |

Velikost assetů je pouze evidenční baseline, nikoli současný performance budget:
většina obrázků je lazy-loaded a video se nestahuje jako součást každé stránky.
Síťové metriky a Lighthouse měření vyžadují nasazené prostředí a budou doplněny
v etapách 1 a 15.

## Regresní smoke test

Spuštění:

```bash
python3 tests/static_site_smoke.py
```

Test používá pouze Python standard library a:

1. zkopíruje `static-site/build.py`, `static-site/data/` a veřejné assety do
   dočasného adresáře;
2. spustí izolovaný build, takže nemění pracovní strom;
3. odvodí očekávané profily a právní stránky ze
   `static-site/data/content.json`;
4. porovná SHA-256 každého generovaného souboru s commitnutým výstupem;
5. ověří cíle lokálních `href`, `src`, `poster` a `data-full` odkazů;
6. ověří kritické kontrakty: češtinu, skip link, program, SimpleShop form ID a
   loader, GTM container.

Při úmyslné změně veřejného webu se nejdřív spustí `pnpm build:static`, zkontroluje
se vizuální a obsahový diff a teprve pak se commitnou zdroj i generované soubory.
Test tedy neblokuje legitimní změny, ale odhalí zapomenutý build, nedeterminismus,
chybějící lokální soubor a ztrátu kritického embedu.

## Hranice

- Test nevolá externí služby a neověřuje dostupnost SimpleShopu, Google Tag
  Manageru, sociálních sítí ani externích profilů.
- Nejde o screenshotovou vizuální regresi, accessibility audit ani browser E2E.
- Test neřeší novou conference aplikaci; chrání workflow v `static-site/`,
  aby jej následující pnpm workspace a CI změny nerozbily.
