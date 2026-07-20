# ADR-011: Feature flags po jednotlivých akcích

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

Priority A, B a C mají rozdílné launch gates. Funkce se musí zpřístupňovat
postupně a nezávisle pro jednotlivé ročníky, aniž by nedokončená nižší priorita
ohrozila základní cestu účastníka.

## Rozhodnutí

Feature flags budou uloženy a vyhodnocovány per event. Server je vyhodnotí před
obsloužením chráněného endpointu; klient je používá pouze pro navigaci a UX.
Změna flagu je oprávněná a auditovaná operace.

Počáteční katalog zahrnuje networking, oznámení, portál řečníka, otázky, ankety,
hodnocení, social wall, offline check-in a synchronizaci veřejného obsahu.
`social_wall_enabled` a `offline_checkin_enabled` jsou ve výchozím stavu vypnuté
do splnění vlastních gates. `public_content_sync_enabled` zůstává vypnutý do
uzavření `BLOCKER-WEB-01`; každá další dosud neakceptovaná funkce je serverově
vypnutá do splnění své gate.

## Důsledky

- Přímá URL ani API nesmějí obejít vypnutou funkci.
- Testy ověřují zapnutý i vypnutý stav pro každý relevantní event.
- Flag není náhradou autorizace, migrace ani bezpečného rollbacku.
- Vypnutí funkce musí mít definované chování pro již uložená data a rozpracované
  operace.

## Hranice

Globální environment flag lze použít jako nouzový kill switch, ale nesmí nahradit
eventovou konfiguraci bez nového rozhodnutí. Flag nesmí obejít akceptaci Priority
A ani požadavek dokončit Priority B před konferencí.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §3.3, §7.5, Gate A a Etapa 16.
