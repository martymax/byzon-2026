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
- Poslední dokončená práce: přidání detailního implementačního plánu a dvanácti
  architektonických rozhodnutí (ADR).
- Poslední publikovaný commit před tímto handoverem: `c0e06f1` –
  `docs: add architecture decision records`.
- Stav při vytvoření handoveru: pracovní strom byl čistý a lokální etapová větev
  odpovídala vzdálené větvi.

## Co bylo dokončeno

- `AI_IMPLEMENTATION_PLAN.md` v1.2 byl přidán v commitu `3e9e4bb`.
- `docs/adr/README.md` a ADR-001 až ADR-012 byly přidány v commitu `c0e06f1`.
- Oba commity byly pushnuty na `origin/stage/00-foundation` a následně ověřeny
  pomocí fetch a porovnání lokálního a vzdáleného SHA.

## Rozpracovaná práce

- Žádná implementační práce není rozpracovaná.
- Etapa 00 zatím obsahuje pouze plánovací a architektonickou dokumentaci.

## Otevřené body a rizika

- Před zahájením implementace vyber nejbližší nehotový úkol etapy 00 podle
  `AI_IMPLEMENTATION_PLAN.md` a ověř jeho závislosti a akceptační kritéria.
- Veřejný statický web musí během vývoje nové aplikace zůstat provozně
  nedotčený.
- Commit, push, vytvoření nebo aktualizace PR a merge se řídí schvalovacími
  pravidly v `AI_IMPLEMENTATION_PLAN.md`.
- PR pro `stage/00-foundation` zatím nebyl v rámci této práce vytvořen.

## Doporučený další krok

Najít v `AI_IMPLEMENTATION_PLAN.md` první nehotový a neblokovaný úkol etapy 00,
ověřit jeho Definition of Ready a před implementací uživateli stručně potvrdit
zamýšlený scope.

## Poslední ověření

- `git status -sb`: větev byla před vytvořením tohoto souboru čistá a
  synchronizovaná s `origin/stage/00-foundation`.
- Kontrola dokumentace: `git diff --cached --check` proběhla u předchozích dvou
  dokumentačních commitů bez chyb.
- V adresáři `docs/` bylo publikováno 13 Markdown souborů, celkem 519 řádků.
