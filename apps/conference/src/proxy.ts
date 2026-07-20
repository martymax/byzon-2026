import { NextResponse, type NextRequest } from 'next/server';
import { getRequestId } from '@/server/api/problem';

export function proxy(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
};
