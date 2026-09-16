/** Public, permanent destinations shared by the application and invitation emails. */
export const roleGuides = [
  {
    role: 'participant',
    slug: 'ucastnik',
    title: 'Účastník',
    description: 'Vlastní program, rezervace, networking a dotazy řečníkům.',
  },
  {
    role: 'moderator',
    slug: 'moderator',
    title: 'Moderátor',
    description:
      'Příprava Q&A, práce s dotazy a moderování přidělených bodů programu.',
  },
  {
    role: 'speaker',
    slug: 'recnik',
    title: 'Řečník',
    description:
      'Příprava vystoupení a soukromé odpovědi na dotazy po přednášce.',
  },
  {
    role: 'room_operator',
    slug: 'vedouci-aktivity',
    title: 'Vedoucí aktivity',
    description: 'Přidělené aktivity, kapacita, rezervace a čekací listina.',
  },
  {
    role: 'organizer_admin',
    slug: 'administrator',
    title: 'Administrátor',
    description: 'Program, tým, pozvánky, Q&A a každodenní provoz konference.',
  },
  {
    role: 'checkin_operator',
    slug: 'organizacni-podpora',
    title: 'Organizační podpora',
    description: 'Pomoc na místě a hranice přístupu obsluhy pro ročník 2026.',
  },
] as const;

export type GuideRole = (typeof roleGuides)[number]['role'];
export type GuideSlug = (typeof roleGuides)[number]['slug'];
export const guidePath = (slug: GuideSlug): string => `/navody/${slug}`;

/** Unknown/system roles never become arbitrary URLs or grant any access. */
export const guidesForRoles = (roles: readonly string[]) =>
  roleGuides.filter((guide) => roles.includes(guide.role));
