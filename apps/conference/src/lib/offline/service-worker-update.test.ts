import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activateServiceWorker,
  UPDATE_ACTIVATION_TIMEOUT_MS,
} from './service-worker-update';

const setup = () => {
  const worker = Object.assign(new EventTarget(), {
    state: 'installed' as ServiceWorkerState,
    postMessage: vi.fn(),
  });
  const container = Object.assign(new EventTarget(), {
    controller: null as ServiceWorker | null,
  });
  const abort = new AbortController();
  const activate = () =>
    activateServiceWorker(
      container as ServiceWorkerContainer,
      worker as unknown as ServiceWorker,
      '2026.07.26.1',
      abort.signal,
    );
  const claim = () => {
    container.controller = worker as unknown as ServiceWorker;
    container.dispatchEvent(new Event('controllerchange'));
  };
  const state = (value: ServiceWorkerState) => {
    worker.state = value;
    worker.dispatchEvent(new Event('statechange'));
  };
  return { activate, abort, claim, container, state, worker };
};

afterEach(() => vi.useRealTimers());

describe('explicit service worker activation', () => {
  it('waits for both activation and control, ignoring unrelated controller changes', async () => {
    const test = setup();
    const completed = vi.fn();
    const result = test.activate().then(completed);
    expect(test.worker.postMessage).toHaveBeenCalledWith({
      type: 'BYZON_SKIP_WAITING',
      version: '2026.07.26.1',
    });
    test.container.dispatchEvent(new Event('controllerchange'));
    test.state('activating');
    test.claim();
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    test.state('activated');
    await result;
    test.claim();
    expect(completed).toHaveBeenCalledOnce();
  });

  it('handles immediate activation and successive builds sharing a protocol version', async () => {
    const test = setup();
    test.worker.postMessage.mockImplementation(() => {
      test.state('activated');
      test.claim();
    });
    await expect(test.activate()).resolves.toBeUndefined();
    // Simulate another build in the same tab without changing the protocol.
    test.state('installed');
    test.container.controller = null;
    await expect(test.activate()).resolves.toBeUndefined();
    expect(test.worker.postMessage).toHaveBeenCalledTimes(2);
  });

  it('completes when another tab has already activated the advertised worker', async () => {
    const test = setup();
    test.state('activated');
    test.claim();
    await expect(test.activate()).resolves.toBeUndefined();
    expect(test.worker.postMessage).not.toHaveBeenCalled();
  });

  it('times out, cleans up listeners, and allows a new attempt', async () => {
    vi.useFakeTimers();
    const test = setup();
    const remove = vi.spyOn(test.container, 'removeEventListener');
    const result = expect(test.activate()).rejects.toThrow('in time');
    await vi.advanceTimersByTimeAsync(UPDATE_ACTIVATION_TIMEOUT_MS);
    await result;
    expect(remove).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function),
    );
    expect(vi.getTimerCount()).toBe(0);
    const retry = test.activate();
    test.state('activated');
    test.claim();
    await expect(retry).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a replaced worker and catches postMessage failures', async () => {
    const test = setup();
    const result = expect(test.activate()).rejects.toThrow('replaced');
    test.state('redundant');
    await result;
    await expect(test.activate()).rejects.toThrow('replaced');
    test.state('installed');
    test.worker.postMessage.mockImplementation(() => {
      throw new Error('Cannot send');
    });
    await expect(test.activate()).rejects.toThrow('Cannot send');
  });

  it('cancels pending activation on unmount and rejects already aborted attempts', async () => {
    vi.useFakeTimers();
    const test = setup();
    const result = expect(test.activate()).rejects.toThrow('cancelled');
    test.abort.abort();
    await result;
    await expect(test.activate()).rejects.toThrow('cancelled');
    expect(test.worker.postMessage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
