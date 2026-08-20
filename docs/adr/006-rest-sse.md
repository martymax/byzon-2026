# ADR-006: REST JSON API a bounded polling

- Stav: Přijato
- Datum: 20. července 2026; scope amendment 15. srpna 2026

## Kontext

PWA potřebuje stabilní rozhraní pro online i řízené offline chování. Rozsah
2026 neobsahuje ankety, projekci ani jinou launch-critical živou distribuci.
Volitelné moderátorské dotazy snesou krátkou prodlevu a po reconnectu se vždy
obnovují z autoritativního snapshotu.

## Rozhodnutí

Aplikační API bude REST JSON pod verzovanou cestou `/api/v1`. Chyby používají
`application/problem+json`, request ID a stabilní doménové kódy. Opakovatelné
mutace přijímají `Idempotency-Key`.

Ročník 2026 používá pro volitelné moderátorské dotazy omezený polling REST
snapshotu. Interval je serverově omezený, po skrytí stránky se polling zastaví
a chyby používají exponenciální backoff s jitterem. SSE se v roce 2026
neimplementuje; jeho případné zavedení vyžaduje nový měřitelný požadavek a ADR.

## Důsledky

- API lze cacheovat, verzovat, dokumentovat a používat z offline synchronizace.
- Klient nesmí odvozovat trvalý stav z lokální historie pollů nebo Redis pub/sub.
- Breaking změna vyžaduje kompatibilní přechod nebo `/api/v2`.
- Polling má testy intervalu, zastavení na backgroundu, backoffu, oprávnění a
  načtení kanonického snapshotu po reconnectu.

## Hranice

Plně offline otázky, hlasování, ankety a projekce nejsou součástí ročníku 2026.
SSE, GraphQL nebo WebSocket jako hlavní transport vyžaduje nový ADR. Server Actions nesmějí
obejít stabilní `/api/v1` kontrakt potřebný pro PWA klienta. Better Auth routes a
health endpointy jsou explicitní infrastrukturní výjimky z `/api/v1`.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): `SCOPE-2026-05`, §7.2, §11, §14 a `P12-04`.
