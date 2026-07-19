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
- Poslední dokončená práce: `P0-06`, inventura `data/content.json` a lokálních
  assetů s mapováním na cílové entity v `docs/content-inventory.md`.
- Poslední publikovaný commit: `f442f97` – `docs: add project handover`.
- Aktuální lokální změny obsahují pouze scope `P0-06`; větev před jejich
  vytvořením odpovídala vzdálené větvi.

## Co bylo dokončeno

- `AI_IMPLEMENTATION_PLAN.md` v1.2 byl přidán v commitu `3e9e4bb`.
- `docs/adr/README.md` a ADR-001 až ADR-012 byly přidány v commitu `c0e06f1`.
- Oba commity byly pushnuty na `origin/stage/00-foundation` a následně ověřeny
  pomocí fetch a porovnání lokálního a vzdáleného SHA.
- `P0-06` zmapoval 17 řečníků, 66 programových položek, 7 partnerů a 58
  lokálních assetů. Všechny souborové cesty odkazované z JSON existují.

## Rozpracovaná práce

- `P0-06` je implementován a lokálně ověřen, ale dosud nebyl uživatelem
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

Po schválení uživatelem commitnout a pushnout pouze scope `P0-06`. Poté
realizovat `P0-07`: baseline a regresní smoke test současného veřejného buildu.

## Poslední ověření

- `jq` inventura: 17 řečníků, 2 dny, 7 scén/sekcí, 66 programových položek,
  7 partnerů a 3 cenové hladiny.
- Kontrola cest: žádný souborový odkaz z `data/content.json` nechybí.
- Produktové zadání v1.0 bylo ověřeno na revizi uvedené v implementačním plánu.
