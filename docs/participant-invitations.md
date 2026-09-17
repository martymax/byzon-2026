# Pozvánky účastníků a obnova aktivace

V administraci `/admin/ucastnici` je u každého účastníka rychlá akce
**Odeslat pozvánku**, po předchozím odeslání **Odeslat pozvánku znovu**.
Je dostupná v tabulce i mobilních kartách. Vyžaduje oprávnění
`ticket:any:manage`, nearchivovanou akci a aktivní přístup účastníka.
Odeslání nevyžaduje otevření detailu ani potvrzovací dialog.

Každé nové odeslání vydá nový jednorázový token s platností **24 hodin**
od jeho vytvoření. Předchozí token se neprodlužuje ani znovu neaktivuje;
dosud nevyužité odkazy mají vlastní původní expiraci. Odesílání používá
existující API pozvánek, kontrolu přístupu, audit a limity požadavků.
Během odesílání je tlačítko zablokované. Po nejistém výsledku klient
opakuje stejný požadavek se stejným idempotency klíčem; po potvrzeném
úspěchu další kliknutí vytvoří nové odeslání.

Prošlý nebo použitý odkaz otevře formulář obnovy na
`/prihlaseni?mode=recovery&returnTo=%2Fapp`. Účastník zadá e-mail z pozvánky
a zvolí **Poslat nový odkaz**. Neaktivovaný účet dostane aktivační odkaz
na nových 24 hodin; aktivovaný účet přihlašovací odkaz na 30 minut.
Obnova zachovává bezpečně povolený cíl přihlášení. Potvrzení obsahuje
také možnost **Vyžádat další odkaz**. E-mail se neukládá do URL ani
úložiště prohlížeče a odpověď neodhaluje existenci účtu.

Ověření zahrnuje integrační testy skutečného vydání a expirace tokenů,
obnovu a opakované odeslání pozvánky, audit, bezpečné opakování nejistého
požadavku a komponentové testy ve třech velikostech obrazovky včetně axe.

## Hromadné pozvánky na pozadí

Položka hlavního menu **Pozvánky** (`/admin/pozvanky`) nabízí filtry podle rolí,
stavu a jména, jednotlivá zaškrtávátka a kontrolu konkrétních adresátů před
odesláním. Jeden výběr může obsahovat až 5 000 různých uživatelů.

Potvrzení zavolá jediný `POST /api/v1/admin/events/:eventId/invitations/batches`.
Transakce uloží dávku a její příjemce do PostgreSQL; odpověď `202` potvrzuje
**zařazení**, nikoliv doručení. Stránku lze poté zavřít. Stejný idempotency klíč
po dobu sedmi dnů vrací původní výsledek. Souběžné dávky nemohou zařadit téhož
příjemce, dokud má nedokončenou pozvánku. Již dříve odeslané pozvánky lze
záměrně poslat znovu po potvrzení nového výběru.

Worker zpracovává frontu nezávisle na webu, standardně dvě pozvánky současně.
Před odesláním znovu ověřuje členství, role, účastnický přístup, požadavky na
výmaz a stav akce. Odkaz vzniká až při prvním pokusu, platí 24 hodin a během
opakování zůstává stejný. Worker ukládá pouze hash tokenu; archiv e-mailů
obsahuje neškodnou náhradu přihlašovacího odkazu. Stávající návody podle rolí,
oslovení a audit odeslaných pozvánek zůstávají zachované.

Dočasné chyby se opakují nejvýše osmkrát s prodlužující se prodlevou
30 sekund až 30 minut. Nedokončená úloha po pádu workeru se převezme po
vypršení dvouminutového zámku. Fronta starší 24 hodin skončí chybou, aby se
staré nevyřízené dávky nerozeslaly neočekávaně mnohem později.

`GET` na stejném endpointu vrací průběh aktivních a posledních dávek, včetně
počtů odeslaných, čekajících, neúspěšných a přeskočených položek. UI jej
obnovuje každých pět sekund a obnoví přehled i po návratu na stránku.
**Vybrat neúspěšné** připraví pouze příjemce s definitivní chybou pro nový,
opět výslovně potvrzený pokus. Jednotlivá chyba nezastaví ostatní příjemce.

SMTP neposkytuje transakci společnou s databází. Stabilní Message-ID a archiv
potvrzených odeslání chrání běžné opakování; při pádu přesně mezi přijetím
zprávy SMTP serverem a uložením potvrzení nelze zcela vyloučit duplicitní
zprávu. Retry používá tentýž přihlašovací odkaz a již použitý token neobnoví.

Nasazení vyžaduje migraci `0034_invitation_queue` a `BETTER_AUTH_SECRET` ve
workeru (reference na stejnou proměnnou webu). Není potřeba nová služba ani
aktivní prohlížeč. Automatické testy zahrnují 225 adresátů, souběžné požadavky,
restart, opakování SMTP chyb, změnu oprávnění a skutečné přihlášení přes Better
Auth. Hromadné rozesílání používejte z centrální položky **Pozvánky**.
