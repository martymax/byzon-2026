# Railway staging skeleton

Etapa 1 připravuje konfiguraci, neautorizuje produkční deployment ani přenos osobních údajů.

## Služby

1. Založte prostředí `staging` a služby `byzon-app-web` a `byzon-app-worker` v jednom schváleném EU regionu.
2. Obě služby připojte ke stejné větvi `staging`, root directory ponechte `/`.
3. Webu nastavte config path `/railway.web.json`, workeru `/railway.worker.json`.
4. Nastavte nesekretní proměnné z `.env.example`; `APP_ENV=staging`, `APP_BASE_URL` na staging doménu a `RELEASE_SHA` na Railway commit SHA.
5. Ověřte `GET /health/live`, `GET /health/ready`, start workeru a že změna pouze veřejného statického webu nespustí tyto služby.

Databáze, Redis, bucket a produkční PII se připojí až v příslušných etapách a po uzavření `BLOCKER-INFRA-01`.

## Etapa 2 – PostgreSQL

Před deployem `P2-03`:

1. Ve staging prostředí přidejte Railway PostgreSQL službu. V aktuálním projektu
   se jmenuje `Postgres`; umístěte ji do stejného schváleného EU regionu jako web
   a worker.
2. V `@byzon/conference` (web) i `@byzon/worker` přidejte reference variable
   `DATABASE_URL` odkazující na privátní `DATABASE_URL` služby `Postgres`.
3. V obou službách nastavte `DATABASE_POOL_MAX=5`,
   `DATABASE_IDLE_TIMEOUT_MS=30000` a `DATABASE_CONNECT_TIMEOUT_MS=5000`.
4. Nezadávejte veřejnou DB URL a nekopírujte produkční osobní údaje.
5. Web config spustí před nasazením migraci; pouze v prostředí pojmenovaném
   přesně `staging` poté spustí idempotentní seed. Worker migrace nespouští.
6. Po deployi ověřte web `GET /health/ready` (`200`,
   `dependencies.database=ready`), worker start bez restart loopu a v DB právě
   eventy `byzon-2026` a `byzon-isolation-test`.

## Etapa 8 – Redis a worker connection

Před staging deployem `P8-01` a až po schválení infrastruktury:

1. Ve stejném schváleném EU regionu přidejte oddělenou Railway Redis službu;
   staging nesmí sdílet instanci ani credentials s produkcí.
2. Webu i workeru nastavte reference `REDIS_URL` na privátní URL služby. URL
   nekopírujte do logu, PR prostředí ani klientského `NEXT_PUBLIC_*` prostoru.
3. Ponechte `REDIS_FAMILY=0`, `REDIS_CONNECT_TIMEOUT_MS=3000` a pro web
   `REDIS_COMMAND_TIMEOUT_MS=2000`; hodnotu family měňte na `4`/`6` pouze po
   síťové diagnostice konkrétního prostředí.
4. Webu vytvořte samostatný minimálně 32bytový `RATE_LIMIT_SUBJECT_SECRET` pro
   dané prostředí. Nepoužívejte Better Auth ani ticket pepper a nesdílejte key
   mezi stagingem a produkcí.
5. Ověřte Redis `maxmemory-policy=noeviction`. Web readiness musí při dostupném
   Redis vrátit `dependencies.redis=ready` a číselnou
   `metrics.redisPingMs`; worker musí zalogovat pouze stav a latenci bez URL.
6. Simulovaný výpadek Redis nesmí poškodit PostgreSQL. Web readiness zůstane
   při zdravé DB `200` se stavem `degraded`, chráněná rate-limit mutace selže
   zavřeně a worker se po obnovení Redis znovu připojí.
