# ADR-014: Automatický FIFO waitlist a seskupené rezervace

- Stav: Přijato
- Datum: 30. srpna 2026

## Kontext

Rezervační základ podporuje stabilní FIFO pořadí, ale produkční integrace dosud
čekala na volbu mezi automatickým potvrzením a časově omezenou nabídkou. U
pátečního řízeného networkingu současně chyběla číselná kapacita a pravidlo
storna. Dvě programové části sobotního mastermindu Tomáše Ryzy neměly potvrzeno,
zda sdílejí jednu rezervaci.

Kapacita aktivity už je samostatné auditované session-level provozní nastavení v
administraci a nesmí být konstantou v aplikačním kódu.

## Rozhodnutí

- Každý zapnutý pořadník používá stabilní FIFO s automatickým potvrzením. Po
  uvolnění místa se v téže autoritativní databázové transakci potvrdí první
  aktivně čekající účastník. Produkční doména nebude obsahovat nabídku,
  expiraci, TTL ani accept/decline větev.
- Páteční řízený networking je běžná rezervovatelná session. Nemá hardcoded ani
  automaticky odhadnutou kapacitu: organizátor musí před otevřením rezervací
  nastavit kladnou kapacitu v administraci. Do té doby je rezervace fail-closed.
  Storno je možné do publikovaného začátku aktivity a zapnutý pořadník používá
  stejný automatický FIFO režim.
- Obě programové části sobotního mastermindu Tomáše Ryzy tvoří jednu
  rezervační skupinu se sdílenou kapacitou 6, jedním stavem rezervace, jedním
  pořadníkem a jedním rosterem. Program zůstává ve dvou časových projekcích;
  účastník rezervuje nebo ruší skupinu pouze jednou.

## Důsledky

- Uvolněná kapacita nezůstává kvůli čekání na potvrzení nevyužitá.
- Promotion nemá časový worker ani e-mail jako podmínku správnosti. E-mail lze
  doručit asynchronně z outboxu, PostgreSQL ale zůstává zdrojem pravdy.
- Participant, admin storno, ticket transition a zvýšení kapacity musí sdílet
  stejnou idempotentní promotion primitivu a session/group lock.
- Snížení kapacity pod počet potvrzených rezervací zůstává zakázané.
- Neúplně nakonfigurovaný networking se nepublikuje jako rezervovatelný a
  nevytváří `registration_estimate`.

## Hranice

- Rozhodnutí nemění dobrovolný networkingový adresář Priority B.
- Kapacita 6 je počáteční administrátorská hodnota sobotního mastermindu, ne
  konstanta v business logice; organizátor ji může auditovaně změnit.
- Automatická promotion po cutoffu nesmí obejít publikované rezervační okno.
  Uvolnění místa po začátku aktivity proto nikoho nově nepotvrdí.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): `SCOPE-2026-08`,
  `P5-04`, `P5-07`, `BLOCKER-RES-01`, `BLOCKER-RES-04` a
  `BLOCKER-RES-05`.
