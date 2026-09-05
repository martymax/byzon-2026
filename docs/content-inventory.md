# P0-06: Inventura obsahu a assetů

> Stav zdroje: `static-site/data/content.json` na větvi `stage/00-foundation`, 20. července 2026
>
> Účel: určit, co se v etapě 3 převede do cílových entit aplikace, co zůstane
> pouze obsahem veřejného webu a které údaje před importem vyžadují doplnění.

## Souhrn zdroje

| Oblast | Stav ve zdroji |
| --- | --- |
| Akce a značka | 1 web/ročník, termín 18.–19. 9. 2026, místo a kontakty |
| Program | 2 dny, 7 sekcí/scén, 66 položek |
| Řečníci | 17 profilů s fotografiemi; úplnost textů a odkazů je různá |
| Partneři | 7 názvů a log; bez popisu, odkazu, kategorie a pořadí mimo pořadí pole |
| Praktické informace | jeden blok místa, dopravy a mapového dotazu |
| Vstupenky | 3 marketingové cenové hladiny; checkout je SimpleShop embed |
| Právní obsah | 2 HTML dokumenty a 1 DOCX vzor odstoupení |
| Historie/marketing | hero, očekávaný obsah, 3 minulé ročníky a partnerská brožura |
| Lokální assety | 58 souborů mimo `.DS_Store`; 52 je přímo odkazováno z JSON |

Všech 52 souborových cest odkazovaných ze `static-site/data/content.json` existuje. Hodnota
`site.media_base` je adresář, nikoli samostatný asset. Šest dalších souborů je
použito přímo buildem nebo jde o starší/neaktivní varianty:

- `static-site/public/assets/css/styles.css` a
  `static-site/public/assets/js/main.js` používá veřejný web mimo JSON;
- `static-site/public/assets/docs/vzor-odstoupeni-od-smlouvy-byzon.docx` je
  veřejná příloha;
- `static-site/public/assets/img/2024/06/Moderní_leader_logo_RGB_modra-3-300x96.png`,
  `static-site/public/assets/img/2025/06/bm_vivamarketing_logo2024_rgb_black-300x212.png`
  a `static-site/public/assets/img/2026/06/JCI-Czech-Republic-WHITE.svg` jsou
  neaktivní varianty log.

## Mapování na cílové entity

| Zdroj | Cílová oblast/entity | Postup při importu |
| --- | --- | --- |
| `site` | `events`, veřejná konfigurace značky, `assets` | Importovat název, jazyk, URL, kontakty a brand assety. Popis a SEO média držet ve veřejném publication snapshotu. Datum a místo číst z doménových polí, ne parsovat z popisu. |
| `hero`, `co_vas_ceka`, `cta` | veřejné obsahové bloky/stránky | Zachovat jako řízený marketingový obsah veřejného webu. Do conference aplikace přenést jen výslovně použitý text; nevytvářet z těchto bloků program. |
| `vstupenky` | veřejný prodejní obsah | Cenové texty a období ponechat jako marketingový obsah. Nevytvářet z nich ticket typy ani nároky; autoritou bude potvrzený SimpleShop API sync. |
| `speakers.list[]` | `speakers`, veřejné profily, `assets` | Slug, jméno, role, bio, foto a odkazy importovat do draftu ročníku. Vazbu na program vytvářet přes stabilní ID po řízeném spárování, ne porovnáním textu za běhu. |
| `program.days[]` | event days | Převést na lokální data ročníku. Řetězce dat nejdřív normalizovat na ISO `2026-09-18` a `2026-09-19`. |
| `program.days[].stages[]` | `rooms` jako programové stage/sekce | Importovat zdrojový popisek stage, aby jej program mohl jednotně zobrazit v aplikaci i na statickém webu. Nevyvozovat z něj fyzickou místnost; paralelní koučovací linky držet odděleně kvůli kolizím. |
| `program...events[]` | `sessions`, vazby na řečníky, případně kapacitní aktivita | Importovat jako draft. Čas nejdřív rozdělit na začátek/konec; `24:00 - ?` je validační chyba. `type` je prezentační klasifikace, ne rezervační politika. |
| `location` | venue, praktická stránka/blok, `assets` | Převést název, text, mapový dotaz a obrázek. Doplnit strukturovanou adresu, souřadnice, navigační instrukce a případný plánek. |
| `partners.logos[]` | `partners`, veřejné profily, `assets` | Importovat název a logo do draftu. Doplnit popis, URL, kategorii/úroveň a explicitní pořadí před publikací profilů. |
| `partners.organizer` | event organizer/contact | Importovat jako veřejný kontakt pořadatele; IČ uložit strukturovaně bez prefixu `IČ:`. |
| `partner_page` | veřejná marketingová stránka a assety | Ponechat na `byzon.cz`; v aplikaci nevytvářet partnerský lead-capture flow. |
| `rocniky` | archivní marketingový obsah a assety | Ponechat na veřejném webu. Není seedem eventů aplikace bez samostatné migrace a kontroly práv k médiím. |
| `legal_pages`, `footer.legal` | versionované právní dokumenty + veřejná navigace | HTML lze použít jako migrační vstup, ale onboarding vyžaduje schválenou verzi, účel a datum účinnosti. Cesty ve footeru jsou jen navigace. |
| `nav`, `footer`, `simpleshop` | veřejný shell a checkout konfigurace | Neimportovat jako doménová data conference aplikace. Zachovat v současném buildu; do aplikace vést jen bezpečný odkaz na nákup a právní stránky. |

## Mezery a validační nálezy

Následující body se při budoucím importu nesmějí tiše domýšlet:

- Program nemá stabilní ID, slug, strukturované datum/čas, timezone, stav publikace,
  popis, skutečnou místnost, kapacitu, uzávěrku ani waitlist pravidlo.
- `type` chybí u 40 z 66 položek a současné hodnoty (`break`, `discussion`,
  `meal`, `shared`, `social`) popisují hlavně vzhled veřejného webu.
- Řečníci jsou v programu uváděni textem. Některá programová jména nemají profil
  a některé `meta` hodnoty kombinují osobu s volným popisem; automatické vazby
  proto musí skončit v reportu k ruční kontrole.
- `Petr Dvořák` má prázdnou roli; několik profilů má pouze zástupný nebo velmi
  krátký medailonek. Sociální odkazy jsou volitelné a nestejnoměrné.
- Koučovací zóna obsahuje obecné sloty bez koučů, kapacity a pravidel. Nesmí se
  z ní automaticky vytvořit aktivní rezervace.
- Partnerská data neobsahují profilový text ani cílovou URL.
- Praktické informace neobsahují přesnou adresu, plánek, kontakty na místě ani
  strukturované FAQ/cutoffy.
- Cenová období jsou marketingové texty; nesmějí rozhodovat o platnosti nebo
  oprávnění konkrétní vstupenky.
- Všechny současné assety jsou veřejné. Budoucí soukromé materiály řečníků se
  nesmějí importovat do stejné veřejné cesty.

Tyto nálezy odpovídají `BLOCKER-CONTENT-01`, ticketovým blokátorům a dnes již
uzavřeným rezervačním vstupům z ADR-014. Nevytvářejí nový blocker pro skeleton
ani pro draftový import s reportem nepřevedených polí.

## Kontrakt pro budoucí import

Úkol `P3-02` má zachovat `static-site/data/content.json` beze změny a provést opakovatelný
import do draftu pro event `byzon-2026`. Import musí:

1. validovat zdroj a lokální assety před zápisem;
2. používat stabilní natural key v rámci eventu (např. speaker slug) a být
   idempotentní;
3. odmítnout neparsovatelný čas nebo datum místo tichého odhadu;
4. vypsat nespárované programové osoby, chybějící povinná pole a neznámé typy;
5. nepublikovat, nevytvářet rezervace a neměnit současný statický build;
6. uložit původ/provenance importovaných hodnot pro kontrolu a opakování.

## Ověření inventury

- struktura a počty byly získány přes `jq` z celého `static-site/data/content.json`;
- existence lokálních cest byla porovnána s pracovním stromem;
- mapování bylo porovnáno s produktovým zadáním v1.0, ADR-008 a datovým modelem
  v §9 implementačního plánu;
- inventura neprovedla žádnou změnu obsahu ani generovaných stránek.
