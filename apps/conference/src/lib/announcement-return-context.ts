import type { AnnouncementInboxFilter } from '@byzon/domain/contracts';

export const ANNOUNCEMENT_RETURN_STATE_KEY = 'byzon:announcement-return:v1';
export const MAX_ANNOUNCEMENT_RETURN_PAGES = 20;

export const rememberAnnouncementReturnContext = (
  eventId: string,
  filter: AnnouncementInboxFilter,
  pageCount: number,
  scrollY: number,
): void => {
  if (
    typeof window === 'undefined' ||
    !Number.isSafeInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > MAX_ANNOUNCEMENT_RETURN_PAGES ||
    !Number.isFinite(scrollY)
  ) {
    return;
  }
  const boundedScrollY = Math.min(10_000_000, Math.max(0, Math.round(scrollY)));
  try {
    window.sessionStorage.setItem(
      ANNOUNCEMENT_RETURN_STATE_KEY,
      JSON.stringify({
        eventId,
        filter,
        pageCount,
        scrollY: boundedScrollY,
      }),
    );
  } catch {
    // The return link remains usable when storage is unavailable.
  }
};

export const readAnnouncementReturnScroll = (
  eventId: string,
  filter: AnnouncementInboxFilter,
  pageCount: number,
): number | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ANNOUNCEMENT_RETURN_STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Object.keys(parsed).sort().join(',') !==
        'eventId,filter,pageCount,scrollY' ||
      !('eventId' in parsed) ||
      parsed.eventId !== eventId ||
      !('filter' in parsed) ||
      parsed.filter !== filter ||
      !('pageCount' in parsed) ||
      parsed.pageCount !== pageCount ||
      !('scrollY' in parsed) ||
      typeof parsed.scrollY !== 'number' ||
      !Number.isSafeInteger(parsed.scrollY) ||
      parsed.scrollY < 0 ||
      parsed.scrollY > 10_000_000
    ) {
      return null;
    }
    return parsed.scrollY;
  } catch {
    return null;
  }
};

export const clearAnnouncementReturnContext = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ANNOUNCEMENT_RETURN_STATE_KEY);
  } catch {
    // There is nothing else to clear when storage is unavailable.
  }
};
