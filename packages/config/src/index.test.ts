import { describe, expect, it } from 'vitest';
import { readWorkerEnv } from './index';

describe('worker environment', () => {
  it('validates positive concurrency', () =>
    expect(() => readWorkerEnv({ WORKER_CONCURRENCY_DEFAULT: 0 })).toThrow());
});
