# Optimalizace administrace — 8. 9. 2026

## Rozsah a opravené nedostatky

Vizuální audit zahrnul přehled, program a obsah, řečníky, místa a místnosti,
partnery, praktické informace, vstupenky, účastníky a jejich detail, rezervace,
oznámení, interakce, tým, reporty, historii změn a nastavení. Kontroly proběhly
v lokálním Chromium se syntetickými daty; nejde o prohlášení o dokončeném
živém UAT s reálnými účastníky.

- **Společný vzhled:** typografie Khand / Inter a barvy BYZONu, tmavá boční
  navigace, konzistentní velikosti nadpisů, tlačítek, formulářů a panelů.
- **Navigace:** Interakce mají vlastní položku, správný aktivní stav a kontrolu
  všech potřebných oprávnění. Přibyly drobečky, přechod do účastnické aplikace
  a odkazy na sekce dlouhých stránek. Nabídka účtu používá běžné odkazy,
  zavírá se při opuštění fokusu, kliknutí mimo ni a Escape.
- **Program a obsah:** chybějící styl `filterActive` nahrazen úplným stavem
  vybraného ovládacího prvku. Primární oblasti používají podtržené záložky,
  typy obsahu a filtr aktivních/archivovaných položek jasné vybrané stavy.
  Akce řádků se zalamují i při 200% zvětšení; archivace má nižší vizuální váhu.
- **Formuláře a tabulky:** oddělené popisy, pole a akce; sekundární údaje
  v tabulkách se nezobrazují slepené. Sjednocený focus, čitelné stavové barvy,
  dotykové ovládání a režim omezených animací. Změny dostupnosti tlačítek
  neanimují text a pozadí přes přechodné barvy s nedostatečným kontrastem.
- **Přehled:** rychlé vstupy do programu, účastníků a rezervací, kompaktnější
  stavové karty; metrika odbavení se nezobrazuje bez příslušné capability.
- **Rezervace:** přehled kapacit ve dvou sloupcích na desktopu, barevné i textové
  rozlišení plné / téměř plné kapacity, české datum a mobilní souhrn ve dvou
  sloupcích.
- **Interakce:** menší blok důvodu změny, vyvážená mřížka čtyř funkcí,
  rychlé přechody na přednášky a moderátory.
- **Tým:** odkazy na členy, programové spolupracovníky a provozní oprávnění.
- **Reporty:** vytváření a historie vedle sebe na široké obrazovce,
  responzivní volby typu reportu a čitelnější historie.
- **Nastavení:** uživatelský popis registračních a rezervačních pravidel
  nahrazuje interní implementační poznámku.
- **Detail účastníka:** ukládací lišta je přichycená jen při neuložených
  změnách; při prohlížení nepřekrývá profil.

## Ověření

- `pnpm lint` — bez chyb; během vývoje pouze upozornění generovaného MSW
  workeru, který produkční build odstraní.
- `pnpm typecheck` — všechny workspace balíčky prošly.
- `pnpm test` — všechny spuštěné workspace sady prošly; conference 685/685,
  187 integračních testů přeskočeno bez testovací databáze.
- `pnpm build` — web i worker prošly, včetně obou kontrol hranice mocků.
- Admin komponentové testy: **288/288**, tři viewporty. Po úpravě lišty detailu
  účastníka dalších **6/6** cílených testů.
- E2E: axe, struktura nadpisů a přetékání hlavních stránek na šířkách
  **320, 375, 768, 1280 a 1440 px**; navigace klávesnicí a mobilní drawer.
- E2E na 1280 px: **200% reflow**, reduced motion, CLS < 0,1,
  interakční rozpočty i maximální velikosti seznamů prošly.
- Nové regrese ověřují aktivní a oprávněními omezenou navigaci Interakcí,
  zavření nabídky účtu po opuštění fokusu a vykreslený styl vybraného typu
  obsahu. Admin journey testy nyní načítají i globální produkční CSS;
  diagnostika axe obsahuje konkrétní problémové elementy.

## Nasazení

Cíl: existující Railway `staging`, Git větev
`stage/participant-access-live-qa`, veřejná adresa `https://app.byzon.cz/admin`.
Používá se standardní Git deploy podle `docs/runbooks/railway-staging.md`.
Změna neobsahuje migraci databáze ani změnu API kontraktů.
