import {
  ratingSubmitRequestSchema,
  type EventSurveyProgram,
} from '@byzon/domain/contracts';

export type SurveyAnswers = Record<string, string>;
export type SurveyQuestion = {
  id: string;
  label: string;
  kind: 'rating' | 'choice' | 'text';
  required?: boolean;
  options?: readonly (readonly [string, string])[];
  skipLabel?: string;
  hint?: string;
  maxLength?: number;
  when?: readonly [string, string];
};
export const satisfactionOptions = [
  ['4', 'Spokojen/a'],
  ['3', 'Spíše spokojen/a'],
  ['2', 'Spíše nespokojen/a'],
  ['1', 'Nespokojen/a'],
] as const;
const rating = (
  id: string,
  label: string,
  skipLabel?: string,
): SurveyQuestion => ({
  id,
  label,
  kind: 'rating',
  required: true,
  ...(skipLabel ? { skipLabel } : {}),
});
const comment = (id: string, label: string, hint?: string): SurveyQuestion => ({
  id,
  label,
  kind: 'text',
  maxLength: 2000,
  ...(hint ? { hint } : {}),
});
const attended = (id: string, label: string): SurveyQuestion => ({
  id,
  label,
  kind: 'choice',
  required: true,
  options: [
    ['yes', 'Ano'],
    ['no', 'Ne'],
  ],
});

export const surveySections = (
  nextYear: number,
): {
  title: string;
  description: string;
  questions: SurveyQuestion[];
}[] => [
  {
    title: 'Něco o vás',
    description:
      'Tyto otázky jsou dobrovolné. Pomáhají nám poznat návštěvníky konference.',
    questions: [
      {
        id: 'gender',
        label: 'Jste:',
        kind: 'choice',
        options: [
          ['man', 'Muž'],
          ['woman', 'Žena'],
          ['prefer_not_to_say', 'Nechci odpovídat'],
          ['other', 'Jiné'],
        ],
      },
      {
        id: 'genderOther',
        label: 'Jiné – upřesnění',
        kind: 'text',
        maxLength: 128,
        when: ['gender', 'other'],
      },
      {
        id: 'city',
        label: 'Odkud jste (město nebo obec)?',
        kind: 'text',
        maxLength: 256,
      },
      {
        id: 'ticketSource',
        label: 'Jak jste získali vstupenku?',
        kind: 'choice',
        options: [
          ['company', 'Vstupenku mi pořídila firma'],
          ['self', 'Vstupenku jsem si pořídil/a sám/sama'],
          ['team', 'Jsem člen/ka organizačního týmu'],
          ['speaker', 'Jsem řečník/řečnice'],
          ['other', 'Jinak'],
        ],
      },
    ],
  },
  {
    title: 'Přednášky a řečníci',
    description:
      'Otevřete navštívenou stage a ohodnoťte jednotlivá vystoupení. Všechny otázky v této části jsou dobrovolné.',
    questions: [],
  },
  {
    title: 'Koučování a workshopy',
    description:
      'Podrobnosti se zobrazí jen u programu, kterého jste se zúčastnili.',
    questions: [
      attended('coachingAttended', 'Využili jste koučovací zónu?'),
      {
        ...rating('coachingScore', 'Jak hodnotíte koučovací zónu?'),
        when: ['coachingAttended', 'yes'],
      },
      {
        ...comment('coachingComment', 'Jaká byla vaše zkušenost s koučováním?'),
        when: ['coachingAttended', 'yes'],
      },
      attended(
        'workshopsAttended',
        'Zúčastnili jste se workshopů nebo extra tréninků?',
      ),
      {
        ...rating(
          'workshopsScore',
          'Jak hodnotíte workshopy a extra tréninky celkově?',
        ),
        when: ['workshopsAttended', 'yes'],
      },
      {
        ...comment('workshopsComment', 'Jaká byla vaše zkušenost s workshopy?'),
        when: ['workshopsAttended', 'yes'],
      },
    ],
  },
  {
    title: 'Občerstvení a networking',
    description:
      'Čím vyšší číslo, tím lepší hodnocení. Pokud jste něco nevyužili, zvolte tuto možnost.',
    questions: [
      rating('lunchScore', 'Jak hodnotíte oběd?', 'Oběd jsem nevyužil/a'),
      comment('lunchComment', 'Co nám chcete říct k obědu?'),
      rating(
        'breaksScore',
        'Jak hodnotíte coffee breaky?',
        'Coffee breaky jsem nevyužil/a',
      ),
      comment(
        'breaksComment',
        'Co nám chcete říct k občerstvení během přestávek?',
      ),
      rating(
        'networkingScore',
        'Jak hodnotíte networking?',
        'Networkingu jsem se nezúčastnil/a',
      ),
      comment('networkingComment', 'Co nám chcete říct k networkingu?'),
    ],
  },
  {
    title: 'Web a účastnická appka',
    description:
      'Pomozte nám zlepšit informace před konferencí i používání appky během ní.',
    questions: [
      rating(
        'websiteScore',
        'Jak hodnotíte web konference byzon.cz?',
        'Web jsem nepoužil/a',
      ),
      comment(
        'websiteComment',
        'Co na webu fungovalo a co máme zlepšit?',
        'Například přehlednost, informace o programu nebo nákup vstupenky.',
      ),
      rating(
        'appScore',
        'Jak hodnotíte účastnickou appku?',
        'Appku používám až teď k hodnocení',
      ),
      comment(
        'appComment',
        'Co v appce fungovalo a co vám chybělo?',
        'Například přihlášení, program, vlastní agenda, rezervace, networking nebo oznámení.',
      ),
    ],
  },
  {
    title: 'Partneři konference',
    description: 'Zajímá nás, kdo vám utkvěl v paměti. Odpověď je dobrovolná.',
    questions: [
      comment(
        'partners',
        'Které partnery konference si vybavíte (mimo svou firmu)?',
        'Napište ty, které si pamatujete. Pokud žádného, můžete napsat „Nevybavuji si“.',
      ),
    ],
  },
  {
    title: 'Konference celkově',
    description:
      'Posledních pár otázek. Před odesláním se můžete vrátit k předchozím odpovědím.',
    questions: [
      rating('organizationBefore', 'Jak hodnotíte organizaci před konferencí?'),
      rating(
        'organizationDuring',
        'Jak hodnotíte organizaci během konference?',
      ),
      {
        id: 'score',
        label: 'Jak hodnotíte konferenci celkově?',
        kind: 'choice',
        required: true,
        options: [
          ['5', 'Výborná'],
          ['4', 'Velmi dobrá'],
          ['3', 'Dobrá'],
          ['2', 'Průměrná'],
          ['1', 'Slabá'],
        ],
      },
      {
        id: 'returnIntention',
        label: `Dorazíte na další ročník (${nextYear})?`,
        kind: 'choice',
        required: true,
        options: [
          ['definitely_yes', 'Určitě ano'],
          ['probably_yes', 'Spíše ano'],
          ['probably_no', 'Spíše ne'],
          ['definitely_no', 'Určitě ne'],
        ],
      },
      comment('comment', 'Co se povedlo a co máme příště zlepšit?'),
      comment(
        'nextSpeaker',
        'Jakého řečníka nebo jaké téma byste rádi viděli příště?',
      ),
      {
        id: 'instagram',
        label: 'Sledujete nás na Instagramu @byzoncz?',
        kind: 'choice',
        options: [
          ['yes', 'Ano'],
          ['will_follow', 'Ne, ale začnu'],
          ['no_account', 'Nemám Instagram'],
          ['no_interest', 'Ne, nechci'],
        ],
      },
    ],
  },
];

export const visibleSurveyQuestions = (
  questions: SurveyQuestion[],
  answers: SurveyAnswers,
) =>
  questions.filter(
    (question) =>
      !question.when || answers[question.when[0]] === question.when[1],
  );

export const buildEventSurveySubmission = (
  answers: SurveyAnswers,
  program: EventSurveyProgram | null,
) => {
  const nullableText = (id: string) => answers[id]?.trim() || null;
  const nullableScore = (id: string) =>
    !answers[id] || answers[id] === 'not_used' ? null : Number(answers[id]);
  const sections = surveySections(0);
  const survey: Record<string, unknown> = {
    version: 1,
    programVersion: program?.version ?? null,
  };
  for (const question of sections.flatMap((section) => section.questions)) {
    if (question.id === 'score' || question.id === 'comment') continue;
    const shown =
      !question.when || answers[question.when[0]] === question.when[1];
    survey[question.id] = !shown
      ? null
      : question.kind === 'rating'
        ? nullableScore(question.id)
        : question.id.endsWith('Attended')
          ? answers[question.id] === 'yes'
          : nullableText(question.id);
  }
  survey.sessions = (program?.sessions ?? []).flatMap((session) => {
    if (
      ['workshop', 'mastermind'].includes(session.type) &&
      answers.workshopsAttended !== 'yes'
    )
      return [];
    const value = answers[`session:${session.id}`];
    return value
      ? [
          {
            sessionId: session.id,
            score: value === 'not_used' ? null : Number(value),
          },
        ]
      : [];
  });
  return ratingSubmitRequestSchema.parse({
    targetType: 'event',
    score: Number(answers.score),
    comment: nullableText('comment')?.replace(/\s+/g, ' ') ?? null,
    survey,
  });
};
