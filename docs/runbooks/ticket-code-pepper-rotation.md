# Rotace pepperu ticketových kódů

Tento postup je infrastrukturní část `P4-01`. Produkční aktivace zůstává vypnutá,
dokud není potvrzen formát a entropie kódů a schválen konkrétní normalizér.

1. Vygenerujte nový náhodný pepper o nejméně 32 bytech v bezpečném správci
   tajemství. Hodnotu nikdy neukládejte do repozitáře, databáze ani logu.
2. Přesuňte dosavadní `TICKET_CODE_PEPPER_ACTIVE` do
   `TICKET_CODE_PEPPER_PREVIOUS` a nový pepper nastavte jako active ve webu i
   workeru. Změny nasaďte společně; předchozí hodnotu zatím zachovejte.
3. Čtení během přechodu vypočítá oba digesty. Shoda s previous se po úspěšném
   uzamčení řádku přepíše na active HMAC ve stejné databázové transakci.
4. Spusťte resumable event-scoped backfill. Nikdy k němu neexportujte raw kódy;
   pokud raw kód není bezpečně dostupný ze schváleného zdroje, ticket se přehashuje
   až při příštím legitimním použití nebo kontrolovaném reimportu.
5. Ověřte, že žádný ticket nepoužívá previous digest a že web ani worker nehlásí
   previous shody. Teprve potom odstraňte previous secret a znovu nasaďte obě
   služby.

Rollback před odstraněním previous spočívá ve vrácení dvojice proměnných. Po
odstranění previous je návrat možný pouze opětovným vložením původní hodnoty ze
správce tajemství. Rotace nemění normalizační pravidlo; jeho změna je samostatná
migrace s vlastními test vectors.
