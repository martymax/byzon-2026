'use client';

import type {
  AnnouncementInboxFilter,
  ParticipantAnnouncementInboxResponse,
  ParticipantAnnouncementSummary,
} from '@byzon/domain/contracts';
import { ActionLink, Button, StatePanel } from '@byzon/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import { browserAnnouncementApi } from '@/lib/announcement-api';
import {
  clearAnnouncementReturnContext,
  MAX_ANNOUNCEMENT_RETURN_PAGES,
  readAnnouncementReturnScroll,
  rememberAnnouncementReturnContext,
} from '@/lib/announcement-return-context';
import {
  invalidateParticipantPrivateResources,
  privateResourceInvalidationReason,
} from '@/lib/private-resource-events';
import {
  AnnouncementReadLabel,
  AnnouncementResourceStatus,
  AnnouncementSeverity,
  announcementAuthoritativeFailureStatus,
  formatAnnouncementDate,
  loadParticipantAnnouncementInboxPage,
  type AnnouncementAuthoritativeFailureStatus,
  useParticipantAnnouncementInbox,
} from './announcement-state';

const filterFromSearchParams = (
  searchParams: Pick<URLSearchParams, 'get'>,
): AnnouncementInboxFilter =>
  searchParams.get('view') === 'unread' ? 'unread' : 'all';

const restorePageCountFromSearchParams = (
  searchParams: Pick<URLSearchParams, 'get'>,
): number | null => {
  const raw = searchParams.get('restorePages');
  if (!raw || !/^[1-9][0-9]?$/.test(raw)) return null;
  const value = Number(raw);
  return value <= MAX_ANNOUNCEMENT_RETURN_PAGES ? value : null;
};

const announcementHref = (
  announcementId: string,
  filter: AnnouncementInboxFilter,
  pageCount: number,
): string => {
  const path = `/app/oznameni/${encodeURIComponent(announcementId)}`;
  const search = new URLSearchParams({ returnPages: String(pageCount) });
  if (filter === 'unread') search.set('returnView', 'unread');
  return `${path}?${search.toString()}`;
};

const isStrictlyOlder = (
  next: ParticipantAnnouncementSummary,
  previous: ParticipantAnnouncementSummary,
): boolean => {
  const nextPublishedAt = Date.parse(next.publishedAt);
  const previousPublishedAt = Date.parse(previous.publishedAt);
  return (
    nextPublishedAt < previousPublishedAt ||
    (nextPublishedAt === previousPublishedAt && next.id < previous.id)
  );
};

export const ParticipantInbox = ({
  api = browserAnnouncementApi,
  eventId,
}: {
  readonly api?: ApiPort;
  readonly eventId: string;
}) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filter = filterFromSearchParams(searchParams);
  const restorePageCount = restorePageCountFromSearchParams(searchParams);
  const restoreIdentity =
    restorePageCount === null
      ? null
      : `${eventId}:${filter}:${String(restorePageCount)}`;
  const [validatedRestore, setValidatedRestore] = useState<{
    readonly identity: string;
    readonly pageCount: number;
    readonly scrollY: number;
  } | null>(null);
  const state = useParticipantAnnouncementInbox(filter, eventId, api);
  const discardAnnouncementData = state.discard;
  const [pagination, setPagination] = useState<{
    readonly appendedItems: readonly ParticipantAnnouncementSummary[];
    readonly baseData: ParticipantAnnouncementInboxResponse;
    readonly hasMore: boolean;
    readonly loading: boolean;
    readonly nextCursor: string | null;
    readonly pageCount: number;
    readonly revocationStatus: AnnouncementAuthoritativeFailureStatus | null;
    readonly unreadCount: number;
    readonly failed: boolean;
  } | null>(null);
  const pendingFocus = useRef<
    | { readonly kind: 'announcement'; readonly id: string }
    | { readonly kind: 'error' | 'result' }
    | null
  >(null);
  const activeContext = useRef<{
    readonly data: ParticipantAnnouncementInboxResponse;
    readonly eventId: string;
    readonly filter: AnnouncementInboxFilter;
  } | null>(null);
  const pageRequest = useRef<AbortController | null>(null);
  const paginationError = useRef<HTMLDivElement>(null);
  const resultStatus = useRef<HTMLParagraphElement>(null);
  const routeHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const request = pageRequest.current;
    request?.abort();
    if (pageRequest.current === request) pageRequest.current = null;
    return () => {
      pageRequest.current?.abort();
      pageRequest.current = null;
    };
  }, [api, eventId, filter]);

  useEffect(() => {
    activeContext.current =
      state.status === 'ready' ? { data: state.data, eventId, filter } : null;
  }, [eventId, filter, state]);

  const activePagination =
    state.status === 'ready' && pagination?.baseData === state.data
      ? pagination
      : null;
  const activeRevocation = activePagination?.revocationStatus ?? null;
  const unreadCount =
    state.status === 'ready' && activeRevocation === null
      ? (activePagination?.unreadCount ?? state.data.unreadCount)
      : null;
  const activePageCount = activePagination?.pageCount ?? 1;
  const activeRestore =
    restoreIdentity !== null && validatedRestore?.identity === restoreIdentity
      ? validatedRestore
      : null;

  const clearRestoreContext = useCallback(() => {
    clearAnnouncementReturnContext();
    router.replace(filter === 'unread' ? `${pathname}?view=unread` : pathname, {
      scroll: false,
    });
  }, [filter, pathname, router]);

  useEffect(() => {
    if (restoreIdentity === null || restorePageCount === null) {
      return;
    }
    const scrollY = readAnnouncementReturnScroll(
      eventId,
      filter,
      restorePageCount,
    );
    if (scrollY === null) {
      clearRestoreContext();
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setValidatedRestore((current) =>
        current?.identity === restoreIdentity &&
        current.pageCount === restorePageCount &&
        current.scrollY === scrollY
          ? current
          : {
              identity: restoreIdentity,
              pageCount: restorePageCount,
              scrollY,
            },
      );
    });
    return () => {
      active = false;
    };
  }, [clearRestoreContext, eventId, filter, restoreIdentity, restorePageCount]);

  const hasAuthoritativeBaseFailure =
    state.status === 'authentication' ||
    state.status === 'disabled' ||
    state.status === 'permission' ||
    state.status === 'session_expired';

  useEffect(() => {
    if (
      restoreIdentity !== null &&
      (hasAuthoritativeBaseFailure || activeRevocation !== null)
    ) {
      clearRestoreContext();
    }
  }, [
    activeRevocation,
    clearRestoreContext,
    hasAuthoritativeBaseFailure,
    restoreIdentity,
  ]);

  useEffect(() => {
    if (activeRevocation === null) return;
    requestAnimationFrame(() =>
      routeHeading.current?.focus({ preventScroll: true }),
    );
  }, [activeRevocation]);

  const chooseFilter = (nextFilter: AnnouncementInboxFilter) => {
    if (nextFilter === filter) return;
    pageRequest.current?.abort();
    pageRequest.current = null;
    setPagination(null);
    router.replace(
      nextFilter === 'unread' ? `${pathname}?view=unread` : pathname,
      { scroll: false },
    );
  };

  const loadMore = useCallback(
    async ({ restoring = false }: { readonly restoring?: boolean } = {}) => {
      const context = activeContext.current;
      if (!context || pageRequest.current) return;
      const currentPagination =
        pagination?.baseData === context.data ? pagination : null;
      const nextCursor =
        currentPagination?.nextCursor ?? context.data.pageInfo.nextCursor;
      const hasMore =
        currentPagination?.hasMore ?? context.data.pageInfo.hasMore;
      if (!hasMore || !nextCursor) return;

      const controller = new AbortController();
      pageRequest.current = controller;
      setPagination({
        appendedItems: currentPagination?.appendedItems ?? [],
        baseData: context.data,
        hasMore,
        loading: true,
        nextCursor,
        pageCount: currentPagination?.pageCount ?? 1,
        revocationStatus: null,
        unreadCount: currentPagination?.unreadCount ?? context.data.unreadCount,
        failed: false,
      });

      try {
        const result = await loadParticipantAnnouncementInboxPage(
          api,
          context.filter,
          context.eventId,
          nextCursor,
          controller.signal,
        );
        const current = activeContext.current;
        if (
          controller.signal.aborted ||
          current?.data !== context.data ||
          current.filter !== context.filter ||
          current.eventId !== context.eventId
        ) {
          return;
        }
        if (!result.ok) {
          const reason = privateResourceInvalidationReason(
            result.failure,
            result.status,
          );
          const revocationStatus =
            announcementAuthoritativeFailureStatus(result.failure) ?? reason;
          if (reason) {
            invalidateParticipantPrivateResources(reason);
          }
          if (revocationStatus) {
            discardAnnouncementData(revocationStatus);
            setPagination(null);
            requestAnimationFrame(() =>
              routeHeading.current?.focus({ preventScroll: true }),
            );
            return;
          }
        }
        if (!result.ok) {
          if (!restoring) {
            pendingFocus.current = { kind: 'error' };
          }
          setPagination({
            appendedItems: currentPagination?.appendedItems ?? [],
            baseData: context.data,
            hasMore,
            loading: false,
            nextCursor,
            pageCount: currentPagination?.pageCount ?? 1,
            revocationStatus: null,
            unreadCount:
              currentPagination?.unreadCount ?? context.data.unreadCount,
            failed: true,
          });
          return;
        }
        if (result.kind !== 'success') {
          if (!restoring) pendingFocus.current = { kind: 'error' };
          setPagination({
            appendedItems: currentPagination?.appendedItems ?? [],
            baseData: context.data,
            hasMore,
            loading: false,
            nextCursor,
            pageCount: currentPagination?.pageCount ?? 1,
            revocationStatus: null,
            unreadCount:
              currentPagination?.unreadCount ?? context.data.unreadCount,
            failed: true,
          });
          return;
        }

        const existingItems = [
          ...context.data.items,
          ...(currentPagination?.appendedItems ?? []),
        ];
        const existingIds = new Set(existingItems.map(({ id }) => id));
        const hasDuplicate = result.data.items.some(({ id }) =>
          existingIds.has(id),
        );
        const lastExistingItem = existingItems.at(-1);
        const firstNextItem = result.data.items[0];
        const keepsGlobalOrder =
          !lastExistingItem ||
          !firstNextItem ||
          isStrictlyOlder(firstNextItem, lastExistingItem);
        if (hasDuplicate || !keepsGlobalOrder) {
          if (!restoring) pendingFocus.current = { kind: 'error' };
          setPagination({
            appendedItems: currentPagination?.appendedItems ?? [],
            baseData: context.data,
            hasMore,
            loading: false,
            nextCursor,
            pageCount: currentPagination?.pageCount ?? 1,
            revocationStatus: null,
            unreadCount:
              currentPagination?.unreadCount ?? context.data.unreadCount,
            failed: true,
          });
          return;
        }

        if (!restoring) {
          pendingFocus.current = firstNextItem
            ? { kind: 'announcement', id: firstNextItem.id }
            : { kind: 'result' };
        }
        setPagination({
          appendedItems: [
            ...(currentPagination?.appendedItems ?? []),
            ...result.data.items,
          ],
          baseData: context.data,
          hasMore: result.data.pageInfo.hasMore,
          loading: false,
          nextCursor: result.data.pageInfo.nextCursor,
          pageCount: (currentPagination?.pageCount ?? 1) + 1,
          revocationStatus: null,
          unreadCount: result.data.unreadCount,
          failed: false,
        });
      } catch {
        if (!controller.signal.aborted) {
          if (!restoring) pendingFocus.current = { kind: 'error' };
          setPagination({
            appendedItems: currentPagination?.appendedItems ?? [],
            baseData: context.data,
            hasMore,
            loading: false,
            nextCursor,
            pageCount: currentPagination?.pageCount ?? 1,
            revocationStatus: null,
            unreadCount:
              currentPagination?.unreadCount ?? context.data.unreadCount,
            failed: true,
          });
        }
      } finally {
        if (pageRequest.current === controller) {
          pageRequest.current = null;
        }
      }
    },
    [api, discardAnnouncementData, pagination],
  );

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || activePagination?.loading) return;
    pendingFocus.current = null;
    const frame = requestAnimationFrame(() => {
      if (target.kind === 'announcement') {
        document
          .getElementById(`announcement-card-${target.id}`)
          ?.focus({ preventScroll: true });
        return;
      }
      if (target.kind === 'error') {
        paginationError.current?.focus({ preventScroll: true });
        return;
      }
      resultStatus.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [activePagination]);

  const activeHasMore =
    activePagination?.hasMore ??
    (state.status === 'ready' ? state.data.pageInfo.hasMore : false);

  useEffect(() => {
    if (
      activeRestore === null ||
      state.status !== 'ready' ||
      activeRevocation !== null ||
      activePageCount >= activeRestore.pageCount ||
      !activeHasMore ||
      activePagination?.loading ||
      activePagination?.failed
    ) {
      return;
    }
    void loadMore({ restoring: true });
  }, [
    activeHasMore,
    activePageCount,
    activePagination?.failed,
    activePagination?.loading,
    activeRevocation,
    activeRestore,
    loadMore,
    state.status,
  ]);

  useEffect(() => {
    if (
      activeRestore === null ||
      state.status !== 'ready' ||
      activeRevocation !== null ||
      activePagination?.loading ||
      (activePageCount < activeRestore.pageCount &&
        activeHasMore &&
        !activePagination?.failed)
    ) {
      return;
    }

    clearRestoreContext();
    requestAnimationFrame(() =>
      window.scrollTo({
        behavior: 'auto',
        left: 0,
        top: activeRestore.scrollY,
      }),
    );
  }, [
    activeHasMore,
    activePageCount,
    activePagination?.failed,
    activePagination?.loading,
    activeRevocation,
    activeRestore,
    clearRestoreContext,
    state.status,
  ]);

  const heading = (
    <header className="announcement-heading">
      <p className="eyebrow">Důležité změny na jednom místě</p>
      <h1 data-route-heading ref={routeHeading} tabIndex={-1}>
        Oznámení
      </h1>
      <p className="lead">
        Provozní zprávy od organizátorů, které patří k vašemu účtu a této akci.
      </p>
    </header>
  );

  const visibleItems =
    state.status === 'ready' && activeRevocation === null
      ? [...state.data.items, ...(activePagination?.appendedItems ?? [])]
      : [];
  const failureState =
    activeRevocation !== null
      ? ({ status: activeRevocation } as const)
      : state.status === 'ready'
        ? null
        : state;

  return (
    <section className="app-page announcement-page">
      {heading}

      <div
        aria-label="Zobrazená oznámení"
        className="announcement-filter"
        role="group"
      >
        <button
          aria-pressed={filter === 'all'}
          onClick={() => chooseFilter('all')}
          type="button"
        >
          Všechna
        </button>
        <button
          aria-pressed={filter === 'unread'}
          onClick={() => chooseFilter('unread')}
          type="button"
        >
          {unreadCount === null ? 'Nepřečtená' : `Nepřečtená (${unreadCount})`}
        </button>
      </div>

      {failureState ? (
        <AnnouncementResourceStatus
          loginReturnTo={
            filter === 'unread' ? '/app/oznameni?view=unread' : '/app/oznameni'
          }
          onRetry={state.retry}
          scope="inbox"
          state={failureState}
        />
      ) : state.status === 'ready' ? (
        <>
          <p
            className="announcement-result-count"
            ref={resultStatus}
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
            {visibleItems.length === 1
              ? '1 zobrazené oznámení'
              : `${visibleItems.length} zobrazená oznámení`}
          </p>

          {visibleItems.length === 0 ? (
            filter === 'unread' ? (
              <StatePanel
                action={
                  <button
                    className="resource-action"
                    onClick={() => chooseFilter('all')}
                    type="button"
                  >
                    Zobrazit všechna
                  </button>
                }
                kind="empty"
                title="Všechna oznámení máte přečtená"
              >
                <p>K nepřečtení tu teď nic nezbývá.</p>
              </StatePanel>
            ) : (
              <StatePanel
                action={
                  <ActionLink href="/app/program" variant="secondary">
                    Otevřít program
                  </ActionLink>
                }
                kind="empty"
                title="Zatím tu nejsou žádná oznámení"
              >
                <p>
                  Nové provozní zprávy se po zveřejnění objeví přímo v tomto
                  přehledu.
                </p>
              </StatePanel>
            )
          ) : (
            <ol className="announcement-list">
              {visibleItems.map((announcement) => {
                const unread = announcement.readAt === null;
                return (
                  <li key={announcement.id}>
                    <Link
                      className={`announcement-card${
                        unread ? ' announcement-card--unread' : ''
                      }`}
                      href={announcementHref(
                        announcement.id,
                        filter,
                        activePageCount,
                      )}
                      id={`announcement-card-${announcement.id}`}
                      onClick={() =>
                        rememberAnnouncementReturnContext(
                          eventId,
                          filter,
                          activePageCount,
                          window.scrollY,
                        )
                      }
                    >
                      <div className="announcement-card-topline">
                        <AnnouncementReadLabel unread={unread} />
                        <time dateTime={announcement.publishedAt}>
                          {formatAnnouncementDate(announcement.publishedAt)}
                        </time>
                      </div>
                      <h2>{announcement.title}</h2>
                      <p className="announcement-card-summary">
                        {announcement.summary}
                      </p>
                      <AnnouncementSeverity severity={announcement.severity} />
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}

          {activePagination?.failed ? (
            <div
              className="announcement-pagination-error"
              ref={paginationError}
              role="alert"
              tabIndex={-1}
            >
              <strong>Další oznámení se nepodařilo načíst</strong>
              <p>Zobrazené zprávy zůstávají dostupné. Zkuste načtení znovu.</p>
              <Button onClick={() => void loadMore()}>Zkusit znovu</Button>
            </div>
          ) : null}

          {!activePagination?.failed &&
          (activePagination?.hasMore ?? state.data.pageInfo.hasMore) ? (
            <Button
              disabled={activePagination?.loading ?? false}
              onClick={() => void loadMore()}
              variant="secondary"
            >
              {activePagination?.loading
                ? 'Načítám další…'
                : 'Načíst další oznámení'}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
};
