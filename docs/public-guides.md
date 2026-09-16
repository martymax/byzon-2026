# Veřejné návody a pozvánky

Rozcestník: <https://app.byzon.cz/navody>. Návody jsou statické veřejné
stránky, nezávislé na přihlášení, onboardingu a databázi. Neobsahují seznamy
účastníků ani data konkrétní akce. Přístup k pracovním nástrojům nadále
ověřuje aplikace.

| Role             | Veřejná cesta                 |
| ---------------- | ----------------------------- |
| participant      | `/navody/ucastnik`            |
| moderator        | `/navody/moderator`           |
| speaker          | `/navody/recnik`              |
| room_operator    | `/navody/vedouci-aktivity`    |
| organizer_admin  | `/navody/administrator`       |
| checkin_operator | `/navody/organizacni-podpora` |

Návod organizační podpory výslovně uvádí, že kontrola vstupenek a check-in
jsou pro rok 2026 vypnuté. Technická role `system_worker` nemá lidský návod.

## Obsah a odkazy

Katalog stabilních cest je v `packages/mail/src/guides.ts` a přes lehký
export `@byzon/mail/guides` ho sdílí aplikace a e-maily. Texty a postupy jsou
v `apps/conference/src/lib/public-guides.ts`. Stránky sestavuje
`apps/conference/src/app/navody/`. Při změně pracovního postupu upravte i
odpovídající návod; URL neměňte bez zachování přesměrování starých pozvánek.

Odkazy jsou v hlavičce veřejné aplikace, účastnické nápovědě, nástrojích
řečníka/moderátora, přehledu aktivit a administraci. Ve správě pozvánek jsou
názvy rolí odkazy na náhled příslušných návodů.

## Odesílání

Při pozvánce nebo aktivaci načítá auth mail callback aktuální neodvolané
role z DB pro aktivní členství v konkrétní akci. Vstupní metadata neurčují
role. Kombinace rolí znamená více odkazů v jednom e-mailu; neznámé role se
ignorují. Bez známé role nabídne týmová pozvánka rozcestník. Běžné opakované
přihlášení návodový blok neobsahuje.

HTML i textová varianta obsahují stejné veřejné URL bez tokenů a osobních
údajů. Role se předávají i do redigovaného archivu e-mailů, aby historie
zachovala skutečný výběr návodů. Týmové pozvánky používají `/po-prihlaseni`,
které volí administraci nebo účastnickou aplikaci podle skutečného přístupu.

Nasazení nic zpětně nerozesílá. Novou šablonu používají až nově odeslané
pozvánky včetně opakovaného odeslání. Veřejné návody lze otevřít samostatně
i ze starých či již použitých pozvánek po zaslání veřejné URL organizátorem.

## Ověření

- Testy katalogu a šablon: `pnpm --filter @byzon/mail test`.
- Test veřejných stránek: `src/app/navody/page.test.tsx`.
- Auth integrační test ověřuje výběr rolí v konkrétní akci, ignorování
  podstrčených metadat a odvolaných rolí.
- `tests/e2e/public-guides.spec.ts` ověřuje anonymní přístup, neplatnou
  session, odkazy, neznámou roli, WCAG A/AA a šířku stránky.
- `pnpm preview:emails` generuje HTML a textové náhledy včetně šesti
  samostatných rolí. `node scripts/check-email-preview.mjs` kontroluje jejich
  zobrazení s assety i bez nich.
