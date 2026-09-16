import { describe, expect, it } from 'vitest';
import { guidePath, guidesForRoles, roleGuides } from './guides.js';
import { createAuthEmail } from './templates.js';

const input = {
  purpose: 'participant-invitation' as const,
  appOrigin: 'https://app.example.test',
  url: 'https://app.example.test/api/auth/magic-link/verify?token=private-token&callbackURL=%2Fpo-prihlaseni',
  expiresInSeconds: 86400,
};

describe('role-specific invitation guides', () => {
  it.each(roleGuides)(
    'links $role to its public guide in HTML and text',
    (guide) => {
      const email = createAuthEmail({ ...input, roles: [guide.role] });
      const href = `${input.appOrigin}${guidePath(guide.slug)}`;
      expect(email.html).toContain(`href="${href}"`);
      expect(email.text).toContain(href);
      expect(email.text).toContain('bez přihlášení');
      expect(email.text).toContain('24 hodin');
      const publicLinks = [
        ...email.html.matchAll(/href="([^"]*\/navody[^\"]*)"/g),
      ].map((match) => new URL(match[1]!));
      expect(publicLinks).toHaveLength(1);
      expect(publicLinks[0]!.search).toBe('');
      expect(publicLinks[0]!.hash).toBe('');
    },
  );
  it('includes each assigned role once and ignores unknown or system roles', () => {
    const roles = [
      'speaker',
      'room_operator',
      'speaker',
      'system_worker',
      '__proto__',
      'https://evil.test',
    ];
    expect(guidesForRoles(roles).map((guide) => guide.role)).toEqual([
      'speaker',
      'room_operator',
    ]);
    const email = createAuthEmail({ ...input, roles });
    expect(email.text).toContain('/navody/recnik');
    expect(email.text).toContain('/navody/vedouci-aktivity');
    expect(email.text).not.toContain('/navody/administrator');
    expect(email.text).not.toContain('evil.test');
  });
  it('offers a useful fallback without inventing an administrator role', () => {
    expect(createAuthEmail(input).text).toContain('/navody/ucastnik');
    const team = createAuthEmail({ ...input, purpose: 'team-invitation' });
    expect(team.text).toContain(
      'Vybrat návod podle své role: https://app.example.test/navody',
    );
    expect(team.text).not.toContain('/navody/administrator');
    expect(team.text).toContain('returnTo=%2Fpo-prihlaseni');
    expect(team.text).not.toContain('Otevřít administraci');
  });
  it('includes guides in account activation but keeps repeated sign-ins concise', () => {
    expect(
      createAuthEmail({
        ...input,
        purpose: 'account-activation',
        roles: ['moderator'],
      }).text,
    ).toContain('/navody/moderator');
    expect(
      createAuthEmail({ ...input, purpose: 'sign-in', roles: ['moderator'] })
        .text,
    ).not.toContain('/navody');
  });
});
