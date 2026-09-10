# QR kódy bodů programu

V administraci **Program a obsah → Body programu** otevřete požadovaný QR náhled u zveřejněné položky. Vyberte PNG pro prezentaci (1024 × 1024 px, bílé pozadí) nebo SVG pro tisk a grafiku a stáhněte požadovanou variantu:

- **Program** otevře detail bodu programu.
- **Q&A** otevře formulář dotazu pro daný bod.
- **Hodnocení** otevře samostatnou stránku hodnocení přednášky.

Nad seznamem jsou hromadné exporty QR programu, Q&A a hodnocení ve formátu PNG. Každá varianta se stáhne jako ZIP s obrázky a souborem `manifest.json`, který přiřazuje název bodu, odkaz a soubor. Název obrázku rozlišuje Q&A a hodnocení.

QR se generují z poslední zveřejněné verze programu. Zrušené body se vynechávají. Q&A se nabízí pro body podporující moderované dotazy (`questionMode=moderated_follow_up`) a lze jej připravit i před otevřením sběru. Koučink se do hodnocení nezahrnuje.

Účastník se po přihlášení vrátí na stránku otevřenou QR kódem. Hodnocení se otevře až po plánovaném konci přednášky; při dřívějším načtení stránka vyčká a automaticky ověří dostupnost. Odeslané hodnocení zobrazí potvrzení. Platí stávající přístupová pravidla a nastavení hodnocení akce.

## API

Stávající chráněné GET endpointy podporují parametry `target=program|questions|rating` a `format=svg|png`:

- `/api/v1/admin/events/:eventId/session-qr/:sessionId` — jeden obrázek.
- `/api/v1/admin/events/:eventId/session-qr` — ZIP dané varianty.

Bez parametrů zůstává původní programový SVG export. Oprávnění je `program:manage`. Odkazy neobsahují přístupové údaje.
