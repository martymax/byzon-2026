import { afterEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import {
  createMailTransport,
  MailDeliveryUnavailableError,
  SmtpMailTransport,
  type DeliveryMessage,
} from './transport.js';

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));
const config = {
  APP_ENV: 'production',
  MAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'mail.webglobe.cz',
  SMTP_PORT: 465,
  SMTP_USERNAME: 'sender@example.test',
  SMTP_PASSWORD: 'secret',
  MAIL_FROM: 'BYZON <sender@example.test>',
  MAIL_REPLY_TO: 'reply@example.test',
};
const message: DeliveryMessage = {
  to: 'recipient@example.test',
  subject: 'Test',
  html: '<p>Test</p>',
  text: 'Test',
  idempotencyKey: 'notification-123',
  category: 'notification',
};
const setup = () => {
  const sendMail = vi
    .fn()
    .mockResolvedValue({ accepted: [message.to], rejected: [] });
  const close = vi.fn();
  vi.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close,
  } as never);
  return { sendMail, close };
};
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
describe('SMTP delivery', () => {
  it.each([465, 587])(
    'requires encryption on port %s and sends both content formats',
    async (port) => {
      const { sendMail, close } = setup();
      const transport = createMailTransport({ ...config, SMTP_PORT: port });
      expect(transport).toBeInstanceOf(SmtpMailTransport);
      await transport.send(message);
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: config.SMTP_HOST,
          port,
          secure: port === 465,
          requireTLS: true,
          tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
          auth: { user: config.SMTP_USERNAME, pass: config.SMTP_PASSWORD },
          logger: false,
          debug: false,
        }),
      );
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: config.MAIL_FROM,
          replyTo: config.MAIL_REPLY_TO,
          to: message.to,
          html: message.html,
          text: message.text,
          subject: message.subject,
        }),
      );
      expect(JSON.stringify(sendMail.mock.calls)).not.toContain(
        config.SMTP_PASSWORD,
      );
      await transport.send(message);
      expect(sendMail.mock.calls[0]![0].messageId).toBe(
        sendMail.mock.calls[1]![0].messageId,
      );
      expect(close).toHaveBeenCalledTimes(2);
    },
  );
  it('uses the configurable display name without changing the sender address', async () => {
    const { sendMail } = setup();
    await createMailTransport({
      ...config,
      MAIL_FROM: 'jsem@byzon.cz',
      MAIL_FROM_NAME: 'Konference BYZON',
    }).send(message);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'Konference BYZON', address: 'jsem@byzon.cz' },
      }),
    );
  });
  it('sanitizes provider errors and closes the connection', async () => {
    const { sendMail, close } = setup();
    sendMail.mockRejectedValue(new Error('SMTP secret recipient@example.test'));
    await expect(createMailTransport(config).send(message)).rejects.toEqual(
      new MailDeliveryUnavailableError(),
    );
    expect(close).toHaveBeenCalledOnce();
  });
  it('does not mark a rejected recipient as delivered', async () => {
    const { sendMail } = setup();
    sendMail.mockResolvedValue({ accepted: [], rejected: [message.to] });
    await expect(
      createMailTransport(config).send(message),
    ).rejects.toBeInstanceOf(MailDeliveryUnavailableError);
  });
  it('fails closed for incomplete SMTP even in development', async () => {
    await expect(
      createMailTransport({
        ...config,
        APP_ENV: 'development',
        SMTP_PASSWORD: '',
      }).send(message),
    ).rejects.toBeInstanceOf(MailDeliveryUnavailableError);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});
