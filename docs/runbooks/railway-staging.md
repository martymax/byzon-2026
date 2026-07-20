# Railway staging skeleton

Etapa 1 připravuje konfiguraci, neautorizuje produkční deployment ani přenos osobních údajů.

## Služby

1. Založte prostředí `staging` a služby `byzon-app-web` a `byzon-app-worker` v jednom schváleném EU regionu.
2. Obě služby připojte ke stejné větvi `staging`, root directory ponechte `/`.
3. Webu nastavte config path `/railway.web.json`, workeru `/railway.worker.json`.
4. Nastavte nesekretní proměnné z `.env.example`; `APP_ENV=staging`, `APP_BASE_URL` na staging doménu a `RELEASE_SHA` na Railway commit SHA.
5. Ověřte `GET /health/live`, `GET /health/ready`, start workeru a že změna pouze veřejného statického webu nespustí tyto služby.

Databáze, Redis, bucket a produkční PII se připojí až v příslušných etapách a po uzavření `BLOCKER-INFRA-01`.
