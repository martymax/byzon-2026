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
