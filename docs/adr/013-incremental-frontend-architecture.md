# ADR-013: Inkrementální frontendová architektura

- Stav: Přijato
- Datum: 15. srpna 2026

## Kontext

Repozitář má funkční Next.js App Router aplikaci, striktní TypeScript, sdílené
Zod kontrakty, tenké typed porty nad nativním `fetch`, vlastní přístupné UI
primitives a účelové IndexedDB adaptéry. Původní plán současně uváděl
Tailwind/shadcn/Radix, React Hook Form, TanStack Query, MSW a Dexie jako plošně
závazný cílový stack, přestože velká část hotového řezu tyto knihovny
nepoužívá. Migrace bez konkrétního produktového přínosu by zvýšila riziko před
termínem akce.

## Rozhodnutí

Fungující architektura repozitáře je baseline:

- Next.js App Router a React Server/Client Components podle potřeby;
- sdílené striktní Zod DTO v `@byzon/domain` a tenké capability-specific porty
  nad nativním `fetch`;
- `@byzon/ui` a CSS Modules/globální tokeny jako současná UI vrstva;
- řízené React formuláře se serverovou revalidací;
- MSW pouze pro development/test HTTP preview, přímý injektovaný port tam, kde
  stejný kontrakt nepotřebuje HTTP simulaci;
- účelové IndexedDB rozhraní s explicitní ownership/revocation politikou.

Tailwind, shadcn/Radix, React Hook Form, TanStack Query ani Dexie nejsou povinné
závislosti. Kteroukoli z nich lze zavést jen v samostatném úkolu s konkrétní
potřebou, omezeným migračním rozsahem, bundle/UX dopadem a regresními testy.
Existující řezy se migrují pouze při dotyku, pokud je doložen přínos.

Adresář `src/modules` není mechanická release gate. Nové capability mohou být
vertikálně seskupené, ale současné `app`/`components`/`lib`/`server` se plošně
nepřesouvají. Závazné jsou dependency hranice, nikoli název adresáře.

## Důsledky

- Před akcí nevznikne plošný UI/data-stack rewrite.
- CI dál vynucuje zákaz server/DB importů v klientských kontraktech a zákaz
  mock/fixture závislostí v produkčním grafu.
- Nová knihovna musí odstranit konkrétní složitost nebo riziko; samotná shoda s
  dřívější tabulkou plánu není důvod.
- Přesné verze zůstávají zamčené v `pnpm-lock.yaml`.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): `P0-12`, §6 a §7.6.
- [ADR-002](002-nextjs-react-typescript.md), [ADR-009](009-service-worker-indexeddb.md).
