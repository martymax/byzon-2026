import type {
  CSSProperties,
  HTMLAttributes,
  LiHTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
} from 'react';
import { joinClassNames } from './utils';

export const Card = ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
  <article {...props} className={joinClassNames('ui-card', className)} />
);

export interface NavigationItem {
  href: string;
  icon: ReactNode;
  id: string;
  label: string;
}

const NavigationItems = ({
  activeItemId,
  items,
}: {
  activeItemId: string;
  items: NavigationItem[];
}) => (
  <ul>
    {items.map((item) => (
      <li key={item.id}>
        <a
          aria-current={item.id === activeItemId ? 'page' : undefined}
          href={item.href}
        >
          <span className="ui-navigation__icon" aria-hidden="true">
            {item.icon}
          </span>
          <span>{item.label}</span>
        </a>
      </li>
    ))}
  </ul>
);

export const ParticipantNavigation = ({
  activeItemId,
  contextAction,
  items,
  label = 'Hlavní navigace',
}: {
  activeItemId: string;
  contextAction?: NavigationItem;
  items: NavigationItem[];
  label?: string;
}) => {
  if (items.length > 5) {
    throw new Error('ParticipantNavigation supports at most five items.');
  }
  return (
    <>
      <nav
        className="ui-participant-nav"
        aria-label={label}
        style={{ '--ui-nav-count': items.length } as CSSProperties}
      >
        <div className="ui-participant-nav__inner">
          <NavigationItems activeItemId={activeItemId} items={items} />
          {contextAction ? (
            <a
              className="ui-participant-nav__context"
              href={contextAction.href}
            >
              <span className="ui-navigation__icon" aria-hidden="true">
                {contextAction.icon}
              </span>
              <span>{contextAction.label}</span>
            </a>
          ) : null}
        </div>
      </nav>
      <div className="ui-participant-nav-spacer" aria-hidden="true" />
    </>
  );
};

export const AdminNavigation = ({
  activeItemId,
  items,
  label = 'Administrace',
}: {
  activeItemId: string;
  items: NavigationItem[];
  label?: string;
}) => (
  <nav className="ui-admin-nav" aria-label={label}>
    <NavigationItems activeItemId={activeItemId} items={items} />
  </nav>
);

export const DataTable = ({
  caption,
  children,
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { caption: string }) => (
  <div className="ui-table-scroll" tabIndex={0}>
    <table {...props} className={joinClassNames('ui-table', className)}>
      <caption>{caption}</caption>
      {children}
    </table>
  </div>
);

export const DataList = ({
  className,
  ...props
}: HTMLAttributes<HTMLUListElement>) => (
  <ul {...props} className={joinClassNames('ui-list', className)} />
);

export const DataListItem = ({
  className,
  ...props
}: LiHTMLAttributes<HTMLLIElement>) => (
  <li {...props} className={joinClassNames('ui-list__item', className)} />
);

export const Pagination = ({
  currentPage,
  nextHref,
  previousHref,
  totalPages,
}: {
  currentPage: number;
  nextHref?: string;
  previousHref?: string;
  totalPages: number;
}) => (
  <nav className="ui-pagination" aria-label="Stránkování">
    {previousHref ? (
      <a href={previousHref} rel="prev">
        Předchozí
      </a>
    ) : (
      <span aria-disabled="true">Předchozí</span>
    )}
    <span aria-current="page">
      Strana {currentPage} z {totalPages}
    </span>
    {nextHref ? (
      <a href={nextHref} rel="next">
        Další
      </a>
    ) : (
      <span aria-disabled="true">Další</span>
    )}
  </nav>
);
