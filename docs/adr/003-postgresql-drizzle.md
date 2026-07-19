# ADR-003: PostgreSQL a Drizzle ORM

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

Aktivace vstupenek, kapacity rezervací a check-in mají kritické invarianty a
souběžné zápisy. Stav musí být transakční, auditovatelný a chráněný databázovými
omezeními; cache ani fronta tuto roli nemohou převzít.

## Rozhodnutí

PostgreSQL je jediný autoritativní zdroj transakčního stavu. Aplikace použije
`pg`, Drizzle ORM a Drizzle Kit. Schéma, indexy a constraints budou explicitní a
každá změna databáze dostane verzovanou SQL migraci v repozitáři.

Kritické operace použijí databázovou transakci a vhodný row nebo advisory lock.
Migrace budou postupovat dopředně kompatibilním expand–contract postupem.

## Důsledky

- Invarianty se vynucují i při více instancích webu a workeru.
- Integrační a race testy běží proti skutečnému PostgreSQL.
- Redis může urychlit čtení nebo doručení, ale jeho ztráta nesmí změnit pravdu v DB.
- Rollback aplikace musí po přechodnou dobu rozumět novému schématu; destruktivní
  down migrace není produkční rollback.

## Hranice

Drizzle entity se neposílají přímo klientovi. API vrací explicitní, minimální DTO.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §7.9, §9, §10 a `P2-01` až `P2-03`.
