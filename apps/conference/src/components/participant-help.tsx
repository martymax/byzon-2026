'use client';

import { ActionLink, Card, Input } from '@byzon/ui';
import { useState } from 'react';
import { ParticipantGuide } from './participant-guide';

const faqs = [
  {
    category: 'Program a agenda',
    question: 'Jak si sestavím vlastní program?',
    answer:
      'Otevřete Program, vyberte aktivitu a v jejím detailu ji uložte do agendy. V sekci Agenda pak najdete svůj výběr společně s rezervacemi a čekací listinou.',
    href: '/app/program',
    link: 'Otevřít program',
  },
  {
    category: 'Rezervace',
    question: 'Stačí si workshop uložit do agendy?',
    answer:
      'U kapacitně omezené aktivity ne. Uložení je jen váš plán. Použijte dostupnou akci pro rezervaci a vyčkejte na potvrzení. Za jisté místo považujte až stav potvrzené rezervace.',
    href: '/app/agenda',
    link: 'Zkontrolovat agendu',
  },
  {
    category: 'Rezervace',
    question: 'Co když je aktivita plná?',
    answer:
      'Pokud je u aktivity dostupná čekací listina, můžete se do ní přidat. Zařazení do čekací listiny ještě není rezervace. Stav a pořadí sledujte v agendě; stejnou žádost nemusíte opakovat.',
    href: '/app/agenda',
    link: 'Otevřít agendu',
  },
  {
    category: 'Rezervace',
    question: 'Jak rezervaci zruším nebo změním?',
    answer:
      'Otevřete danou aktivitu v agendě a použijte Zrušit rezervaci, pokud je tato akce ještě dostupná. Změny se řídí časovými limity aktivity. Při konfliktu s jinou rezervací vám aplikace nabídne dostupné možnosti a vyžádá potvrzení.',
    href: '/app/agenda',
    link: 'Spravovat rezervace',
  },
  {
    category: 'Networking a soukromí',
    question: 'Kdo uvidí můj profil a kontakty?',
    answer:
      'Viditelnost svého networkingového profilu a kontaktů nastavujete v sekci Networking. Před zapnutím zveřejnění zkontrolujte jednotlivá pole. Nastavení můžete později změnit; potvrzení pravidel aplikace samo o sobě networking nezapíná.',
    href: '/app/networking',
    link: 'Nastavit networking',
  },
  {
    category: 'Oznámení a dotazy',
    question: 'Kde najdu změny a zprávy organizátorů?',
    answer:
      'Otevřete Oznámení. Před začátkem vybrané aktivity zkontrolujte také její aktuální detail v Programu, zejména čas a místo.',
    href: '/app/oznameni',
    link: 'Přečíst oznámení',
  },
  {
    category: 'Oznámení a dotazy',
    question: 'Jak položím dotaz řečníkovi?',
    answer:
      'V detailu aktivity otevřete dotazy, pokud jsou pro ni dostupné. Odesílání závisí na tom, zda jsou dotazy právě otevřené. Své otázky a dostupné odpovědi najdete přes Můj účet → Moje dotazy a odpovědi.',
    href: '/app/dotazy',
    link: 'Moje dotazy a odpovědi',
  },
  {
    category: 'Účet a připojení',
    question: 'Funguje aplikace bez internetu?',
    answer:
      'Některé dříve načtené informace může aplikace zobrazit jako offline kopii s údajem o poslední aktualizaci. Rezervace a čekací listina vyžadují spojení se serverem. U neodeslané změny se řiďte zobrazeným stavem a po obnovení připojení výsledek zkontrolujte.',
    href: '/app/agenda',
    link: 'Zkontrolovat stav agendy',
  },
  {
    category: 'Účet a připojení',
    question: 'Jak upravím údaje nebo se odhlásím?',
    answer:
      'Osobní údaje upravíte v Můj účet → Moje osobní údaje. Odhlášení a změnu přihlášeného účtu najdete v Nastavení a přihlášení.',
    href: '/app/nastaveni',
    link: 'Otevřít nastavení',
  },
  {
    category: 'Networking a soukromí',
    question: 'Kde najdu dokumenty a proč je potvrzuji znovu?',
    answer:
      'Aktuální dokumenty a stav svých potvrzení najdete v Soukromí. Pokud je publikována nová vyžadovaná verze, aplikace vás před dalším používáním vyzve k jejímu přečtení a potvrzení. Dobrovolný průvodce aplikací můžete přeskočit.',
    href: '/app/soukromi',
    link: 'Otevřít soukromí',
  },
] as const;
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs')
    .trim();

export function ParticipantHelpContent({
  supportEmail,
}: {
  readonly supportEmail: string;
}) {
  const [query, setQuery] = useState('');
  const matches = faqs.filter((item) =>
    normalize(`${item.category} ${item.question} ${item.answer}`).includes(
      normalize(query),
    ),
  );
  return (
    <div className="participant-account-stack">
      <ParticipantGuide />
      <section aria-labelledby="faq-heading" className="participant-help-faq">
        <div>
          <p className="eyebrow">Odpovědi bez hledání</p>
          <h2 id="faq-heading">Časté otázky</h2>
        </div>
        <label className="participant-help-search" data-tour="help-search">
          Co potřebujete vyřešit?
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Například rezervace, kontakty nebo připojení"
          />
        </label>
        <p role="status">
          {query
            ? `Nalezené odpovědi: ${matches.length}`
            : 'Vyberte otázku a zobrazte odpověď.'}
        </p>
        <div className="participant-help-answers">
          {matches.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <div>
                <p className="eyebrow">{item.category}</p>
                <p>{item.answer}</p>
                <a className="text-link" href={item.href}>
                  {item.link}
                </a>
              </div>
            </details>
          ))}
        </div>
        {matches.length === 0 ? (
          <Card>
            <h3>Tuhle odpověď zatím nemáme</h3>
            <p>Zkuste kratší výraz, nebo nám napište. Rádi vám pomůžeme.</p>
            <button
              className="text-link"
              type="button"
              onClick={() => setQuery('')}
            >
              Zobrazit všechny otázky
            </button>
          </Card>
        ) : null}
      </section>
      <Card className="participant-guide-intro">
        <div>
          <p className="eyebrow">Jsme tu pro vás</p>
          <h2>Potřebujete osobní pomoc?</h2>
          <p>
            Napište, co se stalo a na jaké obrazovce. Heslo ani aktivační kód
            neposílejte.
          </p>
        </div>
        <ActionLink href={`mailto:${supportEmail}`} variant="secondary">
          Napsat podpoře
        </ActionLink>
      </Card>
    </div>
  );
}

export function ParticipantHelp({
  supportEmail,
}: {
  readonly supportEmail: string;
}) {
  return (
    <section className="app-page participant-account-page participant-help-page">
      <header className="participant-account-heading">
        <p className="eyebrow">Můj účet · Nápověda</p>
        <h1 data-route-heading tabIndex={-1}>
          Jak na BYZON aplikaci
        </h1>
        <p className="lead">
          Krátký průvodce a odpovědi, které máte vždy po ruce.
        </p>
      </header>
      <ParticipantHelpContent supportEmail={supportEmail} />
    </section>
  );
}
