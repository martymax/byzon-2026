# ADR-001: Jeden repozitář a monorepo

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

Veřejný `byzon.cz` je statický web generovaný skriptem `static-site/build.py` a musí zůstat
provozně nedotčený. Nová aplikace potřebuje webový proces, worker a sdílené
doménové, databázové a UI balíčky. Samostatné repozitáře by zvyšovaly riziko
rozjezdu kontraktů a značky.

## Rozhodnutí

Stávající web a nová aplikace budou v jednom GitHub repozitáři. Nový JavaScript
se uspořádá jako pnpm workspace s aplikacemi v `apps/` a sdílenými balíčky v
`packages/`. Web, worker a údržbové příkazy zůstanou samostatně nasaditelné
Railway služby s vlastními root/watch paths a start příkazy.

## Důsledky

- Sdílené typy a pravidla lze měnit atomicky s jejich konzumenty.
- Repozitář má jeden Node lockfile, ale CI nadále samostatně ověřuje Python build.
- Filtry deploymentu musí zabránit zbytečnému restartu nesouvisejících služeb.
- Modulové hranice musí bránit tomu, aby pohodlí monorepa vytvořilo skryté vazby.

## Hranice

Zdroj a FTP-ready výstup veřejného webu jsou oddělené v `static-site/`; celý
obsah `static-site/public/` je nasaditelný na FTP. Změna hostingu veřejného webu
vyžaduje vlastní úkol a případně nový ADR.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §2, §5, §6 a `P1-01` až `P1-05`.
