const clientNavigationEventName = 'byzon:client-navigation';

export const requestClientNavigation = (href: string): void => {
  window.dispatchEvent(
    new CustomEvent<string>(clientNavigationEventName, { detail: href }),
  );
};

export const subscribeToClientNavigation = (
  listener: (href: string) => void,
): (() => void) => {
  const handle = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === 'string') {
      listener(event.detail);
    }
  };
  window.addEventListener(clientNavigationEventName, handle);
  return () => window.removeEventListener(clientNavigationEventName, handle);
};
