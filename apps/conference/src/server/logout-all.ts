import { ApiProblemError, getRequestId, problemResponse } from './api/problem';

interface AuthRequestHandler {
  handler(request: Request): Promise<Response>;
}

const authProblem = (status: number): ApiProblemError => {
  if (status === 401) {
    return new ApiProblemError({
      status: 401,
      code: 'AUTHENTICATION_REQUIRED',
      title: 'Authentication required',
      detail: 'A valid session is required to complete this request.',
    });
  }

  if (status === 403) {
    return new ApiProblemError({
      status: 403,
      code: 'AUTH_REQUEST_REJECTED',
      title: 'Authentication request rejected',
      detail: 'The authentication request could not be accepted.',
    });
  }

  return new ApiProblemError({
    status: 500,
    code: 'AUTH_SESSION_REVOCATION_FAILED',
    title: 'Session revocation failed',
    detail: 'The sessions could not be revoked.',
  });
};

const authRequest = (request: Request, path: string): Request =>
  new Request(new URL(path, request.url), {
    method: 'POST',
    headers: request.headers,
  });

export const logoutAllSessions = async (
  request: Request,
  auth: AuthRequestHandler,
  allowedOrigin: string,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);

  try {
    if (request.headers.get('origin') !== allowedOrigin) {
      return problemResponse(authProblem(403), requestId);
    }

    const revoked = await auth.handler(
      authRequest(request, '/api/auth/revoke-sessions'),
    );
    if (!revoked.ok)
      return problemResponse(authProblem(revoked.status), requestId);

    const signedOut = await auth.handler(
      authRequest(request, '/api/auth/sign-out'),
    );
    if (!signedOut.ok) {
      return problemResponse(authProblem(signedOut.status), requestId);
    }

    const headers = new Headers({
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'x-request-id': requestId,
    });
    for (const cookie of signedOut.headers.getSetCookie()) {
      headers.append('set-cookie', cookie);
    }

    return new Response(
      JSON.stringify({ status: 'sessions_revoked', requestId }),
      { status: 200, headers },
    );
  } catch {
    return problemResponse(authProblem(500), requestId);
  }
};
