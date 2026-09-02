const PARTICIPANT_ANNOUNCEMENT_REFRESH_EVENT =
  'byzon:participant-announcement-refresh';

export const publishParticipantAnnouncementRefresh = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PARTICIPANT_ANNOUNCEMENT_REFRESH_EVENT));
};

export const subscribeToParticipantAnnouncementRefresh = (
  listener: () => void,
): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(PARTICIPANT_ANNOUNCEMENT_REFRESH_EVENT, listener);
  return () =>
    window.removeEventListener(
      PARTICIPANT_ANNOUNCEMENT_REFRESH_EVENT,
      listener,
    );
};
