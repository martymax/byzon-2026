# ADR-011: Feature flags Priority A/B po jednotlivých akcích

- Stav: Přijato
- Datum: 20. července 2026; scope amendment 15. srpna 2026

## Kontext

Priority A a volitelná B mají rozdílné launch gates. Priority C pro ročník
2026 neexistuje. Funkce se musí zpřístupňovat
postupně a nezávisle pro jednotlivé ročníky, aniž by nedokončená nižší priorita
ohrozila základní cestu účastníka.

## Rozhodnutí

Feature flags budou uloženy a vyhodnocovány per event. Server je vyhodnotí před
obsloužením chráněného endpointu; klient je používá pouze pro navigaci a UX.
Změna flagu je oprávněná a auditovaná operace.

Podporovaný katalog zahrnuje networkingový adresář, kritická oznámení, prosté
dotazy, hodnocení, offline check-in a synchronizaci veřejného obsahu.
`offline_checkin_enabled` je ve výchozím stavu vypnutý do splnění vlastní gate
a `public_content_sync_enabled` do uzavření `BLOCKER-WEB-01`. Historická pole
`speaker_portal_enabled`, `polls_enabled` a `social_wall_enabled` mohou zůstat
ve schématu jen do bezpečné expand/contract migrace: jsou vždy `false`, nemají
route/API a nejsou podporovanými feature flags ročníku 2026.

## Důsledky

- Přímá URL ani API nesmějí obejít vypnutou funkci.
- Testy ověřují zapnutý i vypnutý stav pro každý relevantní event.
- Flag není náhradou autorizace, migrace ani bezpečného rollbacku.
- Vypnutí funkce musí mít definované chování pro již uložená data a rozpracované
  operace.

## Hranice

Globální environment flag lze použít jako nouzový kill switch, ale nesmí nahradit
eventovou konfiguraci bez nového rozhodnutí. Flag nesmí obejít akceptaci Priority
A. Priority B je volitelná a její nedokončení nesmí blokovat konferenci.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): `SCOPE-2026-01`, §3.3, §7.5, Gate A a Etapy 10/16.
