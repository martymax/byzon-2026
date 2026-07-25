const API_PATH_PATTERN = /^\/api(?:\/|$)/;

export const shouldBlockUnhandledMockRequest = (
  requestUrl: string,
  applicationOrigin: string,
): boolean => {
  let request: URL;
  let origin: URL;
  try {
    request = new URL(requestUrl, applicationOrigin);
    origin = new URL(applicationOrigin);
  } catch {
    return true;
  }

  return (
    request.origin === origin.origin && API_PATH_PATTERN.test(request.pathname)
  );
};

export const blockUnhandledMockApiRequest = (
  requestMethod: string,
  requestUrl: string,
): never => {
  try {
    new URL(requestUrl, 'http://mock.invalid');
  } catch {
    // Keep the diagnostic deliberately generic for malformed URLs.
  }
  const method = /^[A-Z]{1,12}$/.test(requestMethod)
    ? requestMethod
    : 'REQUEST';
  throw new TypeError(`Mock API request blocked: ${method} /api/**`);
};
