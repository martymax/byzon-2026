# ADR-006: REST JSON API a SSE

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

PWA potřebuje stabilní rozhraní pro online i řízené offline chování. Živé dotazy,
ankety a provozní změny jsou převážně tok server → klient a po reconnectu musí
jít vždy obnovit z autoritativního snapshotu.

## Rozhodnutí

Aplikační API bude REST JSON pod verzovanou cestou `/api/v1`. Chyby používají
`application/problem+json`, request ID a stabilní doménové kódy. Opakovatelné
mutace přijímají `Idempotency-Key`.

Živé aktualizace použijí Server-Sent Events. SSE je pouze signál změny: po
připojení nebo reconnectu klient načte kanonický snapshot z REST API. Události
mají navazující ID/verzi, podporují `Last-Event-ID`, heartbeat a autorizované
event/session topics; fan-out mezi webovými instancemi používá Redis. Reconnect
používá exponenciální backoff s jitterem.

## Důsledky

- API lze cacheovat, verzovat, dokumentovat a používat z offline synchronizace.
- Klient nesmí odvozovat trvalý stav jen z historie SSE nebo Redis pub/sub.
- Breaking změna vyžaduje kompatibilní přechod nebo `/api/v2`.
- Reconnect a ztracené události mají explicitní testovací scénáře.
- Staging ověří, že Railway/proxy cestou nedochází k nežádoucímu bufferování SSE.

## Hranice

Plně offline zprávy, otázky a hlasování nejsou součástí ročníku 2026. GraphQL
nebo WebSocket jako hlavní transport vyžaduje nový ADR. Server Actions nesmějí
obejít stabilní `/api/v1` kontrakt potřebný pro PWA klienta. Better Auth routes a
health endpointy jsou explicitní infrastrukturní výjimky z `/api/v1`.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §7.2, §11, §14 a `P12-04`.
