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
