export {};

if (process.env.NODE_ENV === 'development') {
  const { restoreAppWorker, startBrowserMocking } =
    await import('./test/mocks/browser');

  if (process.env.NEXT_PUBLIC_BYZON_API_MOCKS === 'enabled') {
    await startBrowserMocking();
  } else {
    await restoreAppWorker();
  }
}
