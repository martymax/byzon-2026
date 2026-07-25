import { describe, expect, it } from 'vitest';

import {
  archivedNavigationActiveId,
  participantNavigationActiveId,
  participantNavigationItemsForMode,
} from './participant-shell-navigation';

describe('participant shell navigation', () => {
  it.each([
    ['/app', 'overview'],
    ['/app/program', 'program'],
    ['/app/program/session-1', 'program'],
    ['/app/oznameni', 'announcements'],
    ['/app/oznameni/announcement-1', 'announcements'],
    ['/app/vice', 'more'],
    ['/app/profil', 'more'],
    ['/app/soukromi', 'more'],
    ['/app/nastaveni', 'more'],
    ['/app/vstupenka', 'more'],
    ['/app/recnici/jana-novakova', 'more'],
    ['/app/partneri', 'more'],
    ['/app/informace', 'more'],
  ])('maps %s to its parent destination', (pathname, expected) => {
    expect(participantNavigationActiveId(pathname)).toBe(expected);
  });

  it('does not mark similarly prefixed or unknown routes as active', () => {
    expect(participantNavigationActiveId('/app/program-extra')).toBe('');
    expect(participantNavigationActiveId('/app/vicemistr')).toBe('');
    expect(participantNavigationActiveId('/application')).toBe('');
  });

  it('exposes only account-safe destinations after archival', () => {
    expect(
      participantNavigationItemsForMode('archived').map(({ href }) => href),
    ).toEqual(['/app', '/app/soukromi', '/app/nastaveni']);
    expect(
      participantNavigationItemsForMode('archived').map(({ label }) => label),
    ).toEqual(['Přehled', 'Soukromí', 'Nastavení']);
  });

  it('does not expose participant destinations while the event is unavailable', () => {
    expect(participantNavigationItemsForMode('unavailable')).toEqual([]);
  });

  it.each([
    ['/app', 'overview'],
    ['/app/soukromi', 'privacy'],
    ['/app/soukromi/export', 'privacy'],
    ['/app/nastaveni', 'settings'],
    ['/app/nastaveni/relace', 'settings'],
    ['/app/program', ''],
    ['/app/oznameni', ''],
    ['/app/vice', ''],
    ['/app/profil', ''],
    ['/app/vstupenka', ''],
  ])('maps archived route %s to %s', (pathname, expected) => {
    expect(archivedNavigationActiveId(pathname)).toBe(expected);
  });
});
