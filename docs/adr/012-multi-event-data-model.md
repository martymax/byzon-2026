# ADR-012: Multi-event datový model

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

Řešení se má po skončení ročníku bezpečně vyčistit a znovu použít pro další
konferenci. Data, role, souhlasy a feature flags různých akcí se přitom nesmějí
smíchat ani stát dostupnými přes znalost cizího ID.

## Rozhodnutí

Datový model bude od začátku event-scoped. Každá tabulka vlastněná akcí, kromě
kořenové `events`, nese `event_id` přímo a má nad ním index. Vazby mezi dvěma
eventovými záznamy chrání složený cizí klíč nebo ekvivalentní constraint s
`event_id`, aby nemohly propojit různé akce. Memberships, role, právní verze,
features, obsah a provozní záznamy patří konkrétní akci. Dotazy a policy helpers
vždy vyžadují event context.

Better Auth user identity může být globální, ale neposkytuje globální oprávnění.
Profily, memberships, role, souhlasy, vstupenky a všechna produktová data jsou
event-scoped. Globální superadmin se pro ročník 2026 nevytváří.

BYZON 2026 vznikne jako explicitní seed s vlastním slugem, časovou zónou a
konfigurací, nikoli jako globální implicitní event.

## Důsledky

- Další ročník lze založit bez kopie aplikačního schématu.
- Role a oprávnění se neudělují automaticky napříč akcemi.
- Integrační a IDOR testy používají nejméně dva eventy a ověřují izolaci.
- Unique indexy, cache keys, joby, audit a exporty musí obsahovat event scope.
- Vyšší explicitnost dotazů je přijatá cena za opakované použití a oddělení dat.

## Hranice

Multi-event neznamená veřejný multi-tenant marketplace ani automatické sdílení
profilů, souhlasů či vstupenek mezi ročníky. Dobrovolný networking a jeho souhlasy
vyžadují pro novou akci novou vědomou volbu uživatele.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): ADR-012 v §4, §8, §9 a `P2-01`.
