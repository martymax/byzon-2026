# BYZON 2026 – handover

> Poslední aktualizace: 20. července 2026
>
> Účel: stručný provozní kontext pro navázání práce v novém chatu.

## Pokyny pro dalšího agenta

1. Před zahájením práce přečti tento soubor, `AI_IMPLEMENTATION_PLAN.md`,
   související ADR v `docs/adr/`, `README.md` a případný `AGENTS.md`.
2. Ověř skutečný stav pomocí `git status -sb` a `git log`; údaje níže mohou být
   po ručním zásahu zastaralé.
3. Neměň ani necommituj cizí nebo nesouvisející změny.
4. Na konci každé pracovní akce tento soubor aktualizuj. Zapiš výsledek,
   provedené kontroly, otevřené otázky, rizika a konkrétní další krok.
5. `handover.md` zahrň do stejného tematického commitu jako práci, kterou
   dokumentuje. Pokud se pouze předává kontext bez implementační změny, může mít
   samostatný dokumentační commit po explicitním schválení uživatelem.
6. Historii práce hledej v Gitu; tento soubor udržuj stručný a popisuj v něm jen
   stav potřebný pro bezprostřední pokračování.

## Aktuální stav

- Aktivní etapa: `00-foundation`.
- Pracovní větev: `stage/00-foundation`.
- Vzdálená větev: `origin/stage/00-foundation`.
- Výchozí větev `main`: commit `2993342`.
- Poslední dokončená práce: `P0-09`, doplnění vlastníků přijatých rozhodnutí a
  explicitních gates všech otevřených blockerů.
- Poslední publikovaný commit: `bf2e4ab` –
  `test(P0-07): protect static site build`.
- Aktuální lokální změny obsahují pouze scope `P0-09`; větev před jejich
  vytvořením odpovídala vzdálené větvi.

## Co bylo dokončeno

- `AI_IMPLEMENTATION_PLAN.md` v1.2 byl přidán v commitu `3e9e4bb`.
- `docs/adr/README.md` a ADR-001 až ADR-012 byly přidány v commitu `c0e06f1`.
- Oba commity byly pushnuty na `origin/stage/00-foundation` a následně ověřeny
  pomocí fetch a porovnání lokálního a vzdáleného SHA.
- `P0-06` zmapoval 17 řečníků, 66 programových položek, 7 partnerů a 58
  lokálních assetů. Všechny souborové cesty odkazované z JSON existují.
- `P0-07` přidal `tests/static_site_smoke.py` a baseline v
  `docs/static-site-baseline.md`. Test provádí izolovaný build, byte-level
  porovnání, kontrolu lokálních odkazů a kritických embedů bez nové závislosti.
- `P0-09` rozšířil registry v §4 a §22 plánu: všech 12 ADR má odpovědné role a
  všech 17 otevřených blockerů má vlastníka, gate a bezpečný výchozí postup.

## Rozpracovaná práce

- `P0-09` je implementován a lokálně ověřen, ale dosud nebyl uživatelem
  schválen ke commitu ani pushnut.

## Otevřené body a rizika

- Před zahájením implementace vyber nejbližší nehotový úkol etapy 00 podle
  `AI_IMPLEMENTATION_PLAN.md` a ověř jeho závislosti a akceptační kritéria.
- Veřejný statický web musí během vývoje nové aplikace zůstat provozně
  nedotčený.
- Commit, push, vytvoření nebo aktualizace PR a merge se řídí schvalovacími
  pravidly v `AI_IMPLEMENTATION_PLAN.md`.
- PR pro `stage/00-foundation` zatím nebyl v rámci této práce vytvořen.
- Programová data nemají stabilní ID ani strukturované časy; položka `24:00 - ?`
  není bezpečně importovatelná. Koučovací sloty postrádají kouče a kapacity.
- `P0-02` zůstává blokován chybějícím ukázkovým SimpleShop exportem.

## Doporučený další krok

Po schválení uživatelem commitnout a pushnout pouze scope `P0-09`. Další úkoly
etapy 0 vyžadují vstup vlastníků: SimpleShop export (`P0-02`), hosting veřejného
webu (`P0-03`), produktová rezervační pravidla (`P0-04`) a onsite profil
(`P0-05`). `P0-08` je záměrně odložen před etapu 8 a do té doby platí fake mail.

## Poslední ověření

- `jq` inventura: 17 řečníků, 2 dny, 7 scén/sekcí, 66 programových položek,
  7 partnerů a 3 cenové hladiny.
- Kontrola cest: žádný souborový odkaz z `data/content.json` nechybí.
- Produktové zadání v1.0 bylo ověřeno na revizi uvedené v implementačním plánu.
- `python3 tests/static_site_smoke.py`: prošel izolovaný build, shoda všech 27
  generovaných souborů, lokální odkazy a kritické kontrakty.
- Baseline: 25 HTML výstupů / 351 715 B a 58 assetů / 57 613 828 B.
