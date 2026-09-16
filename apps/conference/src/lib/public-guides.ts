import type { GuideScreenshotId } from './guide-screenshots';
import type { GuideSlug } from '@byzon/mail/guides';

interface GuideSection {
  id: string;
  title: string;
  intro?: string;
  steps: readonly string[];
  screenshot?: GuideScreenshotId;
  note?: string;
  link?: { href: string; label: string };
}
interface GuideContent {
  introduction: string;
  destination: string;
  start: readonly string[];
  sections: readonly GuideSection[];
  related: readonly GuideSlug[];
}

export const publicGuideContent = {
  ucastnik: {
    introduction:
      'Připravte si vlastní den na BYZONu. V aplikaci najdete program, své rezervace, kontakty i odpovědi na otázky.',
    destination: '/app',
    start: [
      'Přihlaste se e-mailem, na který přišla pozvánka, a dokončete úvodní kroky.',
      'V Programu si otevřete zajímavé body a sestavte si vlastní Agendu.',
      'U workshopů s omezenou kapacitou si potvrďte rezervaci. Samotné uložení do agendy místo nezajišťuje.',
    ],
    sections: [
      {
        id: 'program',
        screenshot: 'program',
        title: 'Program a vlastní agenda',
        steps: [
          'V Programu otevřete detail aktivity. Zkontrolujte čas, místo, popis a řečníky.',
          'Zajímavé body si uložte do agendy. V Agendě najdete svůj výběr i stav rezervací a čekací listiny.',
          'Před odchodem na aktivitu znovu zkontrolujte její detail a Oznámení. Organizátor může změnit čas nebo místo.',
        ],
        link: { href: '/app/program', label: 'Otevřít program' },
      },
      {
        id: 'rezervace',
        title: 'Rezervace a čekací listina',
        steps: [
          'U aktivity s rezervací použijte dostupné tlačítko pro rezervování místa a vyčkejte na potvrzení.',
          'Je-li plno a je dostupná čekací listina, můžete se do ní přidat. Čekací listina není potvrzená rezervace.',
          'Při uvolnění místa vás aplikace může automaticky přesunout mezi rezervované, pokud nevznikne časová kolize. Sledujte aktuální stav v agendě a e-mail.',
          'Pokud nepřijdete, zrušte rezervaci nebo opusťte čekací listinu dostupnou akcí. Změny se řídí časovými limity aktivity. Případnou výměnu kolidující rezervace nejprve zkontrolujte a potvrďte.',
        ],
        note: 'Rezervování vyžaduje internet. Při chybě připojení nejprve obnovte agendu a ověřte výsledek.',
        link: { href: '/app/agenda', label: 'Otevřít agendu' },
      },
      {
        id: 'dotazy',
        title: 'Otázky řečníkům a odpovědi',
        steps: [
          'V detailu bodu programu otevřete dotazy, pokud jsou pro něj dostupné a sběr je otevřený.',
          'Napište jasnou otázku k tématu a odešlete ji. Moderátor může podobné otázky sloučit nebo otázku označit jako zodpovězenou.',
          'Své dotazy najdete v Můj účet → Moje dotazy a odpovědi. Řečník může po skončení vystoupení doplnit písemnou odpověď, pokud to organizátor povolil.',
        ],
        note: 'Označení „zodpovězeno“ při živém Q&A neznamená, že už existuje písemná odpověď. Soukromou písemnou odpověď vidí autor dotazu.',
        link: { href: '/app/dotazy', label: 'Moje dotazy a odpovědi' },
      },
      {
        id: 'networking',
        title: 'Networking, profil a soukromí',
        steps: [
          'Osobní údaje upravíte v Můj účet → Moje osobní údaje.',
          'V Networkingu nastavte, zda chcete zveřejnit profil a které kontakty smějí ostatní vidět. Networking je dobrovolný.',
          'V Soukromí najdete dokumenty a svá potvrzení. E-mailové preference, oslovení a odhlášení spravujete v Nastavení a přihlášení.',
        ],
        link: { href: '/app/networking', label: 'Otevřít networking' },
      },
      {
        id: 'po-konferenci',
        title: 'Po konferenci',
        steps: [
          'Zkontrolujte případné písemné odpovědi u svých dotazů.',
          'V sekci Hodnocení využijte dostupné hodnocení konference nebo aktivit. Dostupnost se řídí časem a nastavením organizátora.',
        ],
      },
    ],
    related: ['moderator', 'recnik', 'vedouci-aktivity'],
  },
  moderator: {
    introduction:
      'Veďte Q&A z jednoho přehledu: sledujte nové dotazy, spojujte podobná témata a označujte otázky, které už na pódiu zazněly.',
    destination: '/host/moderace',
    start: [
      'Přihlaste se a otevřete Můj účet → Moje role → Moderování.',
      'Vyberte přidělenou přednášku a ověřte její název, čas a místo.',
      'Domluvte s organizátorem, kdy bude sběr dotazů otevřený. Seznam dotazů si připravte před začátkem Q&A.',
    ],
    sections: [
      {
        id: 'priprava',
        title: 'Před začátkem bodu programu',
        steps: [
          'Otevřete Moderování a vyberte správný bod programu. Zobrazují se jen přednášky, ke kterým máte přidělený přístup.',
          'Zkontrolujte připojení a stav dotazů. Otevření a nastavení sběru spravuje administrátor v Interakcích.',
          'Pokud přednášku nevidíte, požádejte organizátora o ověření role i přiřazení ke konkrétnímu bodu. Samotná role řečníka přístup k moderování nepřidává.',
        ],
        link: { href: '/host/moderace', label: 'Otevřít moderování' },
      },
      {
        id: 'zive-qa',
        screenshot: 'moderovani',
        title: 'Během živého Q&A',
        steps: [
          'Sledujte přicházející dotazy. Otevřený přehled se průběžně obnovuje; při potížích použijte Obnovit dotazy.',
          'Pomocí filtrů přepínejte mezi všemi, zodpovězenými a nezodpovězenými dotazy. Pro další otázku vybírejte z nezodpovězených.',
          'Po odpovědi řečníka klikněte na Označit jako zodpovězenou. Omyl opravíte volbou Vrátit mezi nezodpovězené.',
          'Při upozornění na přerušené spojení počítejte s tím, že přehled může být neaktuální. Po návratu internetu ověřte poslední provedenou změnu.',
        ],
        note: 'Označení otázky jako zodpovězené zaznamená průběh živého Q&A. Nevytváří písemnou odpověď za řečníka.',
      },
      {
        id: 'slouceni',
        title: 'Podobné otázky spojte',
        steps: [
          'U dvou souvisejících dotazů zaškrtněte Vybrat ke sloučení.',
          'Použijte dostupnou akci pro sloučení. V přehledu zůstávají zachována původní znění otázek.',
          'Před přečtením řečníkovi zkontrolujte i připojená původní znění, aby sloučením nezanikla důležitá část dotazu.',
        ],
      },
      {
        id: 'smazani',
        title: 'Nevhodnou otázku odstraňte',
        steps: [
          'U konkrétního dotazu zvolte Smazat otázku.',
          'Přečtěte si náhled v potvrzovacím okně. U sloučeného dotazu se odstraní i všechna sloučená znění.',
          'Potvrďte smazání pouze tehdy, pokud má otázka zmizet z přehledů moderátorů, tazatelů i řečníků.',
        ],
        note: 'Smazání nepoužívejte místo označení „zodpovězeno“. Slouží k odstranění otázky.',
      },
      {
        id: 'po-qa',
        title: 'Po skončení Q&A',
        steps: [
          'Zkontrolujte, že zodpovězené otázky mají správný stav. Přehled zůstává dostupný i po skončení sběru.',
          'S řečníkem se domluvte na případném písemném doplnění nezodpovězených témat. Řečník odpovídá ze svého účtu v Dotazech k doplnění.',
          'Při souběžné práci více moderátorů a hlášení konfliktu obnovte dotazy a posuďte aktuální stav před další změnou.',
        ],
      },
    ],
    related: ['recnik', 'administrator', 'ucastnik'],
  },
  recnik: {
    introduction:
      'Zkontrolujte své vystoupení a po jeho skončení se vraťte k otázkám publika. Písemné odpovědi posíláte přímo autorům dotazů.',
    destination: '/host/dotazy',
    start: [
      'Přihlaste se e-mailem, který organizátor připojil k vašemu profilu řečníka.',
      'V Programu ověřte název, čas a místo svého vystoupení.',
      'Po skončení otevřete Můj účet → Moje role → Dotazy k doplnění.',
    ],
    sections: [
      {
        id: 'pred-vystoupenim',
        title: 'Před vystoupením',
        steps: [
          'Zkontrolujte svůj profil v přehledu řečníků a detail svého bodu programu.',
          'Opravu profilu, času nebo popisu domluvte s organizátorem, který obsah upravuje a zveřejňuje.',
          'S moderátorem se dohodněte na průběhu Q&A. Živé třídění a označování dotazů provádí moderátor ve svém přehledu.',
        ],
        note: 'Role řečníka sama o sobě nepřidává moderování ani seznam přihlášených účastníků. Pro vedení workshopu může organizátor přidělit další roli.',
        link: { href: '/app/program', label: 'Zkontrolovat program' },
      },
      {
        id: 'najit-dotazy',
        title: 'Kde najdete dotazy po vystoupení',
        steps: [
          'Otevřete Dotazy k doplnění v sekci Moje role a vyberte svou ukončenou přednášku.',
          'Přepínejte filtry podle toho, zda má dotaz písemnou odpověď. Dotaz označený jako zodpovězený na konferenci může písemnou odpověď stále postrádat.',
          'Pokud přednáška chybí, ověřte, že skončila, organizátor povolil písemné odpovědi a váš účet je propojený s přiřazeným profilem řečníka.',
        ],
        link: { href: '/host/dotazy', label: 'Otevřít dotazy k doplnění' },
      },
      {
        id: 'odpoved',
        screenshot: 'odpoved',
        title: 'Napsat a upravit odpověď',
        steps: [
          'U otázky otevřete Napsat soukromou odpověď.',
          'Napište odpověď do pole Vaše písemná odpověď. Limit je 4 000 znaků. Poté zvolte Odeslat soukromou odpověď.',
          'Počkejte na potvrzení uložení. Vlastní odpověď později upravíte přes Upravit vlastní odpověď a Uložit úpravu odpovědi.',
          'U panelové diskuse může odpovědět kterýkoli přiřazený řečník. Upravit uloženou odpověď smí jen její autor. Pokud mezitím odpoví kolega, porovnejte zachovaný rozepsaný text s aktuální odpovědí.',
        ],
        note: 'Přehled pro řečníka neukazuje totožnost tazatele. Písemná odpověď je dostupná autorovi dotazu, není to veřejná diskuse.',
      },
      {
        id: 'dalsi-role',
        title: 'Když zároveň vedete nebo moderujete aktivitu',
        steps: [
          'Každá role má vlastní nástroje v Můj účet → Moje role.',
          'Pokud máte výslovně přidělené vedení aktivity, použijte Vedoucí aktivity pro přehled rezervací.',
          'Pro živou správu Q&A potřebujete roli moderátora a přiřazení ke konkrétnímu bodu programu.',
        ],
      },
    ],
    related: ['moderator', 'vedouci-aktivity', 'ucastnik'],
  },
  'vedouci-aktivity': {
    introduction:
      'Mějte přehled o bodech programu, které vedete, a o lidech přihlášených na aktivity s omezenou kapacitou.',
    destination: '/host/aktivity',
    start: [
      'Přihlaste se a otevřete Můj účet → Moje role → Vedoucí aktivity.',
      'V přehledu Moje aktivity zkontrolujte přidělené body programu.',
      'U aktivity s rezervací rozlišujte potvrzená místa a čekací listinu.',
    ],
    sections: [
      {
        id: 'pristup',
        title: 'Přiřazení ke konkrétní aktivitě',
        steps: [
          'Organizátor vám přidělí přístup k aktivitě nebo místnosti. Uvidíte pouze odpovídající body programu.',
          'Ověřte název a čas aktivity. Pokud je seznam prázdný nebo v něm něco chybí, požádejte organizátora o kontrolu přiřazení.',
          'Pokud jste současně řečníkem, samotné propojení s profilem řečníka přístup k seznamu rezervací nenahrazuje.',
        ],
        link: { href: '/host/aktivity', label: 'Otevřít moje aktivity' },
      },
      {
        id: 'seznam',
        screenshot: 'aktivita',
        title: 'Jak číst seznam účastníků',
        steps: [
          'U aktivity s omezenou kapacitou zkontrolujte údaj Kapacita a seznam přihlášených.',
          'Stav Rezervováno znamená potvrzené místo. Stav Čekací listina znamená, že účastník na místo čeká.',
          'Seznam zobrazuje jméno a případně firmu. Před začátkem znovu načtěte stránku, aby odrážela poslední změny.',
        ],
        note: 'Aktivita označená „Bez registrace účastníků“ rezervaci nevyžaduje. Prázdný seznam u ní neznamená, že nikdo nepřijde.',
      },
      {
        id: 'zmeny',
        title: 'Když je potřeba změnit rezervaci nebo kapacitu',
        steps: [
          'Tento přehled slouží ke čtení. Změnu kapacity, času či místa předejte organizátorovi.',
          'Účastník spravuje vlastní rezervaci v Agendě podle dostupných akcí. Výjimky řeší administrátor ve správě rezervací.',
          'Účastníkovi na čekací listině neslibujte potvrzené místo bez ověření aktuálního stavu.',
        ],
      },
      {
        id: 'na-miste',
        title: 'Na místě a po skončení',
        steps: [
          'Seznam používejte k organizaci své aktivity a nesdílejte osobní údaje veřejně.',
          'BYZON 2026 v aplikaci nekontroluje vstupenky ani neprovádí check-in. Nehledejte zde skenování vstupenek nebo potvrzení docházky.',
          'Pokud také moderujete Q&A nebo doplňujete odpovědi jako řečník, přejděte do nástrojů příslušné role.',
        ],
      },
    ],
    related: ['moderator', 'recnik', 'administrator'],
  },
  administrator: {
    introduction:
      'Připravte obsah a přístupy, pozvěte správné lidi a během konference spravujte program, interakce i provoz z administrace.',
    destination: '/admin',
    start: [
      'Přihlaste se účtem s rolí administrátora a otevřete Administraci.',
      'Zkontrolujte program, přiřazení řečníků, moderátorů a vedoucích aktivit.',
      'V Pozvánkách vyberte příjemce. E-mail jim automaticky nabídne veřejné návody podle jejich aktuálních rolí.',
    ],
    sections: [
      {
        id: 'obsah',
        title: 'Připravit a zveřejnit program',
        steps: [
          'Ve správě obsahu upravte body programu, časy, místnosti a návaznosti na řečníky.',
          'Před zveřejněním zkontrolujte náhled a případné validační chyby. Uložení konceptu není totéž jako zveřejnění účastníkům.',
          'Zveřejněte připravenou verzi přes publikační akci a následně ověřte účastnický Program.',
        ],
        link: { href: '/admin/obsah', label: 'Otevřít správu obsahu' },
      },
      {
        id: 'pristupy',
        title: 'Přidělit role a jejich rozsah',
        steps: [
          'Ve správě týmu a rolí ověřte správný e-mail každého člověka.',
          'Moderátorovi přiřaďte konkrétní body programu. Vedoucímu aktivity přiřaďte odpovídající aktivitu nebo místnost.',
          'U řečníka propojte jeho profil s účtem a bodem programu. Samotná role bez propojení nezpřístupní dotazy konkrétní přednášky.',
          'Jeden člověk může mít více rolí. Administrátorský přístup přidělujte jen těm, kdo mají spravovat celou akci.',
        ],
        link: { href: '/admin/role', label: 'Otevřít správu týmu a rolí' },
      },
      {
        id: 'pozvanky',
        screenshot: 'pozvanky',
        title: 'Odeslat pozvánky s návody',
        steps: [
          'Otevřete Pozvánky a filtrujte příjemce podle rolí, jména, e-mailu nebo stavu pozvánky.',
          'Zaškrtněte konkrétní příjemce a zkontrolujte výběr před odesláním. Člověk s více rolemi dostává v jedné pozvánce všechny odpovídající návody.',
          'Po odeslání zkontrolujte výsledek dávky. Nedokončení příjemci zůstávají vybraní pro další pokus.',
          'V E-mailech ověřte historii a obsah odeslané zprávy. Osobní přihlašovací odkaz je v archivu skrytý; veřejné odkazy na návody zůstávají čitelné.',
        ],
        note: 'Pozvánkový odkaz je jednorázový a platí 24 hodin. Veřejný návod nevyprší společně s pozvánkou. Změna rolí se promítne do nově odeslané pozvánky.',
        link: { href: '/admin/pozvanky', label: 'Otevřít pozvánky' },
      },
      {
        id: 'qa',
        title: 'Připravit Q&A a navazující odpovědi',
        steps: [
          'V Interakcích vyberte bod programu a zkontrolujte nastavení a dostupnost sběru dotazů.',
          'Ověřte přiřazení moderátora. Moderátor ve svém přehledu slučuje, maže a označuje dotazy jako zodpovězené.',
          'Pokud mají řečníci odpovídat po vystoupení, povolte odpovídající funkci a ověřte propojení účtů řečníků.',
          'Po skončení zkontrolujte dostupnost nezodpovězených dotazů. Označení živě zodpovězené otázky samo nevytváří písemnou odpověď.',
        ],
        link: { href: '/admin/interakce', label: 'Otevřít interakce' },
      },
      {
        id: 'provoz',
        title: 'Během konference a při potížích',
        steps: [
          'Ve správě rezervací řešte kapacitu a výjimky. Před potvrzením změny ověřte konkrétní aktivitu a účastníka.',
          'Důležité zprávy připravte v Oznámeních a před odesláním zkontrolujte obsah i příjemce.',
          'Při chybě přístupu zkontrolujte aktivní účet, členství, role a rozsah přiřazení. Účastník se musí přihlásit stejným e-mailem, na který byl pozván.',
          'Pro dohledání změn použijte Audit; provozní stav najdete v Provozu. V roce 2026 se v aplikaci neprovádí check-in ani kontrola vstupenek.',
        ],
      },
    ],
    related: [
      'moderator',
      'vedouci-aktivity',
      'recnik',
      'ucastnik',
      'organizacni-podpora',
    ],
  },
  'organizacni-podpora': {
    introduction:
      'Pomozte návštěvníkům najít program a správný kontakt. Rozsah nástrojů vždy vychází z role, kterou vám organizátor skutečně přidělil.',
    destination: '/app',
    start: [
      'Použijte e-mail z pozvánky a ověřte, pod kterým účtem jste přihlášeni.',
      'S organizátorem si potvrďte své úkoly na místě a případné další role v aplikaci.',
      'Pro BYZON 2026 je kontrola vstupenek a check-in v aplikaci vypnutý.',
    ],
    sections: [
      {
        id: 'rozsah',
        title: 'Co znamená přístup organizační podpory',
        steps: [
          'Tento návod pokrývá také účty s rolí obsluhy check-inu. Check-inové obrazovky se v ročníku 2026 nepoužívají.',
          'Samotná role obsluhy nedává přístup do administrace, k rezervacím všech účastníků ani k moderování Q&A.',
          'Potřebujete-li vést aktivitu nebo moderovat, požádejte organizátora o příslušnou roli a konkrétní přiřazení.',
        ],
      },
      {
        id: 'pomoc',
        screenshot: 'program',
        title: 'Pomoc účastníkovi na místě',
        steps: [
          'S vyhledáním času a místa pomozte přes Program a aktuální Oznámení.',
          'Rezervaci si účastník ověří ve své Agendě. Stav čekací listiny není potvrzené místo.',
          'Problém s přístupem, kapacitou nebo osobními údaji předejte administrátorovi. Přihlášení provádí každý na svém zařízení a pomocí vlastního e-mailu.',
        ],
      },
      {
        id: 'pozvanka',
        title: 'Když něco chybí nebo nefunguje',
        steps: [
          'U neplatného osobního odkazu si vyžádejte nový na přihlašovací stránce. Veřejný návod můžete číst dál bez přihlášení.',
          'Organizátorovi sdělte použitý e-mail, název chybějící aktivity a znění chyby. Neposílejte mu svůj osobní přihlašovací odkaz.',
          'Pokud máte více rolí, další nástroje najdete v Můj účet → Moje role.',
        ],
      },
    ],
    related: ['ucastnik', 'vedouci-aktivity', 'moderator'],
  },
} as const satisfies Record<GuideSlug, GuideContent>;

export const guideContent = (slug: GuideSlug): GuideContent =>
  publicGuideContent[slug];

export const gettingStarted = [
  {
    title: 'Otevřete osobní pozvánku',
    text: 'Použijte odkaz z e-mailu. Je jednorázový a platí 24 hodin od odeslání. Pokud už neplatí, na přihlašovací stránce zadejte stejný e-mail a vyžádejte si nový.',
  },
  {
    title: 'Dokončete první přihlášení',
    text: 'Aplikace vás provede potřebnými údaji a potvrzením aktuálních dokumentů. Dobrovolného průvodce můžete přeskočit. Nepoužívejte účet kolegy.',
  },
  {
    title: 'Najděte nástroje své role',
    text: 'V Můj účet → Moje role najdete dostupné moderování, vedení aktivit a dotazy pro řečníky. Administrátor má navíc administraci. Chybějící roli nebo přiřazení řeší organizátor.',
  },
] as const;

export const guideFaqs = [
  {
    question: 'Musím se přihlásit, abych si přečetl návod?',
    answer:
      'Ne. Všechny stránky v sekci Návody jsou veřejné. Můžete si je uložit nebo poslat kolegovi. Přihlášení je potřeba až pro práci v samotné aplikaci.',
  },
  {
    question: 'Mám více rolí. Který návod platí?',
    answer:
      'Každá role má vlastní návod. V nové pozvánce najdete odkazy podle aktuálně přidělených rolí. Například řečník, který zároveň vede workshop, využije návody pro řečníka i vedoucího aktivity.',
  },
  {
    question: 'Pozvánka nebo přihlašovací odkaz už nefunguje.',
    answer:
      'Pozvánkový a aktivační odkaz platí 24 hodin, běžný přihlašovací odkaz 30 minut. Každý funguje jen jednou. Na přihlašovací stránce zadejte stejnou e-mailovou adresu a vyžádejte si nový. Pokud e-mail nenajdete ani ve spamu, odpovězte organizátorům na původní pozvánku.',
  },
  {
    question: 'Nevidím svou aktivitu nebo nástroje role.',
    answer:
      'Ověřte e-mail přihlášeného účtu. Organizátor musí přidělit správnou roli i odpovídající aktivitu, místnost nebo profil řečníka. Některé nástroje závisejí také na čase a nastavení konference. Veřejný návod sám žádné oprávnění neuděluje.',
  },
  {
    question: 'Co dělat při výpadku internetu?',
    answer:
      'Dříve načtené údaje mohou být neaktuální. Rezervace, moderování i odeslání odpovědi vyžadují připojení. Po obnovení internetu znovu načtěte přehled a ověřte poslední změnu, než ji zopakujete.',
  },
] as const;
