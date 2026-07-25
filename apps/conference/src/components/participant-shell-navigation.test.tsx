import { describe, expect, it } from 'vitest';

import { participantNavigationActiveId } from './participant-shell-navigation';

describe('participant shell navigation', () => {
  it.each([
    ['/app', 'overview'],
    ['/app/program', 'program'],
    ['/app/program/session-1', 'program'],
    ['/app/recnici/jana-novakova', 'speakers'],
    ['/app/oznameni', 'announcements'],
    ['/app/oznameni/announcement-1', 'announcements'],
    ['/app/informace', 'information'],
  ])('maps %s to its parent destination', (pathname, expected) => {
    expect(participantNavigationActiveId(pathname)).toBe(expected);
  });

  it('does not mark similarly prefixed or unknown routes as active', () => {
    expect(participantNavigationActiveId('/app/program-extra')).toBe('');
    expect(participantNavigationActiveId('/application')).toBe('');
  });
});
