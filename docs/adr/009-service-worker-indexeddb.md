# ADR-009: Service worker a IndexedDB

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

Na místě může být slabý nebo chybějící signál. Dříve načtený program, osobní
agenda a praktické informace proto musí zůstat dostupné, aniž by aplikace offline
slibovala autoritativní rezervaci nebo živou interakci.

## Rozhodnutí

Verzovaný service worker bude spravovat app shell a bezpečně cacheovatelná
veřejná data. IndexedDB bude ukládat explicitně povolená DTO, jejich verzi, čas
poslední synchronizace a uživatelsky oddělený snapshot agendy.

Offline fronta je povolena jen pro bezpečné operace uvedené v cache kontraktu,
například add/remove agendy a read receipts. Každá položka má klientské UUID jako
idempotency key. Rezervace, waitlist, networking, zprávy, živé funkce a check-in
zůstávají online, dokud samostatná gate výslovně nerozhodne jinak.

## Důsledky

- UI vždy ukazuje offline/stale stav a čas poslední aktualizace.
- Logout, změna účtu nebo revokace membership vymaže osobní lokální data.
- Aktualizace service workeru a IndexedDB migrace potřebují rollback a testy.
- Background Sync je optimalizace; synchronizace musí fungovat i po běžném
  návratu online nebo otevření aplikace.

## Hranice

Cache nesmí obsahovat tajné tokeny ani nepovolené PII. Offline check-in zůstává
ve výchozím stavu vypnutý. Service worker nenahrazuje samostatný, předem
odzkoušený provozní fallback pro aktivaci, rezervace a check-in.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §13, Etapa 7 a `BLOCKER-OPS-02`.
