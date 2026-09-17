import {
  MAGIC_LINK_CONFIRMATION_PATH,
  MAGIC_LINK_FIELDS,
  MAGIC_LINK_VERIFY_PATH,
} from '../lib/magic-link-confirmation';

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

// GET (including mail scanners and previews) must never reach token verification.
export const showMagicLinkConfirmation = (request: Request, origin: string) => {
  const source = new URL(request.url);
  const destination = new URL(MAGIC_LINK_CONFIRMATION_PATH, origin);
  for (const field of MAGIC_LINK_FIELDS) {
    const value = source.searchParams.get(field);
    if (value !== null) destination.searchParams.set(field, value);
  }
  return new Response(null, {
    status: 303,
    headers: { ...privateHeaders, Location: destination.toString() },
  });
};

export const confirmMagicLink = async (
  request: Request,
  origin: string,
  verify: (request: Request) => Promise<Response>,
): Promise<Response> => {
  // A native same-origin form works without JavaScript. Do not allow another
  // site to submit a login token and switch the visitor into a different account.
  if (request.headers.get('origin') !== origin) {
    return new Response('Nepovolený požadavek.', {
      status: 403,
      headers: privateHeaders,
    });
  }
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/x-www-form-urlencoded'
  ) {
    return new Response('Nepodporovaný formát požadavku.', {
      status: 415,
      headers: privateHeaders,
    });
  }

  const form = new URLSearchParams(await request.text());
  const verificationUrl = new URL(MAGIC_LINK_VERIFY_PATH, origin);
  for (const field of MAGIC_LINK_FIELDS) {
    const value = form.get(field);
    if (value !== null) verificationUrl.searchParams.set(field, value);
  }
  if (!verificationUrl.searchParams.get('token')) {
    return new Response(null, {
      status: 303,
      headers: {
        ...privateHeaders,
        Location: new URL('/prihlaseni?error=INVALID_TOKEN', origin).toString(),
      },
    });
  }
  if (!verificationUrl.searchParams.get('errorCallbackURL')) {
    verificationUrl.searchParams.set('errorCallbackURL', '/prihlaseni');
  }
  const headers = new Headers(request.headers);
  headers.delete('content-type');
  headers.delete('content-length');
  // Invoke Better Auth internally, preserving its token, redirect, rate-limit,
  // cookie and session checks. No public GET bypass is exposed.
  const response = await verify(new Request(verificationUrl, { headers }));
  const responseHeaders = new Headers(response.headers);
  for (const [name, value] of Object.entries(privateHeaders)) {
    responseHeaders.set(name, value);
  }
  return new Response(response.body, {
    status:
      response.status >= 300 && response.status < 400 ? 303 : response.status,
    headers: responseHeaders,
  });
};
