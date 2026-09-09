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

Na stagingu zůstává zachované přímé přihlášení e-mailem pro testování.
Změna nevyžaduje databázovou migraci ani úpravu konfigurace.

Ověření zahrnuje integrační testy skutečného vydání a expirace tokenů,
obnovu a opakované odeslání pozvánky, audit, bezpečné opakování nejistého
požadavku a komponentové testy ve třech velikostech obrazovky včetně axe.
