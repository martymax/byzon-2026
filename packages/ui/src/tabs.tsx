'use client';

import { useRef, type KeyboardEvent } from 'react';

export interface TabItem {
  id: string;
  label: string;
  panelId: string;
}

export const Tabs = ({
  activeTabId,
  items,
  label = 'Sekce',
  onSelect,
}: {
  activeTabId: string;
  items: TabItem[];
  label?: string;
  onSelect: (id: string) => void;
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
        [],
    );
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex === -1 || tabs.length === 0) return;

    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex +
              (event.key === 'ArrowRight' ? 1 : -1) +
              tabs.length) %
            tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    nextTab.focus();
    const nextItem = items[nextIndex];
    if (nextItem) onSelect(nextItem.id);
  };

  return (
    <div className="ui-tabs" aria-label={label} ref={listRef} role="tablist">
      {items.map((item) => (
        <button
          aria-controls={item.panelId}
          aria-selected={item.id === activeTabId}
          id={`${item.id}-tab`}
          key={item.id}
          onClick={() => onSelect(item.id)}
          onKeyDown={moveFocus}
          role="tab"
          tabIndex={item.id === activeTabId ? 0 : -1}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};
