# ADR-005: Redis a BullMQ worker

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

E-maily, připomínky, waitlist, exporty, retence a další pomalejší nebo opakovatelné
operace nesmějí blokovat webové requesty. Zpracování musí zvládnout retry,
deduplikaci a více instancí procesu.

## Rozhodnutí

Redis bude sloužit pro fronty, krátkou cache, rate limiting a realtime fan-out.
BullMQ poběží v samostatné dlouho běžící worker službě. Doménová změna vznikne
nejprve transakčně v PostgreSQL spolu s outbox událostí; teprve potom se doručí
do fronty nebo externího provideru.

## Důsledky

- Web a worker lze škálovat a nasazovat odděleně.
- Joby potřebují stabilní deduplication key, omezené retry, backoff a dohledatelný
  dead-letter stav.
- Výpadek Redis může doručení zpozdit, nesmí však ztratit autoritativní změnu.
- Readiness a metriky rozliší stav DB, fronty a degradaci Redis.
- Lokální a produkční připojení se liší pouze konfigurací adaptéru.
- Jednorázové údržbové joby jsou idempotentní a při běhu používají distribuovaný
  zámek, aby je více schedulerů neprovedlo současně.

## Připojovací kontrakt

- Sdílený balík `@byzon/redis` přijímá pouze `redis://`/`rediss://` URL a
  explicitní `family`; výchozí `0` ponechá DNS dual-stack a funguje s Railway
  private networkingem bez připnutí jedné IP rodiny.
- Webový producer/rate-limit profil má bounded connect/command timeout,
  `maxRetriesPerRequest=1`, vypnutou offline queue a neposílá neurčitě staré
  mutace po obnovení spojení. Chráněná mutace při výpadku selže zavřeně.
- BullMQ worker profil nemá command timeout ani limit request retry
  (`maxRetriesPerRequest=null`), aby blocking worker commandy přežily dočasný
  výpadek. BullMQ `keyPrefix` se nesmí nahrazovat ioredis `keyPrefix`.
- Redis používá `maxmemory-policy=noeviction`; autoritativní stav a replay
  nedoručených outbox událostí přesto zůstává v PostgreSQL.
- URL, credentials, raw IP, e-mail, user ID ani device ID se nelogují a
  nevstupují do rate-limit klíče. Subject je environment-keyed HMAC-SHA-256.

## Hranice

Redis není zdroj pravdy pro vstupenky, rezervace, čekací listinu, souhlasy ani
check-in. Produkční e-mail a další externí služby se volí samostatně.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §5.1, §14, §15.2 a `P8-01` až `P8-10`.
