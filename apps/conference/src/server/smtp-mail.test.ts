import { expect, it, vi } from 'vitest';
import { createAuthMailProvider } from './mail';

import { SmtpMailTransport } from '@byzon/mail/transport';

it('delivers a rendered authentication link through the configured SMTP account', async () => {
  const sendMail = vi
    .spyOn(SmtpMailTransport.prototype, 'send')
    .mockResolvedValue(undefined);
  const provider = createAuthMailProvider({
    MAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'mail.webglobe.cz',
    SMTP_PORT: '465',
    SMTP_USERNAME: 'sender@example.test',
    SMTP_PASSWORD: 'synthetic-password',
    MAIL_FROM: 'BYZON <sender@example.test>',
    MAIL_REPLY_TO: 'sender@example.test',
  });
  const url =
    'http://localhost:3000/api/auth/magic-link/verify?token=synthetic';
  await provider.sendMagicLink({ to: 'recipient@example.test', url });
  expect(sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      to: 'recipient@example.test',
      html: expect.stringContaining(url),
      text: expect.stringContaining(url),
    }),
  );
  expect(JSON.stringify(sendMail.mock.calls)).not.toContain(
    'synthetic-password',
  );
  sendMail.mockRestore();
});
