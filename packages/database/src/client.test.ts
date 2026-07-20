import { describe, expect, it, vi } from 'vitest';

import { createDatabaseClient } from './client.js';

describe('database client', () => {
  it('creates a lazy bounded pool without exposing the connection URL', async () => {
    const onUnexpectedError = vi.fn();
    const client = createDatabaseClient({
      connectionString: 'postgresql://user:secret@127.0.0.1:1/byzon',
      max: 7,
      idleTimeoutMillis: 12_000,
      connectionTimeoutMillis: 500,
      applicationName: 'byzon-test',
      onUnexpectedError,
    });

    expect(client.pool.options.max).toBe(7);
    expect(client.pool.options.application_name).toBe('byzon-test');
    expect(onUnexpectedError).not.toHaveBeenCalled();
    await client.close();
  });
});
