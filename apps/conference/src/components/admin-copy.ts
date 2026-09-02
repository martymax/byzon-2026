const numberFormatter = new Intl.NumberFormat('cs-CZ');
const pluralRules = new Intl.PluralRules('cs-CZ');

export type CzechCountForms = Readonly<{
  one: string;
  few: string;
  other: string;
}>;

export const formatCzechCount = (
  count: number,
  forms: CzechCountForms,
): string => {
  const category = pluralRules.select(count);
  const form =
    category === 'one'
      ? forms.one
      : category === 'few'
        ? forms.few
        : forms.other;
  return `${numberFormatter.format(count)} ${form}`;
};

export const adminCountForms = {
  activity: { one: 'aktivita', few: 'aktivity', other: 'aktivit' },
  attendee: { one: 'účastník', few: 'účastníci', other: 'účastníků' },
  change: { one: 'změna', few: 'změny', other: 'změn' },
  item: { one: 'položka', few: 'položky', other: 'položek' },
  recipient: { one: 'příjemce', few: 'příjemci', other: 'příjemců' },
  record: { one: 'záznam', few: 'záznamy', other: 'záznamů' },
  waitingTask: {
    one: 'čekající úloha',
    few: 'čekající úlohy',
    other: 'čekajících úloh',
  },
  processingTask: {
    one: 'zpracovávaná úloha',
    few: 'zpracovávané úlohy',
    other: 'zpracovávaných úloh',
  },
  failedTask: {
    one: 'neúspěšná úloha',
    few: 'neúspěšné úlohy',
    other: 'neúspěšných úloh',
  },
} satisfies Record<string, CzechCountForms>;

const forbiddenMainCopyPatterns = [
  /\bF4\b/i,
  /\bP\d+(?:[- ]?\d+)?\b/i,
  /CS-ADMIN/i,
  /online-only/i,
  /event-scoped/i,
  /\b(?:event|session|support|scope)\b/i,
  /\b(?:snapshot|preview|stale|payload|raw|queue|DLQ|apply)\b/i,
  /immutable preview|staging diff|publikační gate/i,
  /auditn[ií]/i,
  /auditovan/i,
  /\baudit\b/i,
  /kanonick/i,
  /idempot/i,
  /checksum|SHA-?256/i,
  /\bslug\b|Markdown/i,
  /asynchron/i,
] as const;

export const findForbiddenAdminMainCopy = (text: string): string | null => {
  for (const pattern of forbiddenMainCopyPatterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
};
