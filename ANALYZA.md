# Analýza webu byzon.cz a redesign 2026

Kompletní analýza stávajícího webu [byzon.cz](https://byzon.cz) a podklad k redesignu
pro letošní ročník (BYZON 2026). Cíl redesignu: **moderní vzhled dle aktuálních UX/UI
standardů při zachování veškerého obsahu, médií, loga i objednávkového formuláře
SimpleShop.**

---

## 1. Shrnutí

BYZON je jihočeská byznysová konference (pořadatel **ENJOiT s.r.o.**). Ročník 2026 se
koná **18.–19. září 2026** v **Clarion Congress Hotelu v Českých Budějovicích**.
Pozicování: *„Lidskost jako konkurenční výhoda“* — 2 dny lidskosti v praxi: 14 speakerů,
6 leadership case studies, 2 profi workshopy a řízený networking.

Stávající web je postavený na **WordPressu** (blokový editor Gutenberg + page builder
**Greenshift**). Obsahově je solidní, ale vizuálně působí jako složený ze stavebnicových
bloků — nejednotné odsazení, slabší typografická hierarchie a málo výrazná práce se
značkou. Redesign zachovává **stejnou topologii i texty**, ale staví je do čistého,
konzistentního a brandově silného designového systému.

---

## 2. Použité technologie originálu

| Vrstva | Originál | Redesign |
| --- | --- | --- |
| CMS / render | WordPress + Gutenberg + Greenshift | Statický web (HTML/CSS/JS), generovaný `build.py` |
| Typografie | **Khand** (Google Fonts), 300–700 | **Khand** (nadpisy) + **Inter** (text) |
| Objednávky | SimpleShop embed (`SimpleShopService.js`) | **Beze změny** — vložený 1:1 |
| Mapa | Leaflet | Embed Google Maps (dotaz na Clarion CB) |
| Videa | YouTube embed | YouTube embed (beze změny) |
| Média | `byzon.cz/wp-content/uploads/...` | Stejné URL (viz pozn. níže) |

---

## 3. Topologie webu (mapa stránek)

Zachována prakticky 1:1:

```
/                          Hlavní strana (homepage)
/program/                  Program (dny + stage)
/byznys-konference/        Minulé ročníky (2025 / 2024 / 2023)
/stante-se-partnerem/      Staňte se partnerem (brožura)
/simpleshop/               Ulovte si vstupenku (SimpleShop formulář)
/speaker/<jmeno>/          Detail řečníka (12×)
```

Hlavní navigace: **Hlavní strana · Program · Minulé ročníky · Staňte se partnerem**
+ výrazné CTA **„Ulovte si vstupenku“** (→ `/simpleshop/`).

---

## 4. Struktura homepage (sekce v pořadí)

1. **Hero** — logo, „Byzon 2026“, H1 *Lidskost jako konkurenční výhoda*, datum + místo,
   odznaky (14 speakerů · 6 leadership case studies · 2 profi workshopy · řízený
   networking), CTA + fotokoláž.
2. **Co vás čeká** — 3 karty:
   - *Páteční konference* → „Inspirace od lidí z praxe“
   - *Sobotní workshopy* → „Leadership, na který si sáhnete“
   - *Sobotní gala koktejl* → „Předávání cen Výjimečný Jihočech 2026“
3. **Vstupenky** — „Ulovte si vstupenku, než bude pozdě“: Early Bird / Standard / Late
   Bird (od 3 990 / 4 990 / 5 990 Kč) + termíny.
4. **Řečníci** — „Na koho se letos můžete těšit“ (12 karet) + „Stay tuned!“.
5. **Místo konání** — Clarion Congress Hotel + popis dopravy + mapa.
6. **Minulé ročníky** — 2025 (galerie), 2024 a 2023 (videa) + odkazy na fotky.
7. **Partneři** — loga + organizátor ENJOiT s.r.o.
8. **Patička** — kontakt, sociální sítě, právní odkazy, copyright.

---

## 5. Obsahový inventář

### Řečníci (12, pořadí dle homepage)
Markus Krug · Lukáš Hejlík · Margareta Křížová · Hana Slačálková · Jiří Jemelka ·
Andrea Bohačíková · Petr Dvořák · Šimon Srp · Konstancie Železná · Michal Veselý ·
Barbora Tůmová · Ondřej Vojáček. Role a medailonky převzaty z detailních stránek
(u Petra Dvořáka, Šimona Srpa a Konstancie Železné je na originále zatím placeholder
*„medailonek tu bude co nevidět“* — ponecháno).

### Partneři
JCI Czech Republic · Finovo · Borovka Event · BM Viva Marketing · Moderní Leader ·
Jihočeská hospodářská komora · Horizont. **Organizátor:** ENJOiT s.r.o., IČ 19295073,
jsem@byzon.cz.

### Klíčové údaje
- Termín: **18.–19. září 2026**, Clarion Congress Hotel, České Budějovice
- Ceny: Early Bird od 3 990 Kč (do 30. 6. 2026), Standard od 4 990 Kč (do 11. 9. 2026),
  Late Bird od 5 990 Kč (do vyčerpání kapacity)
- SimpleShop formulář: `data-simpleshopform="0MnNQ"`, kampaň 44467

### Média
Logo `Logo-na-sirku.png`, fotky řečníků (`/2026/06/`), galerie 2025 (`/2025/08/`),
hero fotky (`/2025/05/`), loga partnerů, brožura pro partnery (8 stran, `/2026/05/`).

---

## 6. Brand (odvozeno z originálu)

| Token | Hodnota | Použití |
| --- | --- | --- |
| Primární růžová | `#f5218e` | akcenty, CTA, odkazy |
| Tmavá švestková | `#140610` | tmavé sekce, hero, patička |
| Navy | `#0f172a` | doplňková tmavá |
| Břidlicová | `#454f5e` | tělo textu |
| Světle růžová | `#fad8e9` / `#fceef5` | tinty, pozadí sekcí |
| Písmo | **Khand** | nadpisy / display |

Tyto hodnoty vycházejí přímo z barevné palety motivu (`--wp--preset--color--accent-*`)
a `@font-face` definic originálu, takže redesign zůstává brandově věrný.

---

## 7. UX/UI hodnocení originálu → co redesign zlepšuje

| Oblast | Stav originálu | Redesign |
| --- | --- | --- |
| Vizuální konzistence | nejednotné mezery/typografie z bloků | jednotný designový systém (tokeny, rytmus sekcí) |
| Hierarchie | datum/USP jen v meta tagu, ne vizuálně | datum, místo a USP výrazně v heru |
| Řečníci | mřížka fotek bez rolí | karty s fotkou, jménem, rolí a hoverem |
| Ceník | textový výpis | přehledné cenové karty, zvýrazněný Standard |
| Mobil | funkční, ale generické | mobile-first, plnohodnotný drawer, fluidní typografie |
| Interakce | minimální | sticky header, scroll-reveal, lightbox galerie, taby programu |
| Přístupnost | základní | sémantické HTML, ARIA, skip-link, focus stavy, `prefers-reduced-motion` |
| Výkon | těžké WP/builder assety | ~30 kB CSS + ~5 kB JS, lazy-loading, bez frameworku |

---

## 8. Co zůstává stejné × co je nové

**Beze změny (dle zadání):**
- veškeré texty (verbatim), pořadí sekcí a topologie webu
- všechna média a logo (stejné soubory/URL)
- **SimpleShop objednávkový formulář** — vložen přesně (`createForm("0MnNQ")`)
- YouTube videa, partneři, kontaktní a právní údaje

**Nově:**
- moderní designový systém postavený na původním brandu (růžová + Khand)
- responzivní layout, mikrointerakce, lightbox, taby, přístupnost
- čistý statický kód bez WordPressu (snadné nasazení i údržba)

---

## 9. Technické řešení redesignu

- **Bez build závislostí pro provoz** — výstupem je čisté HTML/CSS/JS.
- **Jeden zdroj obsahu** — `data/content.json`; generátor `build.py` z něj sestaví
  všech 17 stránek. Úprava textu = úprava JSONu + `python3 build.py`.
- **Média** jsou prozatím odkazována na původní URL (`byzon.cz/wp-content/...`), takže
  zůstávají bitově identická. Pro plně samostatný web stačí soubory stáhnout do
  `/assets/img/` a přepsat `media_base` v `data/content.json`.

> Pozn.: URL loga partnera „Moderní Leader“ obsahuje diakritiku; pokud by se nenačetlo,
> má (jako všechna hotlinkovaná loga) textový fallback se jménem partnera.
