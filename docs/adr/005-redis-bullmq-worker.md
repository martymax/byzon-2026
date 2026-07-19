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

## Hranice

Redis není zdroj pravdy pro vstupenky, rezervace, čekací listinu, souhlasy ani
check-in. Produkční e-mail a další externí služby se volí samostatně.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §5.1, §14, §15.2 a `P8-01` až `P8-10`.
