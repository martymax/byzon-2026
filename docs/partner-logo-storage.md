# Loga partnerů a fotografie řečníků na Railway Volume

Implementace používá persistentní disk připojený k webové službě `conference`.
Backend pro fotografie je společný s logy partnerů. S3 bucket ani přístupové klíče
nejsou pro tyto obrázky potřeba.

## Nasazení

1. K **webové službě** v příslušném Railway prostředí připojte Volume, například
   s mount path `/data`. Nepřipojujte tento disk k workeru.
2. Railway automaticky nastaví `RAILWAY_VOLUME_MOUNT_PATH=/data`. Aplikace ukládá
   soubory do `/data/byzon-assets/content-images/<eventId>/<assetId>.webp`.
   Volitelná proměnná `ASSET_STORAGE_PATH` nastaví jinou **absolutní** kořenovou
   cestu; v produkci musí ležet na připojeném persistentním disku.
3. Nasaďte tuto verzi aplikace. Existující Railway pre-deploy příkaz provede
   migraci `0029_faulty_steel_serpent`, která přidává alternativní popis a rozměry
   do metadat obrázků. Migrace nečte ani nezapisuje volume.
4. V administraci otevřete **Obsah → Partneři → Upravit**, vyberte soubor,
   doplňte alternativní popis a klikněte na **Nahrát obrázek**. Zobrazí se náhled
   a tlačítko **Stáhnout logo**. Výměna a odebrání obrázku se ukládají samostatně;
   změny ostatních polí potvrďte tlačítkem **Uložit změny**.
5. Použijte kontrolu a zveřejnění obsahu, aby se nové logo zobrazilo návštěvníkům.
   Ověřte také opětovné načtení detailu a stažení po restartu služby.

Railway poskytuje mount až za běhu, nikoli při buildu nebo pre-deploy.
Volume se váže k jedné službě a nepodporuje repliky. Každé prostředí musí mít
vlastní volume. Pro obnovu ukládejte zálohy volume společně s odpovídající
PostgreSQL databází. [Dokumentace Railway](https://docs.railway.com/volumes),
[omezení volumes](https://docs.railway.com/volumes/reference).

Lokálně nastavte například `ASSET_STORAGE_PATH=/tmp/byzon-dev-assets`.
Bez explicitní cesty nebo Railway volume aplikace nahrávání odmítne; soubory
se tiše neukládají do dočasného filesystému kontejneru.

## Chování a API

- Nové logo: JPEG, PNG, WebP do 3 MiB; fotografie řečníka do 5 MiB.
  Server kontroluje skutečný formát a dekódování, omezuje vstup na 25 megapixelů,
  odmítá animace a převádí obraz do WebP do 2400 × 2400 pixelů s odstraněním
  metadat. Stažení vrací tento uložený WebP. Importovaná loga zachovávají svůj
  původní formát, včetně SVG.
- `GET /api/v1/admin/events/:eventId/content-assets/:resource/:id` vrací popis
  obrázku a krátkodobou adresu náhledu. `resource` je `partners` nebo `speakers`.
  Náhled i stažení znovu ověřují aktuální přihlášení a `program:manage`.
- `PUT` přijímá multipart `file`, `altText` a `If-Match` s verzí partnera/řečníka.
  `DELETE ?assetId=…` odebere přiřazení se stejnou kontrolou verze.
  `GET ?file=download&assetId=…` vrací přílohu a zapisuje audit stažení.
- Zápisy kontrolují Origin a oprávnění, nepovolují archivovaný obsah, používají
  společný zámek s publikováním a atomicky zapisují metadata, novou verzi obsahu
  i audit. Cestu souboru určuje server. Redis omezuje čtení na 120 a mutace na
  20 požadavků za minutu na uživatele a akci; při výpadku limiteru se operace
  odmítne.
- Administrátorské odpovědi mají `private, no-store`. Nový obrázek není veřejný
  do publikování. Starší obrázky zůstávají na disku kvůli neměnným verzím
  publikovaného obsahu; odebrání v editoru odpojí obrázek od konceptu.
- Opakovaný import statického zdroje zachovává obrázky ručně vyměněné nebo
  odebrané v administraci. Audit identifikuje tato přiřazení.
- Typový export připnuté knihovny Sharp 0.35.0 doplňuje lokální pnpm patch;
  runtime knihovny se nemění.

Lokální ověření zahrnuje PostgreSQL migraci, fyzický zápis/čtení souborů,
stažení, izolaci oprávnění, souběžné uploady, publikování a browser component
scénáře.

Dne 8. 9. 2026 bylo ve staging prostředí projektu `Byzon 2026` k existující
webové službě `@byzon/conference` připojeno volume `@byzon/conference-volume`
(`2af1adeb-bca9-4791-9e5a-74c35f114b9b`) na `/data`. Nasazení probíhá
přes sledovanou větev `stage/participant-access-live-qa`.
