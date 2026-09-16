import { expect, it } from 'vitest';
import { archivedAuthContent } from './mail-history';

it('keeps assigned public guides in the archive without the personal token', () => {
  const content = archivedAuthContent(
    {
      to: 'speaker@example.test',
      url: 'https://app.example.test/api/auth/magic-link/verify?token=secret-token',
      purpose: 'participant-invitation',
      roles: ['speaker', 'moderator'],
    },
    'https://app.example.test',
  );
  for (const body of [content.html, content.text]) {
    expect(body).toContain('https://app.example.test/navody/recnik');
    expect(body).toContain('https://app.example.test/navody/moderator');
    expect(body).not.toContain('secret-token');
    expect(body).not.toContain('token=');
  }
});
