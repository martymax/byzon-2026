import type { AdminPublicationChange } from '@byzon/domain/contracts';

type Item = Readonly<Record<string, unknown>>;
type Collections = Readonly<Record<string, readonly Item[]>>;

const labels: Record<string, string> = {
  title: 'Název',
  name: 'Název',
  slug: 'Adresa (slug)',
  description: 'Popis',
  descriptionMarkdown: 'Popis',
  summary: 'Shrnutí',
  bodyMarkdown: 'Obsah',
  question: 'Otázka',
  answerMarkdown: 'Odpověď',
  firstName: 'Jméno',
  lastName: 'Příjmení',
  company: 'Společnost',
  jobTitle: 'Pozice',
  bioMarkdown: 'Medailonek',
  startsAt: 'Začátek',
  endsAt: 'Konec',
  localDate: 'Datum',
  reservationOpensAt: 'Otevření rezervací',
  reservationClosesAt: 'Uzavření rezervací',
  roomId: 'Sál',
  venueId: 'Místo',
  dayId: 'Den',
  speakerIds: 'Řečníci',
  sessionIds: 'Body programu',
  status: 'Stav',
  sortOrder: 'Pořadí',
  version: 'Verze záznamu',
  capacity: 'Kapacita',
  type: 'Typ',
  kind: 'Druh stránky',
  questionsEnabled: 'Dotazy účastníků',
  category: 'Kategorie',
  tier: 'Úroveň partnerství',
  websiteUrl: 'Web',
  linkedinUrl: 'LinkedIn',
  instagramUrl: 'Instagram',
  facebookUrl: 'Facebook',
  photoAssetId: 'Fotografie',
  logoAssetId: 'Logo',
  mapQuery: 'Místo pro mapu',
  navigationMarkdown: 'Jak se dostat na místo',
  accessibilityMarkdown: 'Přístupnost',
  addressLine1: 'Adresa',
  addressLine2: 'Doplnění adresy',
  city: 'Město',
  postalCode: 'PSČ',
  countryCode: 'Země',
};
const references: Record<string, string> = {
  roomId: 'rooms',
  venueId: 'venues',
  dayId: 'days',
  speakerIds: 'speakers',
  sessionIds: 'sessions',
};
const valueLabels: Record<string, string> = {
  published: 'Zveřejněno',
  cancelled: 'Zrušeno',
  archived: 'Archivováno',
  draft: 'Koncept',
  talk: 'Přednáška',
  workshop: 'Workshop',
  break: 'Přestávka',
  practical: 'Praktické informace',
  marketing: 'Marketing',
  other: 'Ostatní',
};

const displayValue = (
  field: string,
  value: unknown,
  collections: Collections,
): string | null => {
  if (value === null || value === undefined) return null;
  if (references[field]) {
    const items = collections[references[field]] ?? [];
    return (Array.isArray(value) ? value : [value])
      .map((id) => {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) return 'Nedostupná položka';
        return String(
          item.title ??
            item.name ??
            (item.firstName
              ? `${item.firstName} ${item.lastName}`
              : item.localDate),
        );
      })
      .join('\n');
  }
  if (typeof value === 'boolean') return value ? 'Ano' : 'Ne';
  if (['status', 'type', 'kind'].includes(field))
    return valueLabels[String(value)] ?? String(value);
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

// Compare the frozen publication snapshots, including original reference names.
export const publicationFieldDiff = (
  before: Item | undefined,
  after: Item | undefined,
  previousCollections: Collections,
  currentCollections: Collections,
): NonNullable<AdminPublicationChange['fields']> =>
  Object.keys({ ...before, ...after })
    .filter(
      (field) =>
        !['id', 'eventId', 'userId', 'createdAt', 'updatedAt'].includes(field),
    )
    .filter(
      (field) =>
        JSON.stringify(before?.[field] ?? null) !==
        JSON.stringify(after?.[field] ?? null),
    )
    .map((field) => ({
      field,
      label: labels[field] ?? field,
      before: displayValue(field, before?.[field], previousCollections),
      after: displayValue(field, after?.[field], currentCollections),
    }));
