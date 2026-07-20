# ADR-004: Better Auth pro identitu a relace

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

Aplikace potřebuje bezpečné identity, relace, magic link přihlášení a revokaci.
Současně musí oddělit obecnou identitu uživatele od oprávnění plynoucích z
konkrétní vstupenky a akce.

## Rozhodnutí

Better Auth bude spravovat identity, session lifecycle a magic link mechanismus.
Event membership, role, onboarding, souhlasy a ticket claim zůstávají vlastní
doménovou vrstvou nad PostgreSQL. Úspěšné přihlášení samo o sobě neposkytuje
přístup k datům akce.

Magic link plugin se musí nakonfigurovat na hashované uložení tokenu, krátkou
expiraci a přesný allowlist návratových URL. Ověření token spotřebuje atomicky.
Pokud by verification storage přešlo z PostgreSQL do Redis, adapter musí v
multi-instance provozu podporovat atomické `getAndDelete`/`GETDEL`.

## Důsledky

- Nevytváří se vlastní password ani session framework.
- Server musí při každém chráněném vstupu ověřit relaci i event-scoped oprávnění.
- Magic linky jsou krátkodobé, jednorázové, v úložišti hashované a nelogují se.
- Auth tabulky a migrace se verzují společně s aplikačním schématem.
- Ticket transfer nebo bezpečnostní incident může vyvolat cílenou revokaci relací.

## Hranice

Better Auth nerozhoduje o platnosti vstupenky, rezervaci, check-inu ani viditelnosti
profilu. Osobní aktivační odkaz doručený e-mailem nebo SMS je ticket-claim token,
nikoli Better Auth magic link; odkaz, sken i ruční kód musí skončit ve stejné
doménové claim operaci a nesmějí založit duplicitní profil. Náhrada knihovny nebo
zavedení vlastních hesel vyžaduje nový ADR.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §11.2, §16.2 a `P2-04`.
- [Better Auth – Magic link](https://better-auth.com/docs/plugins/magic-link).
