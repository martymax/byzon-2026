# Testování časově omezených funkcí

V účastnické aplikaci otevřete **Účet → Nastavení a přihlášení** (`/app/nastaveni`) a zvolte **Zapnout testovací režim**. Odkaz je také v administrátorském pruhu nad účastnickými stránkami. Po uložení se stránka obnoví. Hodnocení je na `/app/hodnoceni`.

Přepínač je dostupný jen aktivnímu administrátorovi (`organizer_admin`). Platí pro konkrétní událost, účet a přihlášení v prohlížeči. HttpOnly cookie má platnost 8 hodin; jiný účet nebo nové přihlášení ji nemůže použít. Vypíná se stejným tlačítkem. Globální proměnná `BYZON_TIMELESS_TEST_MODE` není potřebná a nic neaktivuje.

Režim zpřístupňuje:

- hodnocení konference a přednášek před jejich koncem, včetně budoucích položek publikovaného programu v dotazníku;
- rezervace a čekací listinu před otevřením i po uzavření časového okna, zrušení vlastní rezervace po začátku a změny agendy po skončení akce;
- sběr dotazů po uplynutí obvyklých 30 minut od konce;
- přístup přiřazeného řečníka k písemným odpovědím před skončením přednášky a před přepnutím akce do stavu live.

Oprávnění se stále ověřují na serveru při každém požadavku. Pro účastnické funkce účet potřebuje účastnickou roli, pro řečnické funkce také propojení řečníka a přiřazenou přednášku. Režim neobchází vypnuté funkce, nepublikovaný/zrušený program, archivaci, anonymizaci, kapacitu, konflikty rezervací, limity ani jednorázové odeslání hodnocení. Automatické procesy a čekací listiny ostatních účastníků běží v reálném čase.

**Nejde o simulaci. Odeslané dotazníky, otázky a rezervace se ukládají do běžných dat.** Rezervace může obsadit skutečné místo. Pro hodnocení používejte vyhrazený účastnický účet s administrátorskou rolí a neposílejte zkušební odpovědi z účtu určeného k finálnímu hodnocení. Přepínač již odeslané hodnocení nemaže.

Implementace používá ověřenou session, databázovou kontrolu aktivního členství a neodvolané role a cookie odvozenou z aktuální přihlašovací cookie. Mutace nastavení vyžaduje stejný origin a striktní JSON s booleanem `enabled`; odpovědi mají `private, no-store`. Po změně se zneplatní soukromé prostředky klienta a obnoví stránka. Reálný čas zůstává zachován pro časová razítka, expirace přihlášení, idempotenci i audit.
