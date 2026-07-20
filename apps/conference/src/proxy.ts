import { NextResponse, type NextRequest } from 'next/server';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function proxy(request: NextRequest) {
  const supplied = request.headers.get('x-request-id');
  const requestId =
    supplied && REQUEST_ID_PATTERN.test(supplied)
      ? supplied
      : crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
};
