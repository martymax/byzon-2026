'use client';

import { ActionLink, Button, Card } from '@byzon/ui';
import { useRef, useState } from 'react';

const steps = [
  {
    label: 'Program',
    title: 'Vyberte si, co vás zajímá',
    text: 'V programu otevřete detail přednášky nebo workshopu. Najdete tam čas, místo a dostupné akce. Uložení do agendy vám pomůže sestavit vlastní plán.',
    tip: 'Program je přehled celé konference. Agenda je váš osobní výběr.',
    href: '/app/program',
  },
  {
    label: 'Agenda a rezervace',
    title: 'Uloženo ještě neznamená rezervováno',
    text: 'U kapacitně omezených aktivit potřebujete potvrzenou rezervaci. Když je plno, může být dostupná čekací listina. Svůj aktuální stav vždy najdete v agendě.',
    tip: 'Místo máte jisté až ve chvíli, kdy aplikace ukáže potvrzenou rezervaci.',
    href: '/app/agenda',
  },
  {
    label: 'Networking',
    title: 'Seznamte se po svém',
    text: 'V networkingu můžete procházet zveřejněné profily účastníků a nastavit svůj vlastní. Sami zvolíte, zda se zobrazíte v seznamu a které kontakty zpřístupníte.',
    tip: 'Před zveřejněním si zkontrolujte náhled a nastavení viditelnosti.',
    href: '/app/networking',
  },
  {
    label: 'Oznámení a dotazy',
    title: 'Buďte v obraze a zapojte se',
    text: 'Oznámení obsahují zprávy od organizátorů. U aktivit, které mají otevřené dotazy, můžete položit otázku řečníkovi. Své dotazy a dostupné odpovědi najdete v Můj účet.',
    tip: 'Pokud má aktivita hodnocení otevřené, můžete také poslat zpětnou vazbu.',
    href: '/app/oznameni',
  },
  {
    label: 'Pomoc na dosah',
    title: 'Teď už se v aplikaci neztratíte',
    text: 'V Můj účet najdete osobní údaje, soukromí, přihlášení i Nápovědu a FAQ. Tento průvodce tam můžete kdykoliv spustit znovu.',
    tip: 'Praktické informace o konferenci najdete v sekci Informace.',
    href: '/app/napoveda',
  },
] as const;

export function ParticipantGuide({
  initiallyOpen = false,
  exitHref = '/po-prihlaseni',
}: {
  readonly initiallyOpen?: boolean;
  readonly exitHref?: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState<'saved' | 'confirmed' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = steps[step]!;
  const move = (next: number) => {
    setStep(next);
    setAnswer(null);
    requestAnimationFrame(() => heading.current?.focus());
  };
  if (!open)
    return (
      <Card className="participant-guide-intro">
        <div>
          <p className="eyebrow">Rychlý start · přibližně minuta</p>
          <h2>Vaše konference, váš plán</h2>
          <p>
            Projděte si pět krátkých zastavení a zjistěte, co vám aplikace
            usnadní.
          </p>
        </div>
        <Button
          onClick={() => {
            setOpen(true);
            move(0);
          }}
        >
          Spustit průvodce
        </Button>
      </Card>
    );
  return (
    <Card className="participant-guide">
      <div className="participant-guide-top">
        <p className="eyebrow">
          Průvodce aplikací · {step + 1} z {steps.length}
        </p>
        <ActionLink href={exitHref} variant="quiet">
          Přeskočit průvodce
        </ActionLink>
      </div>
      <ol className="participant-guide-progress" aria-label="Kroky průvodce">
        {steps.map((item, index) => (
          <li key={item.label}>
            <button
              type="button"
              aria-current={index === step ? 'step' : undefined}
              onClick={() => move(index)}
            >
              <span aria-hidden="true">{index + 1}</span>
              <span className="participant-guide-step-label">{item.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="participant-guide-content">
        <h2 ref={heading} tabIndex={-1}>
          {current.title}
        </h2>
        <p>{current.text}</p>
        <aside className="participant-guide-tip">
          <strong>Dobré vědět</strong>
          <p>{current.tip}</p>
        </aside>
        {step === 1 ? (
          <fieldset className="participant-guide-quiz">
            <legend>Vyzkoušejte si: kdy máte na workshopu jisté místo?</legend>
            <div className="activation-form-actions">
              <Button
                variant="secondary"
                aria-pressed={answer === 'saved'}
                onClick={() => setAnswer('saved')}
              >
                Po uložení do agendy
              </Button>
              <Button
                variant="secondary"
                aria-pressed={answer === 'confirmed'}
                onClick={() => setAnswer('confirmed')}
              >
                Po potvrzení rezervace
              </Button>
            </div>
            <p role="status">
              {answer === 'confirmed'
                ? 'Přesně tak. Potvrzená rezervace vám drží místo.'
                : answer === 'saved'
                  ? 'Uložení slouží k plánování. Místo vám zajistí až potvrzená rezervace.'
                  : 'Jde jen o ukázku, žádnou rezervaci tím nevytváříte.'}
            </p>
          </fieldset>
        ) : null}
      </div>
      <div className="participant-guide-footer">
        <Button
          variant="secondary"
          disabled={step === 0}
          onClick={() => move(step - 1)}
        >
          Zpět
        </Button>
        {step < steps.length - 1 ? (
          <Button onClick={() => move(step + 1)}>Další</Button>
        ) : (
          <ActionLink href={exitHref}>Otevřít aplikaci</ActionLink>
        )}
      </div>
    </Card>
  );
}
