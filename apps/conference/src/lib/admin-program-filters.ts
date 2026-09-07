import type { AdminContentItem } from './admin-content-api';

export const emptyProgramFilters = {
  title: '',
  dayId: '',
  roomId: '',
  venueId: '',
  speakerId: '',
  type: '',
  status: '',
  publicationState: '',
  questionMode: '',
  startsFrom: '',
  startsTo: '',
  endsFrom: '',
  endsTo: '',
};
export type ProgramFilters = typeof emptyProgramFilters;
export const normalizeProgramSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ');
export function matchesProgramFilters(
  item: AdminContentItem,
  filters: ProgramFilters,
  rooms: readonly AdminContentItem[],
  timezone: string,
) {
  if (
    !normalizeProgramSearch(String(item.title ?? '')).includes(
      normalizeProgramSearch(filters.title.trim()),
    )
  )
    return false;
  for (const key of [
    'dayId',
    'roomId',
    'type',
    'status',
    'publicationState',
    'questionMode',
  ] as const) {
    if (!filters[key]) continue;
    if (
      filters[key] === '__none'
        ? Boolean(item[key])
        : String(item[key] ?? '') !== filters[key]
    )
      return false;
  }
  if (
    filters.venueId &&
    String(rooms.find((room) => room.id === item.roomId)?.venueId ?? '') !==
      filters.venueId
  )
    return false;
  const speakers = Array.isArray(item.speakerIds) ? item.speakerIds : [];
  if (
    filters.speakerId &&
    (filters.speakerId === '__none'
      ? speakers.length > 0
      : !speakers.includes(filters.speakerId))
  )
    return false;
  for (const [key, from, to] of [
    ['startsAt', 'startsFrom', 'startsTo'],
    ['endsAt', 'endsFrom', 'endsTo'],
  ] as const) {
    if (!filters[from] && !filters[to]) continue;
    const date = new Date(String(item[key]));
    if (Number.isNaN(date.getTime())) return false;
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    if (
      (filters[from] && time < filters[from]) ||
      (filters[to] && time > filters[to])
    )
      return false;
  }
  return true;
}
