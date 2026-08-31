import { NextResponse, type NextRequest } from 'next/server';

import { getRequestId } from './server/api/problem';

export const isRetired2026Path = (pathname: string): boolean =>
  pathname === '/check-in' ||
  pathname.startsWith('/check-in/') ||
  pathname === '/api/v1/check-in' ||
  pathname.startsWith('/api/v1/check-in/');

export function proxy(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  if (
    process.env.NODE_ENV === 'production' &&
    isRetired2026Path(request.nextUrl.pathname)
  ) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: {
        'cache-control': 'private, no-store',
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'x-request-id': requestId,
      },
    });
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
};
