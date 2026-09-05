'use client';

import type {
  ApiFailure,
  ParticipantAnnouncementInboxProblem,
  ParticipantAnnouncementSummary,
} from '@byzon/domain/contracts';
import { ToastRegion } from '@byzon/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserAnnouncementApi,
  requestAnnouncementInbox,
} from '@/lib/announcement-api';
import { subscribeToParticipantAnnouncementRefresh } from '@/lib/participant-announcement-events';

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const MIN_POLL_INTERVAL_MS = 50;
const MAX_VISIBLE_TOASTS = 3;

interface AnnouncementMarker {
  readonly id: string;
  readonly publishedAt: string;
}

const isNewerThan = (
  announcement: AnnouncementMarker,
  marker: AnnouncementMarker | null,
): boolean => {
  if (!marker) return true;
  const publishedAt = Date.parse(announcement.publishedAt);
  const markerPublishedAt = Date.parse(marker.publishedAt);
  return (
    publishedAt > markerPublishedAt ||
    (publishedAt === markerPublishedAt && announcement.id > marker.id)
  );
};

const shouldHideForFailure = (
  failure: ApiFailure<ParticipantAnnouncementInboxProblem>,
): boolean =>
  failure.kind === 'session_expired' ||
  (failure.kind === 'problem' &&
    [
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'EVENT_ACCESS_DENIED',
      'ANNOUNCEMENTS_DISABLED',
    ].includes(failure.problem.code));

const unreadAccessibleLabel = (unreadCount: number | null): string => {
  if (!unreadCount) return 'Oznámení';
  if (unreadCount === 1) return 'Oznámení, 1 nepřečtené oznámení';
  if (unreadCount < 5) {
    return `Oznámení, ${String(unreadCount)} nepřečtená oznámení`;
  }
  return `Oznámení, ${String(unreadCount)} nepřečtených oznámení`;
};

const BellIcon = () => (
  <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 24 24">
    <path
      d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  </svg>
);

const CloseIcon = () => (
  <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 24 24">
    <path
      d="m6 6 12 12M18 6 6 18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
  </svg>
);

export const ParticipantNotificationCenter = ({
  api = browserAnnouncementApi,
  eventId,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: {
  readonly api?: ApiPort;
  readonly eventId: string;
  readonly pollIntervalMs?: number;
}) => {
  const pathname = usePathname();
  const [available, setAvailable] = useState(true);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [toasts, setToasts] = useState<
    readonly ParticipantAnnouncementSummary[]
  >([]);
  const initialized = useRef(false);
  const newest = useRef<AnnouncementMarker | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;
    initialized.current = false;
    newest.current = null;

    const poll = async () => {
      if (activeRequest.current || document.visibilityState === 'hidden') {
        return;
      }
      const controller = new AbortController();
      activeRequest.current = controller;
      try {
        const result = await requestAnnouncementInbox(
          api,
          { filter: 'unread', limit: 10 },
          controller.signal,
        );
        if (!mounted || controller.signal.aborted) return;
        if (!result.ok) {
          if (shouldHideForFailure(result.failure)) {
            setAvailable(false);
            setUnreadCount(null);
            setToasts([]);
          }
          return;
        }
        if (result.kind !== 'success' || result.data.eventId !== eventId) {
          setAvailable(false);
          setUnreadCount(null);
          setToasts([]);
          return;
        }

        setAvailable(true);
        setUnreadCount(result.data.unreadCount);
        const unread = result.data.items.filter(
          (announcement) => announcement.readAt === null,
        );
        const currentNewest = newest.current;
        if (initialized.current) {
          const additions = unread.filter((announcement) =>
            isNewerThan(announcement, currentNewest),
          );
          if (additions.length > 0) {
            setToasts((current) => {
              const known = new Set(current.map(({ id }) => id));
              return [
                ...additions.filter(({ id }) => !known.has(id)),
                ...current,
              ].slice(0, MAX_VISIBLE_TOASTS);
            });
          }
        }
        const first = unread[0];
        if (first && isNewerThan(first, newest.current)) {
          newest.current = {
            id: first.id,
            publishedAt: first.publishedAt,
          };
        }
        initialized.current = true;
      } catch {
        // A transient poll failure must not remove a previously useful badge.
      } finally {
        if (activeRequest.current === controller) {
          activeRequest.current = null;
        }
      }
    };

    const refresh = () => void poll();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    void poll();
    const interval = window.setInterval(
      refresh,
      Math.max(MIN_POLL_INTERVAL_MS, pollIntervalMs),
    );
    const unsubscribe = subscribeToParticipantAnnouncementRefresh(refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      unsubscribe();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [api, eventId, pollIntervalMs]);

  const dismiss = (announcementId: string) =>
    setToasts((current) => current.filter(({ id }) => id !== announcementId));

  if (!available) return null;

  return (
    <>
      <nav aria-label="Rychlý přístup k oznámením">
        <Link
          aria-current={
            pathname === '/app/oznameni' ||
            pathname.startsWith('/app/oznameni/')
              ? 'page'
              : undefined
          }
          aria-label={unreadAccessibleLabel(unreadCount)}
          className="participant-notification-link"
          href="/app/oznameni"
        >
          <span className="participant-notification-icon">
            <BellIcon />
          </span>
          {unreadCount && unreadCount > 0 ? (
            <span aria-hidden="true" className="participant-notification-badge">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Link>
      </nav>

      {toasts.length > 0 ? (
        <ToastRegion label="Nová oznámení">
          {toasts.map((announcement) => (
            <article
              aria-labelledby={`announcement-toast-${announcement.id}`}
              className="announcement-toast"
              key={announcement.id}
            >
              <p className="announcement-toast-label">Nové oznámení</p>
              <h2 id={`announcement-toast-${announcement.id}`}>
                {announcement.title}
              </h2>
              <p className="announcement-toast-summary">
                {announcement.summary}
              </p>
              <Link
                className="announcement-toast-link"
                href={`/app/oznameni/${encodeURIComponent(announcement.id)}`}
                onClick={() => dismiss(announcement.id)}
              >
                Otevřít oznámení
              </Link>
              <button
                aria-label={`Zavřít oznámení „${announcement.title}“`}
                className="announcement-toast-close"
                onClick={() => dismiss(announcement.id)}
                type="button"
              >
                <CloseIcon />
              </button>
            </article>
          ))}
        </ToastRegion>
      ) : null}
    </>
  );
};
