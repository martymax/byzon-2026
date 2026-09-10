-- The owner-supplied application documents, published as immutable version 1.0.
-- Only fill missing current types for BYZON 2026. Never replace a current
-- version, rewrite document history, or create participant consent records.
INSERT INTO legal_documents
  (id, event_id, type, version, title, content, published_at, is_current)
SELECT document.id, event.id, document.type, document.version,
       document.title, document.content, now(), true
FROM events AS event
CROSS JOIN (VALUES
    ('fd5ddbd3-2210-5963-8f6b-38c2a7547cd9'::uuid, 'terms'::legal_document_type, '1.0',
     'Pravidla používání aplikace', $document$**BYZON 2026**

**Pravidla používání aplikace**

**Aplikace app.byzon.cz**

Tato pravidla popisují, jak aplikaci app.byzon.cz smíte používat a co od ní můžete čekat. Platí pro všechny, kdo se do ní přihlásí, tedy pro účastníky, řečníky i členy organizačního týmu konference BYZON 2026\.

# **1\. Čeho se tato pravidla týkají**

Pravidla se týkají výhradně používání aplikace app.byzon.cz. Nákup, storno a reklamaci vstupenky řeší obchodní podmínky prodejce SimpleShop a podmínky webu byzon.cz, nikoliv tento dokument.

To, jak nakládáme s vašimi osobními údaji, popisují samostatné Zásady zpracování osobních údajů aplikace app.byzon.cz.

# **2\. Kdo aplikaci smí používat**

Do aplikace se přihlásí držitel platné a aktivované vstupenky na BYZON 2026, řečník s pozvánkou od organizátora a člen organizačního týmu s přidělenou rolí.

Aplikaci nesmíte používat jménem někoho jiného ani svůj přístup sdílet s další osobou.

# **3\. Účet a přístup**

Jedna vstupenka znamená jeden účet. U hromadné objednávky si každý účastník aktivuje svou vlastní vstupenku a doplní si vlastní údaje.

Přihlašujete se bez hesla, přes ověřený e-mail nebo kód vstupenky. Tyto údaje si chraňte a nikomu je nepředávejte, podpora si je od vás nikdy nevyžádá.

Když přijdete o přístup, obnovíte si ho přes svůj e-mail, případně napište podpoře. Stornovaná nebo vrácená vstupenka právo na přístup do aplikace a na nové rezervace ztrácí.

# **4\. Co aplikace umí a co ne**

Aplikace slouží k přípravě programu, rezervacím, networkingu, odbavení na místě a zpětné vazbě ke konferenci BYZON 2026\.

Není určená pro nouzové situace ani jako jediný zdroj bezpečnostních pokynů. Pokud na místě nastane nějaký problém, řiďte se vždy pokyny obsluhy, ne jen aplikací.

Některé funkce, například živé dotazy nebo zprávy, potřebují připojení k internetu. Dříve načtené informace zůstávají dostupné i bez signálu.

# **5\. Vaše odpovědnost při používání aplikace**

O sobě uvádíte pravdivé a aktuální údaje.

Aplikaci nepoužíváte ke spamování, k obtěžování ostatních účastníků ani ke sdílení nevhodného nebo urážlivého obsahu, ať už jde o networking, dotazy pro řečníky, nebo případný social wall.

Nezneužíváte rezervační systém, tedy si nerezervujete místa bez úmyslu se dostavit, protože tím připravíte o místo někoho dalšího.

Své přístupové údaje, aktivační kód ani obsah vstupenky nesdílíte s dalšími osobami.

# **6\. Moderace a omezení přístupu**

Nevhodný obsah můžeme skrýt, upravit nebo odstranit. Pokud tato pravidla porušíte opakovaně nebo závažně, například zneužijete networking či budete obtěžovat ostatní účastníky, můžeme vám přiměřeně omezit nebo zrušit přístup ke konkrétní funkci, k networkingu, případně k celé aplikaci.

Pokud to okolnosti dovolí, snažíme se situaci nejdřív vyřešit přímo s vámi, než k omezení přístupu sáhneme.

# **7\. Dostupnost a změny aplikace**

Aplikaci provozujeme s péčí, ale nepřetržitou dostupnost zaručit nemůžeme. K výpadku může dojít při technické údržbě i z důvodů mimo naši kontrolu.

Kritické provozní změny vám proto pošleme i mimo aplikaci, obvykle e-mailem, abyste o ně při výpadku nepřišli.

Obsah a funkce aplikace můžeme v průběhu příprav i během konference přiměřeně upravovat.

# **8\. Obsah aplikace a duševní vlastnictví**

Program, materiály řečníků a další obsah aplikace smíte použít pro vlastní potřebu v souvislosti s účastí na BYZON 2026\.

Když řečník povolí zveřejnění své prezentace po akci, stažený materiál je určený vám osobně. Dál ho veřejně šířit mimo aplikaci můžete jen se souhlasem řečníka nebo organizátora.

Logo, grafiku a značku BYZON nepoužívejte bez našeho souhlasu k jiným účelům, než je vaše účast na konferenci.

# **9\. Za co odpovídáme a za co ne**

Aplikaci poskytujeme v aktuálním stavu a s péčí, kterou lze rozumně čekat od pořadatele odborné konference. Neodpovídáme za škodu způsobenou okolnostmi mimo naši kontrolu, jako je výpadek internetového připojení nebo chyba na straně SimpleShopu či jiného dodavatele.

Za obsah, který do aplikace vkládají jiní účastníci, například za networkingové zprávy nebo příspěvky na social wallu, neodpovídáme jako za obsah vlastní. Nevhodný obsah ale moderujeme podle čl. 6\.

Nic v těchto pravidlech neomezuje práva, která vám jako spotřebiteli dává zákon.

# **10\. Ukončení používání aplikace**

Váš přístup je vázaný na konferenci BYZON 2026 a na přiměřenou dobu po jejím skončení. Konkrétní lhůty najdete v čl. 8 Zásad zpracování osobních údajů aplikace.

Jakmile jsou vaše údaje podle zásad vymazané nebo anonymizované, zanikne i možnost se do aplikace přihlásit.

# **11\. Změny těchto pravidel**

Pokud tato pravidla podstatně změníme, dáme vám vědět, obvykle oznámením přímo v aplikaci nebo e-mailem.

# **12\. Kontakt**

Se všemi dotazy k těmto pravidlům se obracejte na společnost ENJOiT s.r.o., e-mail jsem@byzon.cz.$document$),
    ('703e4568-c817-556b-91d5-5c6291c7a04f'::uuid, 'privacy_notice'::legal_document_type, '1.0',
     'Zásady zpracování osobních údajů', $document$**BYZON 2026**

**Zásady zpracování osobních údajů**

**Aplikace app.byzon.cz**

V aplikaci app.byzon.cz o vás vedeme některé osobní údaje. Tento dokument vysvětluje jaké, proč je potřebujeme a jak dlouho si je necháváme. Aplikaci používáte jako držitel vstupenky, řečník nebo člen organizačního týmu konference BYZON 2026\.

# **1\. Čeho se tyto zásady týkají**

Zásady platí pro aplikaci app.byzon.cz, tedy pro to, co se děje poté, co si koupíte vstupenku a začnete aplikaci používat. Patří sem aktivace účtu, program, rezervace, networking, odbavení na místě i zpětná vazba po akci.

Samotný nákup vstupenky na webu byzon.cz se řídí zásadami ochrany osobních údajů tohoto webu. Platbu a vystavení vstupenky zajišťuje SimpleShop, který je pro tento účel samostatným správcem, takže o zpracování při nákupu se dočtete v jeho vlastních zásadách.

# **2\. Kdo je správcem vašich údajů**

Správcem osobních údajů zpracovávaných v aplikaci app.byzon.cz je společnost ENJOiT s.r.o., IČO 192 95 073, se sídlem F. A. Gerstnera č. ev. 52, České Budějovice 7, 370 01 České Budějovice, zapsaná v obchodním rejstříku vedeném Krajským soudem v Českých Budějovicích, oddíl C, vložka 33138\.

Pověřence pro ochranu osobních údajů jsme nejmenovali. S dotazem nebo žádostí se na nás můžete kdykoliv obrátit na e-mailu jsem@byzon.cz.

# **3\. Jaké údaje o vás aplikace zpracovává**

Bez základních údajů by aplikace nefungovala. Jde o jméno, příjmení, e-mail spojený s účtem a stav a kód vaší vstupenky. Nepovinně si můžete doplnit i telefon pro případ, že by bylo potřeba něco rychle vyřešit.

Networkingový profil je dobrovolný a ostatní ho ve výchozím stavu nevidí. Vyplňujete si ho sami, pokud chcete být v adresáři účastníků. Patří do něj číslo účastníka z řízeného networkingu, firma, pozice, krátké představení, kategorie toho, co zrovna hledáte, například know-how, lidi do týmu, investory nebo obchodní partnery, a dále kontaktní e-mail, telefon a LinkedIn. U e-mailu, telefonu a LinkedInu si navíc zvlášť určujete, jestli je ostatní v adresáři uvidí, nebo zůstanou skryté.

Z vaší činnosti v aplikaci ukládáme osobní agendu, rezervace workshopů, mastermindů a koučovacích slotů, čas odbavení na check-inu, vaše dotazy a odpovědi na ně, hlasování a hodnocení, doručená oznámení od organizátora a zprávy, které si vyměníte s ostatními účastníky poté, co se vzájemně spojíte.

Řečníkům zpracováváme navíc profilové a kontaktní údaje pro organizátora, materiály k prezentaci a odpovědi na dotazy z publika.

U partnerů konference vedeme pouze veřejný profil, tedy logo, popis a odkaz. Kontakty účastníků aplikace pro partnery nesbírá a partneři nemají do networkingového adresáře přístup.

# **4\. Proč vaše údaje zpracováváme**

Většinu údajů potřebujeme proto, abychom vám mohli dodat to, co jste si koupí vstupenky pořídili, tedy program, rezervace a odbavení na místě. Bez nich by aplikace nemohla fungovat, a jde proto o nutnou součást plnění smlouvy.

Networking a zpřístupnění vašich kontaktů ostatním účastníkům stojí na vašem souhlasu. Ten můžete kdykoliv odvolat nebo změnit přímo v aplikaci, na zbytek účtu to nemá žádný vliv.

Část zpracování stojí na našem oprávněném zájmu na bezpečném a spravedlivém průběhu akce, zejména abychom předešli duplicitním účtům a zneužití rezervací a mohli řešit stížnosti nebo nevhodný obsah.

Poslední skupinou jsou zákonné povinnosti, především u účetních a daňových dokladů k vaší platbě. Ty ovšem aplikace sama neřeší, vede je odděleně SimpleShop, případně účetnictví ENJOiT.

# **5\. Networking a soukromí**

Dokud si networkingový profil sami nezapnete, nikdo vás v adresáři účastníků neuvidí. I když ho zapnete, u telefonu a e-mailu si vyberete, jestli je ostatní uvidí, nebo zůstanou jen u vás.

Vypnout ho můžete kdykoliv. Z adresáře zmizíte okamžitě, ale účet i osobní agenda vám zůstanou.

# **6\. Odkud vaše údaje získáváme**

Jméno, e-mail a stav vstupenky přebíráme z prodejního systému SimpleShop, přes který jste si vstupenku koupili. Všechno ostatní, tedy profil, networking, agendu i rezervace, si zadáváte v aplikaci sami.

# **7\. Komu vaše údaje předáváme**

Vaše údaje sdílíme jen v nezbytné míře. Dostanou se k nim poskytovatelé IT a hostingových služeb, kteří pro nás aplikaci technicky provozují, poskytovatelé služeb pro rozesílání e-mailových a SMS notifikací, ostatní účastníci, kterým jste sami povolili zobrazení svých networkingových údajů, organizační tým konference a při zákonné povinnosti také orgány veřejné moci.

V organizačním týmu vidí každý jen to, co ke své roli potřebuje. Obsluha check-inu tak pracuje pouze s údaji nutnými k odbavení, nikoliv s celým vaším profilem.

Se všemi dodavateli, kteří pro nás údaje zpracovávají, máme nebo budeme mít smluvně ošetřené zpracování a vybíráme jen takové, kteří data zpracovávají v EU, případně jiným způsobem se srovnatelnou úrovní ochrany. Partnerům konference vaše údaje k marketingu nepředáváme a nikomu je neprodáváme.

# **8\. Jak dlouho vaše údaje uchováváme**

Doba uchování se liší podle toho, o jaký typ údajů jde.

| Kategorie údajů | Doba uchování |
| :---- | :---- |
| Networkingový profil a zprávy mezi účastníky | do 30 dnů po skončení konference |
| Ostatní osobní údaje spojené s účtem, tedy profil, agenda, rezervace, odbavení, dotazy a hodnocení | do 90 dnů po skončení konference, pokud delší dobu nevyžaduje zákon nebo řešení konkrétní stížnosti či nároku |
| Souhrnné a anonymní statistiky, ze kterých vás nelze dohledat | bez časového omezení, protože už nejde o osobní údaje |
| Účetní a daňové doklady k vaší platbě | po dobu stanovenou zákonem, odděleně u SimpleShopu, případně u ENJOiT |

 

# **9\. Cookies a sledování**

Aplikace app.byzon.cz nepoužívá reklamní ani analytické cookies třetích stran a nesleduje, co děláte mimo ni. Pracuje jen s technickými údaji, které potřebuje k běžnému provozu, jako je vaše přihlášení nebo dostupnost dříve načtených informací bez signálu.

# **10\. Vaše práva**

Profil si upravíte a networking vypnete rovnou v aplikaci, v sekci Profil a nastavení. O výmaz požádáte v sekci Soukromí. Se vším ostatním, včetně žádosti o kopii údajů, se na nás obraťte na jsem@byzon.cz.

**Přístup a kopie údajů**

Kdykoliv máte právo zjistit, jaké údaje o vás aplikace zpracovává, a získat jejich kopii. Samoobslužný export zatím aplikace nemá, takže nám napište na jsem@byzon.cz. Ověříme vaši totožnost a přehled vám pošleme.

**Oprava**

Pokud jsou vaše údaje nepřesné nebo neúplné, máte právo na jejich opravu. Většinu si opravíte přímo v aplikaci, se zbytkem vám rádi pomůžeme.

**Výmaz**

O výmaz svých údajů požádáte přímo v aplikaci, v sekci Soukromí tlačítkem „Požádat o smazání“. Vyhovíme vám, pokud nám v tom nebrání zákonná povinnost údaje uchovat, například u účetních dokladů, nebo probíhající řešení konkrétního nároku.

**Omezení zpracování**

Můžete požádat, abychom vaše údaje pouze uchovávali a dál s nimi nepracovali, například když rozporujete jejich přesnost.

**Přenositelnost**

Údaje, které jste nám sami poskytli, můžete získat ve strukturovaném a strojově čitelném formátu.

**Odvolání souhlasu a námitka**

Souhlas s networkingem odvoláte kdykoliv přímo v aplikaci, na zbytek účtu to nemá vliv. Proti zpracování, které stojí na našem oprávněném zájmu, můžete kdykoliv vznést námitku.

**Stížnost u dozorového úřadu**

Pokud si myslíte, že s vašimi údaji nezacházíme správně, můžete se obrátit na Úřad pro ochranu osobních údajů, Pplk. Sochora 27, 170 00 Praha 7, e-mail posta@uoou.gov.cz, datová schránka qkbaa2n.

# **11\. Bezpečnost údajů**

Vaše údaje chráníme přiměřenými technickými a organizačními opatřeními. Přístup k nim mají jen lidé z organizačního týmu, kteří ho ke své roli skutečně potřebují.

# **12\. Změny těchto zásad**

Pokud tyto zásady podstatně změníme, dáme vám vědět, obvykle oznámením přímo v aplikaci nebo e-mailem.

# **13\. Kontakt**

Se všemi dotazy k ochraně osobních údajů v aplikaci app.byzon.cz se obracejte na společnost ENJOiT s.r.o., e-mail jsem@byzon.cz.$document$)
) AS document(id, type, version, title, content)
WHERE event.slug = 'byzon-2026'
  AND NOT EXISTS (
    SELECT 1 FROM legal_documents AS current_document
    WHERE current_document.event_id = event.id
      AND current_document.type = document.type
      AND current_document.is_current = true
  )
ON CONFLICT DO NOTHING;
