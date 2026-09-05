import { schema } from '@byzon/database';
import { activationEmailSchema } from '@byzon/domain/contracts';
import { toNextJsHandler } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';

import {
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  auth,
  createAuth,
  magicLinkPurposeForAccount,
} from '@/server/auth';
import { database } from '@/server/database';
import { authMailProvider } from '@/server/mail';

const loginHandlers = toNextJsHandler(auth);
const activationHandlers = toNextJsHandler(
  createAuth(authMailProvider, database.db, process.env, {
    magicLinkExpiresInSeconds: ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  }),
);

const magicLinkRequestPath = '/api/auth/sign-in/magic-link';

const policyControlledRequest = (
  request: Request,
  body: Record<string, unknown>,
  email: string,
  purpose: 'account-activation' | 'sign-in',
): Request => {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...body,
      email,
      metadata: { purpose },
    }),
    signal: request.signal,
  });
};

export const GET = loginHandlers.GET;

export const POST = async (request: Request): Promise<Response> => {
  if (new URL(request.url).pathname !== magicLinkRequestPath) {
    return loginHandlers.POST(request);
  }

  let body: Record<string, unknown> | null = null;
  try {
    const candidate = (await request.clone().json()) as unknown;
    if (
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate)
    ) {
      body = candidate as Record<string, unknown>;
    }
  } catch {
    return loginHandlers.POST(request);
  }

  const parsedEmail = activationEmailSchema.safeParse(body?.email);
  if (!body || !parsedEmail.success) return loginHandlers.POST(request);
  const email = parsedEmail.data.toLowerCase();
  const user = await database.db.query.users.findFirst({
    columns: { emailVerified: true },
    where: eq(schema.users.email, email),
  });
  const purpose = magicLinkPurposeForAccount(user?.emailVerified);
  const controlledRequest = policyControlledRequest(
    request,
    body,
    email,
    purpose,
  );

  return purpose === 'account-activation'
    ? activationHandlers.POST(controlledRequest)
    : loginHandlers.POST(controlledRequest);
};
