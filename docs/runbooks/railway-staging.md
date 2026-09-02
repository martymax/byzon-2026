# Railway prostředí

Autoritativní staging aplikace je
`https://byzonconference-staging.up.railway.app`. Projekt `Byzon 2026` používá
prostředí `staging` a existující služby `@byzon/conference`,
`@byzon/worker`, `Postgres` a `Redis`. Nevytvářejte jejich duplicitní kopie.

Cílová produkční doména je `https://app.byzon.cz`; DNS/proxy připojení se
provede přes Cloudflare až po staging UAT. Railway je produkční platforma,
nikoli dočasný hosting.

## Produkční klon 2026

Dne 31. 8. 2026 vzniklo nové Railway prostředí `production-2026` jako nativní
duplikát `staging`. Původní prostředí `production` už v projektu existovalo a
nebylo změněno ani odstraněno. Do rozhodnutí o jeho archivaci používejte
výhradně explicitní název prostředí, ne nejednoznačné označení „production“.

- web: `https://byzonconference-production-2026.up.railway.app`
- worker: `https://byzonworker-production-2026.up.railway.app`
- služby: `@byzon/conference`, `@byzon/worker`, vlastní `Postgres` a vlastní
  `Redis`
- runtime: `APP_ENV=production`, `PUBLIC_SITE_URL=https://byzon.cz` a
  `APP_BASE_URL` nastavené na generickou produkční Railway doménu
- release webu i workeru: `9ddeec7d4adeb351fc3e77ac595468f630e883b3`

Duplikace prostředí nekopíruje obsah databázového volume. Produkční databáze
proto dostala idempotentní baseline seed a kanonický import repozitářového
obsahu: 82 sessions, 24 řečníků, 10 partnerů, 35 assetů a 1 praktickou stránku.
Nevznikl žádný uživatel a ze stagingu se nekopírovaly osobní údaje. Importovaný
obsah zůstává draftem; publikaci musí po přidání prvního produkčního organizer
admina provést oprávněný uživatel přes auditovaný publish flow.

Klon dočasně převzal také stagingové aplikační secrets. Dne 31. 8. 2026 byly ve
webové službě `production-2026` před prvním skutečným uživatelem atomicky
nahrazené samostatnými náhodnými `BETTER_AUTH_SECRET` a
`RATE_LIMIT_SUBJECT_SECRET`; kontrola potvrdila, že už se stagingem nejsou
shodné. E-mailové proměnné zůstávají na inertním sentinelu
`__FILL_IN_RAILWAY__`; invitation batch se do jejich nahrazení a ověření domény
nesmí spustit.

## Služby a deployment

1. Každý dokončený funkční celek nejprve projde testy, dostane samostatný Git
   commit a odešle se do vzdáleného repozitáře. Staging se standardně nasazuje
   pouze přes Git integraci z větve `main`; `railway up` se pro běžné nasazení
   nepoužívá. CLI slouží k read-only diagnostice. Ruční deploy je výjimečný
   recovery krok, který musí být předem výslovně schválený a zdokumentovaný.
2. Web používá `/railway.web.json`, worker `/railway.worker.json`; obě služby
   sledují větev `main`.
3. Web jako jediný spouští pre-deploy migrace. Ve staging prostředí po
   migraci spustí idempotentní seed a import kanonického obsahu z
   `static-site/data/content.json`. Worker migrace nespouští.
4. Web a worker sdílejí privátní reference na stejné staging PostgreSQL a
   Redis. Produkční a staging data ani credentials se nesmí sdílet.
5. Check-in služba, zařízení, manifest ani `CHECKIN_DEVICE_ID` se pro rok
   2026 neprovisionují.
6. Po deployi ověřte `GET /health/live`, `GET /health/ready`, start workeru bez
   restart loopu a aktuální release SHA.

Oznámení jsou pro event `byzon-2026` zapnutá migrací
`0023_enable_byzon_announcements`. Seed stejnou hodnotu idempotentně zachovává
na stagingu a současně nechává `byzon-isolation-test` vypnutý. Zapnutí flagu
nemění klientskou navigaci; v tomto kroku se ověřuje pouze dostupnost
administračního announcement flow a serverových endpointů.

## Proměnné webu

| Proměnná                    | Staging hodnota / zdroj                            |
| --------------------------- | -------------------------------------------------- |
| `NODE_ENV`                  | `production`                                       |
| `APP_ENV`                   | `staging`                                          |
| `APP_BASE_URL`              | `https://byzonconference-staging.up.railway.app`   |
| `PUBLIC_SITE_URL`           | `https://byzon.cz`                                 |
| `DATABASE_URL`              | private reference na `Postgres.DATABASE_URL`       |
| `REDIS_URL`                 | private reference na `Redis.REDIS_URL`             |
| `REDIS_FAMILY`              | `0`                                                |
| `REDIS_CONNECT_TIMEOUT_MS`  | `3000`                                             |
| `REDIS_COMMAND_TIMEOUT_MS`  | `2000`                                             |
| `BETTER_AUTH_SECRET`        | samostatný staging secret, minimálně 32 znaků      |
| `RATE_LIMIT_SUBJECT_SECRET` | jiný samostatný staging secret, minimálně 32 znaků |
| `SIMPLESHOP_API_EMAIL`      | existující server-only staging secret              |
| `SIMPLESHOP_API_KEY`        | existující server-only staging secret              |
| `RELEASE_SHA`               | Railway commit SHA                                 |

## Proměnné workeru

Worker potřebuje stejné `NODE_ENV`, `APP_ENV`, `APP_BASE_URL`,
`PUBLIC_SITE_URL`, `DATABASE_URL`, `REDIS_URL`, `REDIS_FAMILY`,
`REDIS_CONNECT_TIMEOUT_MS` a `RELEASE_SHA`. Dále používá
`WORKER_CONCURRENCY_EMAIL` a `WORKER_CONCURRENCY_DEFAULT`, jakmile budou
explicitně nastavené; do té doby platí validované serverové defaulty.

## E-mailové placeholders a magic link

Web má připravený skutečný Resend adapter pro Better Auth magic link. Jeho
produkční aktivace stále vyžaduje schválení zpracovatele, environment-specific
API klíč a ověřenou odesílací doménu. Railway CLI nepovoluje nulovou délku
hodnoty, proto jsou ve webu i workeru připravené placeholders s inertní hodnotou
`__FILL_IN_RAILWAY__`. Aplikace je nesmí číst ani považovat za aktivní
konfiguraci, dokud nejsou vyplněné všechny povinné hodnoty:

- `MAIL_PROVIDER`
- `MAIL_API_KEY` (secret)
- `MAIL_FROM`
- `MAIL_REPLY_TO`

Sentinel znamená výhradně „čeká na doplnění“, nikoli povolení odesílání. Po
doplnění se musí web i worker restartovat a validace musí odmítnout sentinel i
částečně vyplněnou konfiguraci.

Pro web nastavte celou sadu atomicky:

```text
MAIL_PROVIDER=resend
MAIL_API_KEY=<environment-specific Resend secret>
MAIL_FROM=BYZON <prihlaseni@overena-odesilaci-domena>
MAIL_REPLY_TO=<organizacni podpora>
```

Staging ani produkce nesmí použít vestavěný in-memory `sink`; ten je povolený
jen v dev/test. Neúplná staging/produkční konfigurace failne zavřeně a magic
link neodešle. `/` i `/prihlaseni` posílají požadavek přímo do Better Auth,
nepoužívají ticketovou aktivaci a neznámá identita se sama nevytvoří.

První aktivace neověřeného, předem provisionovaného účtu a pozvánky účastníků
i členů týmu mají platnost 24 hodin. Pokud odkaz vyprší nebo už byl použit,
uživatel na `/prihlaseni` zadá stejný e-mail a bezpečně si vyžádá nový;
odpověď nesmí prozradit existenci účtu. U již aktivovaného účtu má nový
přihlašovací odkaz platnost 30 minut. Všechny odkazy jsou jednorázové.

Staging používá samostatnou Railway službu `mailpit` na připnutém image
`axllent/mailpit:v1.31.0`. Zprávy se zachytávají do volume `/data`, po sedmi
dnech expirují a nikam se nepřeposílají. Web posílá přes chráněné privátní API
`http://mailpit.railway.internal:8025`; veřejné UI
`https://mailpit-staging-3138.up.railway.app` vyžaduje Basic Auth uložený v
`MP_UI_AUTH` u služby `mailpit`. Credential se nesmí kopírovat do aplikace ani
do repozitáře.

Webová staging konfigurace:

```text
MAIL_PROVIDER=mailpit
MAILPIT_API_URL=http://mailpit.railway.internal:8025
MAILPIT_API_USERNAME=byzon
MAILPIT_API_PASSWORD=<hodnota odpovídající MP_SEND_API_AUTH>
MAIL_FROM=login@app.byzon.cz
MAIL_REPLY_TO=<organizacni podpora>
```

`mailpit` je schématem výslovně povolen pouze pro `APP_ENV=staging`; produkční
start s touto hodnotou selže. Pro produkci dál platí následující Resend sada.

Před produkční invitation batchí musí odesílací doména projít SPF, DKIM,
DMARC a deliverability smoke. Staging do té doby používá pouze bezpečný
providerový testovací režim nebo schválené syntetické adresy; nesmí odesílat
skutečným účastníkům.

První organizer admin se provisionuje teprve po potvrzení přesné e-mailové
adresy. Pro cílové prostředí spusťte:

```bash
DATABASE_URL="$DATABASE_URL" \
  pnpm --filter @byzon/database db:bootstrap-admin \
  --event-slug byzon-2026 \
  --user-email organizer@example.com \
  --create-user
```

Příkaz vytvoří neověřenou passwordless identitu, aktivní event membership a
event-scoped `organizer_admin`. První úspěšně otevřený magic link e-mail ověří;
opakované spuštění je no-op a role grant se auditovaně zapisuje bez e-mailu.

## Redis a databáze

- `Postgres` a `Redis` musí být ve stejném schváleném EU regionu jako web
  a worker. Veřejné databázové URL nepatří do aplikace ani logů.
- Redis zůstává `noeviction`. Výpadek nesmí poškodit PostgreSQL; readiness
  jej smí hlásit jako degradaci, chráněné mutace failují podle své politiky.
- Staging seed i import obsahu jsou idempotentní. Import zapisuje pouze draft a
  zveřejnění nové verze zůstává samostatným auditovaným krokem organizátora.
  Produkční osobní data se do stagingu nekopírují.

## Ověření releasu

1. Otevřete `/health/live` a `/health/ready`; readiness musí vrátit `200` a
   databázi/Redis bez secret URL.
2. Přihlaste se administrátorskou staging identitou a ověřte
   `/admin/interakce`: default-off flags, výběr přednášky a maskovaný výběr
   moderátora.
3. Otestujte zapnutí a vypnutí networkingu syntetickým účastníkem; bez opt-in
   nesmí být profil zjistitelný, po opt-in se zobrazí všechna vyplněná
   veřejná pole.
4. Otestujte SimpleShop preview a `P4-03` participant apply pouze se
   syntetickými staging identitami. Skutečné pozvánky se nesmí před dokončením
   `P4-06` spustit.

## První provozní ověření 31. 8. 2026

Na `production-2026` proběhly po importu obsahu tyto nedestruktivní kontroly:

- readiness: `200`, prostředí `production`, databáze i Redis `ready`;
- 100 souběžných HTTP kontrol `/health/ready` při concurrency 10: 100/100
  odpovědí `200`, průměr 0,237 s, maximum 1,270 s;
- 100 souběžných HTTP kontrol `/` při concurrency 10: 100/100 odpovědí `200`,
  průměr 0,290 s, maximum 0,584 s;
- `/admin/interakce` vrací `200`, zatímco vyřazené `/check-in` a
  `/api/v1/check-in/context` vracejí `404`;
- custom-format PostgreSQL backup byl obnoven do dočasné databáze a počty se
  shodovaly: 48 tabulek, 20 migrací, 2 eventy a 82 sessions; dočasná databáze
  byla po testu odstraněna.

Jde o technický smoke a první load baseline, nikoli o formální load/UAT gate.
Zbývá klikací role-based UAT s produkčním organizer adminem, potvrzení cílové
zátěže, deploy rollback drill a accessibility/security průchod. Přímé browser
UAT nebylo v tomto běhu možné kvůli chybě lokálního browser-control runtime;
HTTP, databázové a CI kontroly tím nebyly dotčené.
