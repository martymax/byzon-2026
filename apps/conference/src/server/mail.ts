export interface MagicLinkMessage {
  to: string;
  url: string;
}

export interface AuthMailProvider {
  sendMagicLink(message: MagicLinkMessage): Promise<void>;
}

/** Development adapter only. A real provider replaces this before production. */
export class FakeAuthMailProvider implements AuthMailProvider {
  readonly messages: MagicLinkMessage[] = [];

  async sendMagicLink(message: MagicLinkMessage): Promise<void> {
    this.messages.push({ ...message });
  }

  clear(): void {
    this.messages.length = 0;
  }
}

export const authMailProvider = new FakeAuthMailProvider();
