'use client';

import { Button } from '@byzon/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  participantTourDestination,
  participantTourHref,
  participantTourSteps,
  resolveParticipantTour,
  type ParticipantTourStep,
} from '@/lib/participant-tour';
import { subscribeToPrivateResourceInvalidation } from '@/lib/private-resource-events';

type Placement = { left: number; top?: number; bottom?: number; width: number };
const visibleTarget = (selectors: readonly string[]): HTMLElement | null => {
  for (const selector of selectors) {
    const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
      (item) => {
        const rect = item.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          getComputedStyle(item).visibility !== 'hidden'
        );
      },
    );
    if (element) return element;
  }
  return null;
};

function ActiveParticipantTour({
  step,
  sessionId,
}: {
  readonly step: ParticipantTourStep;
  readonly sessionId: string | null;
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [available, setAvailable] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const index = participantTourSteps.indexOf(step);
  const close = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('pruvodce');
    url.searchParams.delete('aktivita');
    routerRef.current.replace(`${url.pathname}${url.search}${url.hash}`, {
      scroll: false,
    });
    document
      .querySelector<HTMLElement>('[data-route-heading]')
      ?.focus({ preventScroll: true });
  }, []);

  useEffect(
    () =>
      subscribeToPrivateResourceInvalidation((reason) => {
        if (reason === 'session_expired') close();
      }),
    [close],
  );
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      heading.current?.focus({ preventScroll: true }),
    );
    const key = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !document.querySelector('[aria-modal="true"], dialog[open]')
      )
        close();
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href]')
          : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download'))
        return;
      const href = participantTourDestination(
        link.href,
        window.location.origin,
        sessionId,
      );
      if (!href) return;
      event.preventDefault();
      routerRef.current.push(href);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('click', click, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', key);
      document.removeEventListener('click', click, true);
    };
  }, [close, sessionId]);

  useEffect(() => {
    let frame = 0;
    let highlighted: HTMLElement | null = null;
    let positioned: HTMLElement | null = null;
    const measure = () => {
      frame = 0;
      const modal = Boolean(
        document.querySelector('[aria-modal="true"], dialog[open]'),
      );
      setModalOpen(modal);
      const next = modal ? null : visibleTarget(step.selectors);
      if (next !== highlighted) {
        highlighted?.removeAttribute('data-tour-highlight');
        highlighted = next;
        target.current = next;
        if (next) {
          next.setAttribute('data-tour-highlight', 'true');
          next.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: 'instant',
          });
        }
      }
      setAvailable(Boolean(next));
      if (!panel.current || modal) return;
      const width = Math.min(368, window.innerWidth - 32);
      const height = panel.current.getBoundingClientRect().height;
      const rect = next?.getBoundingClientRect();
      const gap = 20;
      let position: Placement = {
        width,
        left: window.innerWidth - width - 16,
        bottom: window.innerWidth < 900 ? 88 : 24,
      };
      if (rect && window.innerWidth >= 900 && !collapsed) {
        const side =
          rect.right + gap + width <= window.innerWidth - 16
            ? rect.right + gap
            : rect.left - gap - width >= 16
              ? rect.left - gap - width
              : null;
        if (side !== null)
          position = {
            width,
            left: side,
            top: Math.max(
              24,
              Math.min(rect.top, window.innerHeight - height - 24),
            ),
          };
        else if (rect.bottom + gap + height < window.innerHeight - 24)
          position = {
            width,
            left: Math.max(
              16,
              Math.min(rect.left, window.innerWidth - width - 16),
            ),
            top: rect.bottom + gap,
          };
        else if (rect.top - height - gap > 24)
          position = {
            width,
            left: Math.max(
              16,
              Math.min(rect.left, window.innerWidth - width - 16),
            ),
            top: rect.top - height - gap,
          };
      }
      if (
        rect &&
        next &&
        positioned !== next &&
        position.bottom !== undefined
      ) {
        positioned = next;
        const panelTop = window.innerHeight - position.bottom - height;
        // Reserve the area above the callout on compact screens. Do this once
        // for a new target so subsequent user scrolling remains under their control.
        if (rect.bottom > panelTop - 16 && rect.top > 64) {
          window.scrollBy({ top: rect.top - 64, behavior: 'instant' });
        }
      }
      setPlacement((previous) =>
        previous && JSON.stringify(previous) === JSON.stringify(position)
          ? previous
          : position,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'class', 'open', 'aria-modal'],
    });
    const resize = new ResizeObserver(schedule);
    if (panel.current) resize.observe(panel.current);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      highlighted?.removeAttribute('data-tour-highlight');
      target.current = null;
    };
  }, [step, collapsed]);

  // Keep editable application controls usable: collapse the callout when keyboard
  // focus would be covered by it. Native confirmation dialogs take precedence.
  useEffect(() => {
    let lastUserInput = -Infinity;
    const input = () => {
      lastUserInput = performance.now();
    };
    const focus = (event: FocusEvent) => {
      if (performance.now() - lastUserInput > 300) return;
      const element = event.target;
      if (
        !(element instanceof HTMLElement) ||
        !panel.current ||
        panel.current.contains(element)
      )
        return;
      const rect = element.getBoundingClientRect();
      const box = panel.current.getBoundingClientRect();
      if (
        rect.bottom > box.top &&
        rect.top < box.bottom &&
        rect.right > box.left &&
        rect.left < box.right
      ) {
        setCollapsed(true);
        requestAnimationFrame(() =>
          element.scrollIntoView({ block: 'center', behavior: 'instant' }),
        );
      }
    };
    document.addEventListener('focusin', focus);
    document.addEventListener('keydown', input);
    document.addEventListener('pointerdown', input);
    return () => {
      document.removeEventListener('focusin', focus);
      document.removeEventListener('keydown', input);
      document.removeEventListener('pointerdown', input);
    };
  }, []);

  const next = () => {
    if (step.id === 'help') {
      close();
      return;
    }
    if (step.id === 'program') {
      const link = target.current?.closest<HTMLAnchorElement>('a[href]');
      const destination =
        link &&
        participantTourDestination(
          link.href,
          window.location.origin,
          sessionId,
        );
      routerRef.current.push(
        destination ?? participantTourHref('agenda', sessionId),
      );
      return;
    }
    routerRef.current.push(
      participantTourHref(participantTourSteps[index + 1]!.id, sessionId),
    );
  };
  const previous = () =>
    routerRef.current.push(
      participantTourHref(participantTourSteps[index - 1]!.id, sessionId),
    );
  const focusTarget = () => {
    const element = target.current;
    if (!element) return;
    setCollapsed(true);
    requestAnimationFrame(() => {
      const control = element.matches('a,button,input,select,textarea')
        ? element
        : element.querySelector<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select,textarea',
          );
      (control ?? element).focus({ preventScroll: true });
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  };

  return (
    <aside
      ref={panel}
      aria-labelledby="participant-tour-heading"
      className={`participant-tour${collapsed ? ' participant-tour--collapsed' : ''}`}
      style={{
        ...(placement as CSSProperties),
        visibility: placement && !modalOpen ? 'visible' : 'hidden',
      }}
    >
      <div className="participant-tour-top">
        <p className="eyebrow">
          Průvodce · {index + 1} z {participantTourSteps.length}
        </p>
        <div>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-controls="participant-tour-body"
          >
            {collapsed ? 'Rozbalit' : 'Sbalit'}
          </button>
          <button type="button" onClick={close} aria-label="Ukončit průvodce">
            ×
          </button>
        </div>
      </div>
      <h2 id="participant-tour-heading" ref={heading} tabIndex={-1}>
        {step.title}
      </h2>
      <div id="participant-tour-body" hidden={collapsed}>
        <p>{available ? step.text : step.missing}</p>
        {available ? (
          <button
            className="text-link participant-tour-target-action"
            type="button"
            onClick={focusTarget}
          >
            Přejít na zvýrazněné místo
          </button>
        ) : null}
        <div className="participant-tour-actions">
          {index > 0 ? (
            <Button variant="secondary" onClick={previous}>
              Zpět
            </Button>
          ) : null}
          <Button onClick={next}>
            {step.id === 'program' && !available
              ? 'Pokračovat do agendy'
              : step.next}
          </Button>
        </div>
        {step.id === 'program' && available ? (
          <button
            className="text-link participant-tour-skip"
            type="button"
            onClick={() =>
              routerRef.current.push(participantTourHref('agenda', sessionId))
            }
          >
            Přeskočit výběr aktivity
          </button>
        ) : null}
      </div>
    </aside>
  );
}

export function ParticipantTour() {
  const pathname = usePathname();
  const query = useSearchParams();
  const tour = resolveParticipantTour(pathname, query);
  return tour ? (
    <ActiveParticipantTour key={`${pathname}:${tour.step.id}`} {...tour} />
  ) : null;
}
