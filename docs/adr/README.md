# Architektonická rozhodnutí

Tento adresář rozepisuje závazná technická rozhodnutí shrnutá v hlavním
[implementačním plánu](../../AI_IMPLEMENTATION_PLAN.md). Záznamy popisují stav,
kontext, rozhodnutí, důsledky a hranice; konkrétní verze knihoven se uzamknou až
v úkolech, které je zavádějí.

| ID | Název | Stav |
| --- | --- | --- |
| [ADR-001](001-monorepo.md) | Jeden repozitář a monorepo | Přijato |
| [ADR-002](002-nextjs-react-typescript.md) | Next.js App Router, React a strict TypeScript | Přijato |
| [ADR-003](003-postgresql-drizzle.md) | PostgreSQL a Drizzle ORM | Přijato |
| [ADR-004](004-better-auth.md) | Better Auth pro identitu a relace | Přijato |
| [ADR-005](005-redis-bullmq-worker.md) | Redis a BullMQ worker | Přijato |
| [ADR-006](006-rest-sse.md) | REST JSON API a bounded polling | Přijato |
| [ADR-007](007-private-object-storage.md) | Soukromé objektové úložiště Railway | Přijato |
| [ADR-008](008-database-published-content-source.md) | Databáze jako zdroj publikovaného obsahu | Přijato |
| [ADR-009](009-service-worker-indexeddb.md) | Service worker a IndexedDB | Přijato |
| [ADR-010](010-eu-railway-region.md) | EU region pro provoz a data | Přijato |
| [ADR-011](011-event-feature-flags.md) | Feature flags Priority A/B po jednotlivých akcích | Přijato |
| [ADR-012](012-multi-event-data-model.md) | Multi-event datový model | Přijato |
| [ADR-013](013-incremental-frontend-architecture.md) | Inkrementální frontendová architektura | Přijato |

## Životní cyklus

- `Navrženo`: rozhodnutí čeká na schválení.
- `Přijato`: rozhodnutí je závazné pro implementaci.
- `Nahrazeno`: nový ADR záznam výslovně odkáže na původní i nahrazující rozhodnutí.
- `Zamítnuto`: varianta se nemá implementovat.

Přijatý záznam se zpětně nepřepisuje tak, aby měnil význam rozhodnutí. Změna
architektury dostane nový ADR a vazbu na nahrazený záznam. Produktové zadání má
při rozporu přednost; dopad se nejprve zaznamená do rozhodovacího logu v
implementačním plánu.

## Zdrojové podklady

- [BYZON 2026 – zadávací dokumentace webové aplikace v1.0](https://docs.google.com/document/d/1xNNuZaluTWvysPVGUeLNRGAZB6JKN7Z0KNIr2RdUp5g/edit), revize `ALtnJHwlTM7HUd2qC1co_s6cz_hQwtjfSgjWmCZUo6W79pbMu4Ko6PiTLZKqIWYoVF50nMCRTqiH-n9leQBGgaXE-AD6uDRScGZ3o91P2P2i`
- [BYZON 2026 – detailní plán agentního vývoje](../../AI_IMPLEMENTATION_PLAN.md)
