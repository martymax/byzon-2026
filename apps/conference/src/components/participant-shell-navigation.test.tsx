import { describe, expect, it, vi } from 'vitest';

vi.mock('./participant-account-resource', () => ({
  useParticipantAccountResourceOptional: () => null,
}));

import {
  archivedNavigationActiveId,
  participantActivityContextAction,
  participantNavigationActiveId,
  participantNavigationItemsForMode,
} from './participant-shell-navigation';

describe('participant shell navigation', () => {
  it.each([
    ['/app', ''],
    ['/app/program', 'program'],
    ['/app/program/session-1', 'program'],
    ['/app/agenda', 'agenda'],
    ['/app/oznameni', ''],
    ['/app/oznameni/announcement-1', ''],
    ['/app/vice', 'account'],
    ['/app/profil', 'account'],
    ['/app/soukromi', 'account'],
    ['/app/nastaveni', 'account'],
    ['/app/vstupenka', 'account'],
    ['/app/recnici/jana-novakova', 'speakers'],
    ['/app/partneri', ''],
    ['/app/informace', 'account'],
    ['/app/networking', 'networking'],
    ['/app/networking/01910000-0000-7000-8000-000000000301', 'networking'],
  ])('maps %s to its parent destination', (pathname, expected) => {
    expect(participantNavigationActiveId(pathname)).toBe(expected);
  });

  it('does not mark similarly prefixed or unknown routes as active', () => {
    expect(participantNavigationActiveId('/app/program-extra')).toBe('');
    expect(participantNavigationActiveId('/app/vicemistr')).toBe('');
    expect(participantNavigationActiveId('/application')).toBe('');
  });

  it('keeps account and privacy controls available after archival', () => {
    expect(
      participantNavigationItemsForMode('archived').map(({ href }) => href),
    ).toEqual(['/app', '/app/soukromi', '/app/nastaveni']);
  });

  it('keeps the same archived account destinations in preview', () => {
    expect(
      participantNavigationItemsForMode('archived-preview').map(
        ({ href }) => href,
      ),
    ).toEqual(['/app', '/app/soukromi', '/app/nastaveni']);
    expect(
      participantNavigationItemsForMode('archived-preview').map(
        ({ label }) => label,
      ),
    ).toEqual(['Přehled', 'Soukromí', 'Nastavení']);
  });

  it('exposes the production account hub alongside the core destinations', () => {
    expect(
      participantNavigationItemsForMode('active').map(({ href }) => href),
    ).toEqual([
      '/app/program',
      '/app/agenda',
      '/app/networking',
      '/app/recnici',
      '/app/vice',
    ]);
  });

  it('exposes all mocked participant journeys only in frontend preview', () => {
    expect(
      participantNavigationItemsForMode('active-preview').map(
        ({ href }) => href,
      ),
    ).toEqual([
      '/app/program',
      '/app/agenda',
      '/app/networking',
      '/app/recnici',
      '/app/vice',
    ]);
  });

  it('does not expose participant destinations while the event is unavailable', () => {
    expect(participantNavigationItemsForMode('unavailable')).toEqual([]);
  });

  it('offers activity management only to linked speakers and activity leaders in an active event', () => {
    expect(
      participantActivityContextAction(['participant', 'speaker'], 'active'),
    ).toMatchObject({ href: '/host/aktivity', label: 'Správa aktivit' });
    expect(
      participantActivityContextAction(
        ['participant', 'room_operator'],
        'active-preview',
      ),
    ).toMatchObject({ href: '/host/aktivity' });
    expect(
      participantActivityContextAction(['participant'], 'active'),
    ).toBeUndefined();
    expect(
      participantActivityContextAction(['participant', 'speaker'], 'archived'),
    ).toBeUndefined();
  });

  it.each([
    ['/app', 'overview'],
    ['/app/soukromi', 'privacy'],
    ['/app/soukromi/export', 'privacy'],
    ['/app/nastaveni', 'settings'],
    ['/app/nastaveni/relace', 'settings'],
    ['/app/program', ''],
    ['/app/agenda', ''],
    ['/app/oznameni', ''],
    ['/app/vice', ''],
    ['/app/profil', ''],
    ['/app/vstupenka', ''],
  ])('maps archived route %s to %s', (pathname, expected) => {
    expect(archivedNavigationActiveId(pathname)).toBe(expected);
  });
});
