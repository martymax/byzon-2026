import type { EventSurveyProgram } from '@byzon/domain/contracts';

export type SurveyRole = 'attendee' | 'speaker' | 'moderator' | 'partner';
export type ConferenceFeedbackAnswers = Record<string, string>;
export type ConferenceFeedbackOption = {
  value: string;
  label: string;
  description?: string;
};
export type ConferenceFeedbackQuestion = {
  id: string;
  label: string;
  type: 'choice' | 'text';
  options?: ConferenceFeedbackOption[];
  roles?: SurveyRole[];
  when?: readonly [string, string];
  maxLength?: number;
  hint?: string;
};
export type ConferenceFeedbackStep = {
  id: string;
  title: string;
  description: string;
  questionIds: string[];
  roles?: SurveyRole[];
};

export const CONFERENCE_FEEDBACK_ROLES: ConferenceFeedbackOption[] = [
  {
    value: 'attendee',
    label: 'Účastník / účastnice',
    description: 'Přišel/přišla jsem si pro inspiraci a nové kontakty.',
  },
  {
    value: 'speaker',
    label: 'Speaker / speakerka',
    description: 'Vystupoval/a jsem v programu.',
  },
  {
    value: 'moderator',
    label: 'Moderátor / moderátorka',
    description: 'Provázel/a jsem programem nebo diskusí.',
  },
  {
    value: 'partner',
    label: 'Partner / partnerka',
    description: 'Zastupoval/a jsem partnera konference.',
  },
];
const collaborators: SurveyRole[] = ['speaker', 'moderator', 'partner'];
const satisfaction = [
  { value: '4', label: 'Velmi spokojen/a' },
  { value: '3', label: 'Spíše spokojen/a' },
  { value: '2', label: 'Spíše nespokojen/a' },
  { value: '1', label: 'Velmi nespokojen/a' },
];
const quality = [
  { value: '4', label: 'Velmi dobře' },
  { value: '3', label: 'Spíše dobře' },
  { value: '2', label: 'Spíše špatně' },
  { value: '1', label: 'Velmi špatně' },
];
const intention = [
  { value: 'definitely_yes', label: 'Určitě ano' },
  { value: 'probably_yes', label: 'Spíše ano' },
  { value: 'probably_no', label: 'Spíše ne' },
  { value: 'definitely_no', label: 'Určitě ne' },
];
const choice = (
  id: string,
  label: string,
  options: ConferenceFeedbackOption[],
  skip = 'Nedokážu posoudit',
): ConferenceFeedbackQuestion => ({
  id,
  label,
  type: 'choice',
  options: [...options, { value: 'skip', label: skip }],
});
const rating = (id: string, label: string, skip?: string) =>
  choice(id, label, satisfaction, skip);
const text = (
  id: string,
  label: string,
  hint?: string,
): ConferenceFeedbackQuestion => ({
  id,
  label,
  type: 'text',
  maxLength: 2000,
  ...(hint ? { hint } : {}),
});
const attendance = (id: string, label: string) =>
  choice(id, label, [
    { value: 'yes', label: 'Ano' },
    { value: 'no', label: 'Ne' },
  ]);

export const CONFERENCE_FEEDBACK_QUESTIONS: ConferenceFeedbackQuestion[] = [
  {
    id: 'participantRole',
    label: 'V jaké roli jste na BYZONu byli?',
    type: 'choice',
    options: CONFERENCE_FEEDBACK_ROLES,
    hint: 'Pokud jste měli více rolí, vyberte tu hlavní. Podle ní vám přizpůsobíme otázky.',
  },
  choice('score', 'Jak hodnotíte konferenci celkově?', [
    { value: '5', label: 'Výborná' },
    { value: '4', label: 'Velmi dobrá' },
    { value: '3', label: 'Dobrá' },
    { value: '2', label: 'Průměrná' },
    { value: '1', label: 'Slabá' },
  ]),
  text(
    'comment',
    'Co vám z letošního BYZONu nejvíc utkvělo?',
    'Co se povedlo, co vám chybělo nebo co příště změnit. Zajímá nás i kritika.',
  ),
  attendance('coachingAttended', 'Využili jste koučovací zónu?'),
  {
    ...rating('coachingScore', 'Jak jste byli spokojeni s koučovací zónou?'),
    when: ['coachingAttended', 'yes'],
  },
  {
    ...text('coachingComment', 'Co nám chcete říct ke koučování?'),
    when: ['coachingAttended', 'yes'],
  },
  attendance(
    'workshopsAttended',
    'Zúčastnili jste se workshopů nebo extra tréninků?',
  ),
  {
    ...rating(
      'workshopsScore',
      'Jak jste byli spokojeni s workshopy a extra tréninky?',
    ),
    when: ['workshopsAttended', 'yes'],
  },
  {
    ...text('workshopsComment', 'Co nám chcete říct k workshopům?'),
    when: ['workshopsAttended', 'yes'],
  },
  choice(
    'organizationBefore',
    'Jak hodnotíte organizaci před konferencí?',
    quality,
  ),
  choice(
    'organizationDuring',
    'Jak hodnotíte organizaci během konference?',
    quality,
  ),
  rating(
    'lunchScore',
    'Jak jste byli spokojeni s obědem?',
    'Oběd jsem nevyužil/a',
  ),
  text('lunchComment', 'Co máme vědět o obědu?'),
  rating(
    'breaksScore',
    'Jak jste byli spokojeni s coffee breaky?',
    'Coffee breaky jsem nevyužil/a',
  ),
  text('breaksComment', 'Co máme vědět o občerstvení během přestávek?'),
  rating(
    'networkingScore',
    'Jak jste byli spokojeni s networkingem?',
    'Networkingu jsem se nezúčastnil/a',
  ),
  text('networkingComment', 'Co máme vědět o networkingu?'),
  rating(
    'websiteScore',
    'Jak jste byli spokojeni s webem byzon.cz?',
    'Web jsem nepoužil/a',
  ),
  text(
    'websiteComment',
    'Co na webu fungovalo a co můžeme zlepšit?',
    'Například informace o programu, přehlednost nebo nákup vstupenky.',
  ),
  rating(
    'appScore',
    'Jak jste byli spokojeni s účastnickou appkou?',
    'Appku jsem během konference nepoužil/a',
  ),
  text(
    'appComment',
    'Co v appce fungovalo a co vám chybělo?',
    'Například program, vlastní agenda, rezervace, networking nebo oznámení.',
  ),
  rating(
    'musicScore',
    'Jak jste byli spokojeni s hudebním doprovodem během konference?',
    'Hudební doprovod jsem nevnímal/a',
  ),
  rating(
    'djScore',
    'Jak jste byli spokojeni s DJ na afterparty?',
    'Afterparty jsem se nezúčastnil/a',
  ),
  choice(
    'musicReturn',
    'Uvítali byste podobný hudební doprovod a DJ i na příštím BYZONu?',
    intention,
  ),
  {
    ...rating(
      'collaborationScore',
      'Jak jste byli spokojeni se spoluprací s týmem BYZON?',
      'Netýká se mě',
    ),
    roles: collaborators,
  },
  {
    ...choice(
      'collaborationBefore',
      'Jak hodnotíte komunikaci týmu BYZON před konferencí?',
      quality,
      'Netýká se mě',
    ),
    roles: collaborators,
  },
  {
    ...choice(
      'collaborationDuring',
      'Jak hodnotíte organizaci a péči o vás během konference?',
      quality,
      'Netýká se mě',
    ),
    roles: collaborators,
  },
  {
    ...text(
      'collaborationKeep',
      'Co na spolupráci oceňujete a měli bychom zachovat?',
    ),
    roles: collaborators,
  },
  {
    ...text(
      'collaborationImprove',
      'Co bychom pro vás jako tým mohli příště udělat lépe?',
    ),
    roles: collaborators,
  },
  {
    ...choice(
      'collaborationRecommend',
      'Doporučili byste spolupráci s BYZONem dalším lidem či organizacím?',
      intention,
      'Netýká se mě',
    ),
    roles: collaborators,
  },
  {
    ...choice(
      'speakerSupport',
      'Jak hodnotíte technické zázemí a přípravu vašeho vystoupení?',
      quality,
      'Netýká se mě',
    ),
    roles: ['speaker'],
  },
  {
    ...choice(
      'moderatorPreparation',
      'Jak hodnotíte podklady a přípravu na moderování?',
      quality,
      'Netýká se mě',
    ),
    roles: ['moderator'],
  },
  {
    ...choice(
      'moderatorSupport',
      'Jak hodnotíte koordinaci s produkcí a speakery během programu?',
      quality,
      'Netýká se mě',
    ),
    roles: ['moderator'],
  },
  {
    ...choice(
      'partnerValue',
      'Naplnilo partnerství s BYZONem vaše očekávání?',
      intention,
      'Nedokážu zatím posoudit',
    ),
    roles: ['partner'],
  },
  {
    ...choice(
      'partnerVisibility',
      'Jak hodnotíte prezentaci a viditelnost vaší značky?',
      quality,
      'Netýká se mě',
    ),
    roles: ['partner'],
  },
  choice('returnIntention', 'Dorazíte na další ročník BYZONu?', intention),
  text('nextSpeaker', 'Koho nebo jaké téma byste rádi viděli příště?'),
  text(
    'partners',
    'Které partnery konference si vybavíte mimo svou firmu?',
    'Odpovězte, co vám zůstalo v paměti. I „Nevybavuji si“ nám pomůže.',
  ),
  { ...text('city', 'Odkud jste (město nebo obec)?'), maxLength: 256 },
  {
    id: 'gender',
    label: 'Jaké je vaše pohlaví?',
    type: 'choice',
    options: [
      { value: 'man', label: 'Muž' },
      { value: 'woman', label: 'Žena' },
      { value: 'other', label: 'Jiné' },
      { value: 'prefer_not_to_say', label: 'Nechci odpovídat' },
    ],
  },
  {
    ...text('genderOther', 'Chcete svou odpověď upřesnit?'),
    maxLength: 128,
    when: ['gender', 'other'],
  },
  choice(
    'ticketSource',
    'Jak jste získali vstupenku?',
    [
      { value: 'company', label: 'Vstupenku mi pořídila firma' },
      { value: 'self', label: 'Vstupenku jsem si pořídil/a sám/sama' },
      { value: 'team', label: 'Jsem člen/ka organizačního týmu' },
      { value: 'speaker', label: 'Jako speaker / speakerka' },
      { value: 'partner', label: 'Jako partner / partnerka' },
      { value: 'other', label: 'Jinak' },
    ],
    'Nechci odpovídat',
  ),
  {
    id: 'instagram',
    label: 'Sledujete nás na Instagramu @byzoncz?',
    type: 'choice',
    options: [
      { value: 'yes', label: 'Ano' },
      { value: 'will_follow', label: 'Ne, ale začnu' },
      { value: 'no_account', label: 'Nemám Instagram' },
      { value: 'no_interest', label: 'Ne, nechci' },
    ],
  },
];

export const CONFERENCE_FEEDBACK_STEPS: ConferenceFeedbackStep[] = [
  {
    id: 'intro',
    title: 'Nejdřív něco o vás',
    description: 'Jedna konference, různé zkušenosti. Začneme tou vaší.',
    questionIds: ['participantRole'],
  },
  {
    id: 'overall',
    title: 'Jaký byl váš BYZON?',
    description: 'Začněme celkovým dojmem. Každá upřímná odpověď nám pomůže.',
    questionIds: ['score', 'comment'],
  },
  {
    id: 'program',
    title: 'Inspirace, kterou si odnášíte',
    description:
      'Hodnoťte jen to, co jste zažili. Podrobnosti otevřeme podle vašich odpovědí.',
    questionIds: [
      'coachingAttended',
      'coachingScore',
      'coachingComment',
      'workshopsAttended',
      'workshopsScore',
      'workshopsComment',
    ],
  },
  {
    id: 'organization',
    title: 'Aby všechno fungovalo',
    description:
      'Jak se nám podařilo připravit konferenci a provést vás celým dnem?',
    questionIds: ['organizationBefore', 'organizationDuring'],
  },
  {
    id: 'experience',
    title: 'Jak vám s námi bylo?',
    description: 'Občerstvení, přestávky a prostor pro nová setkání.',
    questionIds: [
      'lunchScore',
      'lunchComment',
      'breaksScore',
      'breaksComment',
      'networkingScore',
      'networkingComment',
    ],
  },
  {
    id: 'digital',
    title: 'BYZON na obrazovce',
    description: 'Web před konferencí, appka během ní. Pomozte nám je zlepšit.',
    questionIds: ['websiteScore', 'websiteComment', 'appScore', 'appComment'],
  },
  {
    id: 'music',
    title: 'Jak BYZON zněl?',
    description:
      'Hudba během dne a DJ na afterparty. Zajímá nás, jak jste je vnímali.',
    questionIds: ['musicScore', 'djScore', 'musicReturn'],
  },
  {
    id: 'collaboration',
    title: 'BYZON z druhé strany',
    description:
      'Děkujeme, že jste pomohli BYZON vytvořit. Teď nás zajímá spolupráce s naším týmem.',
    questionIds: [
      'collaborationScore',
      'collaborationBefore',
      'collaborationDuring',
      'collaborationKeep',
      'collaborationImprove',
    ],
    roles: collaborators,
  },
  {
    id: 'role',
    title: 'Prostor pro vaši roli',
    description: 'Ještě chvíli u toho, co je důležité právě pro vaši roli.',
    questionIds: [
      'speakerSupport',
      'moderatorPreparation',
      'moderatorSupport',
      'partnerValue',
      'partnerVisibility',
      'collaborationRecommend',
    ],
    roles: collaborators,
  },
  {
    id: 'future',
    title: 'Co si přejete příště?',
    description: 'Pomozte nám připravit další BYZON.',
    questionIds: ['returnIntention', 'nextSpeaker', 'partners'],
  },
  {
    id: 'about',
    title: 'Ještě něco o vás',
    description: 'Pomůže nám to lépe poznat účastníky.',
    questionIds: ['city', 'gender', 'genderOther', 'ticketSource', 'instagram'],
  },
];
export const getConferenceFeedbackRole = (
  answers: ConferenceFeedbackAnswers,
): SurveyRole =>
  (CONFERENCE_FEEDBACK_ROLES.some(
    (role) => role.value === answers.participantRole,
  )
    ? answers.participantRole
    : 'attendee') as SurveyRole;
export const getVisibleConferenceFeedbackQuestions = (
  answers: ConferenceFeedbackAnswers,
) =>
  CONFERENCE_FEEDBACK_QUESTIONS.filter(
    (question) =>
      (!question.roles ||
        question.roles.includes(getConferenceFeedbackRole(answers))) &&
      (!question.when || answers[question.when[0]] === question.when[1]),
  );
export const getConferenceFeedbackSteps = (
  answers: ConferenceFeedbackAnswers,
) =>
  CONFERENCE_FEEDBACK_STEPS.filter(
    (step) =>
      !step.roles || step.roles.includes(getConferenceFeedbackRole(answers)),
  );

export type ConferenceFeedbackState = {
  answers: ConferenceFeedbackAnswers;
  currentStep: string;
  completedAt: string | null;
  updatedAt?: string;
  firstName?: string;
  eventName?: string;
  suggestedRole?: SurveyRole;
  program?: EventSurveyProgram | null;
};
