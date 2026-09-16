# Veřejné návody a pozvánky

Rozcestník: <https://app.byzon.cz/navody>. Návody jsou statické veřejné
stránky, nezávislé na přihlášení, onboardingu a databázi. Neobsahují údaje skutečných
účastníků ani neveřejná data konkrétní akce. Přístup k pracovním nástrojům nadále
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

## Snímky aplikace

Důležité postupy doplňuje šest dvojic skutečných snímků rozhraní: přihlášení,
program, moderování, písemná odpověď řečníka, účastníci aktivity a pozvánky.
Jména, e-maily, program i otázky pocházejí výhradně ze syntetických fixtures;
nejde o údaje skutečných účastníků. Zachyceno při rozšíření návodů v září 2026.

Katalog a alternativní texty: `apps/conference/src/lib/guide-screenshots.ts`.
Přiřazení do kapitol: pole `screenshot` v `public-guides.ts`. WebP soubory:
`apps/conference/public/guides/`. Komponenta `GuideScreenshot` používá na
notebooku přepínač Notebook/Mobil. Do šířky 760 px volí nativní `<picture>`
pouze mobilní soubor, skryje přepínač a vykreslí rám telefonu i bez JavaScriptu.
Snímky se načítají líně a mají odkaz na plné rozlišení.

Obnova snímků vyžaduje sestavený `@byzon/test-support`, Playwright Chromium
a nástroj `cwebp`. Spusťte lokální server:

```sh
BYZON_FRONTEND_PREVIEW=enabled pnpm --filter @byzon/conference exec next dev --port 3100
```

V druhém terminálu spusťte `node scripts/capture-guide-screenshots.mjs`.
Skript má pevnou lokální adresu, nahrazuje API syntetickými odpověďmi a
blokuje mutace; pozvánky ani odpovědi neodesílá. Aktivita používá existující
vývojový náhled serverové stránky. Výstupní rozměry jsou 390 × 844 a
1280 × 800 px. Před publikováním zkontrolujte obě varianty, zejména ořez
pracovních ovládacích prvků při změně layoutu aplikace.

E2E test navíc ověřuje přepínání, změnu velikosti okna, mobilní výběr souboru
bez stažení notebookové varianty a anonymní dostupnost všech 12 obrázků.
