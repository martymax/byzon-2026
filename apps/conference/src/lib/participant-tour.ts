export const participantTourSteps = [
  {
    id: 'program',
    path: '/app/program',
    title: 'Vyberte si aktivitu v programu',
    text: 'Otevřete zvýrazněnou aktivitu nebo si vyberte jinou. V jejím detailu najdete čas, místo a možnosti účasti.',
    selectors: [
      '[data-tour="program-session"][data-tour-recommended="true"]',
      '[data-tour="program-session"]',
    ],
    missing:
      'Aktivity zatím nejsou dostupné. Můžete počkat na načtení programu nebo pokračovat do agendy.',
    next: 'Otevřít detail aktivity',
  },
  {
    id: 'detail',
    path: '/app/program/',
    title: 'Vaše účast u aktivity',
    text: 'Zde můžete aktivitu přidat do agendy nebo spravovat uloženou účast. Dostupné možnosti závisí na aktivitě a vašem aktuálním stavu. U kapacitně omezené aktivity si místo zajistíte až samostatnou rezervací.',
    selectors: [
      '[data-tour="agenda-action"]',
      '[data-tour="coaching-choices"]',
    ],
    missing:
      'U této aktivity teď není akce pro osobní agendu dostupná. Můžete vybrat jinou aktivitu nebo pokračovat.',
    next: 'Pokračovat do agendy',
  },
  {
    id: 'agenda',
    path: '/app/agenda',
    title: 'Zkontrolujte svůj osobní program',
    text: 'V agendě vidíte uložené aktivity, potvrzené rezervace i čekací listinu. Pokud jste si právě přidali aktivitu, najdete ji zde. Další změny provedete přímo u příslušné položky.',
    selectors: ['[data-tour="agenda-item"]', '[data-tour="agenda-heading"]'],
    missing:
      'Agenda se teď nezobrazuje. Můžete ji zkusit načíst znovu nebo pokračovat.',
    next: 'Prohlédnout networking',
  },
  {
    id: 'networking',
    path: '/app/networking',
    title: 'Nastavte viditelnost svého profilu',
    text: 'Tady rozhodnete, zda se zobrazíte ostatním účastníkům. Projděte si údaje a kontakty níže; zveřejnění potvrďte až po jejich kontrole a uložení. Networking je dobrovolný.',
    selectors: ['[data-tour="networking-visibility"]'],
    missing:
      'Nastavení networkingu pro tento účet teď není dostupné. Tento krok můžete přeskočit.',
    next: 'Zobrazit oznámení',
  },
  {
    id: 'announcements',
    path: '/app/oznameni',
    title: 'Sledujte zprávy od organizátorů',
    text: 'Zde najdete oznámení určená vašemu účtu. Otevřete zprávu, která vás zajímá. Na oznámení se dostanete také přes zvonek v aplikaci.',
    selectors: [
      '[data-tour="announcement-message"]',
      '[data-tour="announcements"]',
    ],
    missing:
      'Oznámení pro tento účet teď nejsou dostupná. Můžete pokračovat k nápovědě.',
    next: 'Kde najdu pomoc',
  },
  {
    id: 'help',
    path: '/app/napoveda',
    title: 'Nápověda je kdykoliv po ruce',
    text: 'Zkuste vyhledat téma, které potřebujete vyřešit. Nápovědu, časté otázky i opětovné spuštění průvodce najdete vždy pod ikonou otazníku v horní liště.',
    selectors: ['[data-tour="help-search"]'],
    missing: 'Nápovědu najdete pod ikonou otazníku v horní liště.',
    next: 'Dokončit průvodce',
  },
] as const;

export type ParticipantTourStep = (typeof participantTourSteps)[number];
export type ParticipantTourStepId = ParticipantTourStep['id'];
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isAnnouncementDetail = (path: string) => {
  const value = path.match(/^\/app\/oznameni\/([^/]+)$/)?.[1];
  return Boolean(value && uuidPattern.test(value));
};
const detailId = (path: string): string | null => {
  const value = path.match(/^\/app\/program\/([^/]+)$/)?.[1];
  return value && uuidPattern.test(value) ? value : null;
};

export function resolveParticipantTour(path: string, query: URLSearchParams) {
  const step = participantTourSteps.find(
    (candidate) => candidate.id === query.get('pruvodce'),
  );
  if (
    !step ||
    (step.id === 'detail'
      ? !detailId(path)
      : path !== step.path &&
        !(step.id === 'announcements' && isAnnouncementDetail(path)))
  )
    return null;
  const selected = detailId(path) ?? query.get('aktivita');
  return {
    step,
    sessionId: selected && uuidPattern.test(selected) ? selected : null,
  };
}

export function participantTourHref(
  id: ParticipantTourStepId,
  sessionId: string | null = null,
): string {
  const validId = sessionId && uuidPattern.test(sessionId) ? sessionId : null;
  if (id === 'detail' && !validId) return participantTourHref('program');
  const step = participantTourSteps.find((item) => item.id === id)!;
  const query = new URLSearchParams({ pruvodce: id });
  if (validId && id !== 'detail') query.set('aktivita', validId);
  return `${step.path}${id === 'detail' ? validId : ''}?${query}`;
}

// Preserve the guide only for real navigation within its known application pages.
// No action endpoint or external link can be turned into a tour destination.
export function participantTourDestination(
  href: string,
  origin: string,
  sessionId: string | null,
): string | null {
  const url = new URL(href, origin);
  if (url.origin !== origin || url.hash) return null;
  const selected = detailId(url.pathname);
  const step = selected
    ? participantTourSteps[1]
    : isAnnouncementDetail(url.pathname)
      ? participantTourSteps[4]
      : participantTourSteps.find((item) => item.path === url.pathname);
  if (!step) return null;
  url.searchParams.set('pruvodce', step.id);
  if (sessionId && !selected && uuidPattern.test(sessionId))
    url.searchParams.set('aktivita', sessionId);
  return `${url.pathname}${url.search}`;
}

export function preserveParticipantTourNavigation(
  destination: string,
  currentHref: string,
): string {
  const current = new URL(currentHref);
  const tour = resolveParticipantTour(current.pathname, current.searchParams);
  return tour
    ? (participantTourDestination(
        destination,
        current.origin,
        tour.sessionId,
      ) ?? destination)
    : destination;
}
