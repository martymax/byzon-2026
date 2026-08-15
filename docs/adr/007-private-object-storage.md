# ADR-007: Soukromé objektové úložiště Railway

- Stav: Přijato
- Datum: 20. července 2026; scope amendment 15. srpna 2026

## Kontext

Importy, schválené neveřejné obrázky, dočasné organizační exporty a zálohy
mohou obsahovat osobní nebo provozně citlivá data. Veřejné a trvalé bucket URL by obcházely serverovou
autorizaci a retenční pravidla.

## Rozhodnutí

Produkce použije privátní Railway Storage Bucket ve stejném schváleném regionu
jako ostatní data. Metadata, vlastnictví, účel, checksum a stav souboru budou v
PostgreSQL. Klient získá jen krátkodobý, účelově omezený presigned request/URL
nebo autorizovaný serverový proxy endpoint.

Upload key určuje server. Soubor zůstane v karanténě do ověření velikosti,
checksumu, skutečného MIME a schválené bezpečnostní kontroly.

## Důsledky

- Bucket není veřejný CDN ani autorizační databáze.
- Každé prostředí má oddělený bucket a credentials.
- Download a exporty podléhají serverové autorizaci, expiraci a auditu.
- Speaker portál ani podklady řečníků se pro ročník 2026 neukládají. Partner z
  úložiště nezíská kontakty účastníků ani zvláštní přístup.
- Lokální vývoj používá adapter za stejným `ObjectStorage` rozhraním.
- Retenci provádí idempotentní aplikační job, který objekty explicitně smaže;
  bucket lifecycle nelze předpokládat.
- Šifrované databázové zálohy mají oddělené privátní umístění. Aplikační bucket
  nesmí být jejich jediným cílem ani jediným mechanismem obnovy.

## Hranice

Konkrétní malware scanner a externí zpracovatel se nesmí zapnout pro produkční
data bez právního a bezpečnostního schválení. Před produkčním provisioningem se
v `BLOCKER-INFRA-01` ověří DPA, region, model šifrování, mazání, zálohy a obnovu.
Dokumentace Railway k 20. červenci 2026 neumožňuje spoléhat na S3 server-side
encryption controls, object versioning, object locks ani bucket lifecycle.
Citlivé exporty a zálohy se proto šifrují před uploadem.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): `SCOPE-2026-03`, §15.3, §16.2, §19.2 a `BLOCKER-INFRA-01`.
- [Railway – Storage Buckets](https://docs.railway.com/storage-buckets).
