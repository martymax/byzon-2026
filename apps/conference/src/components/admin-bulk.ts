export interface AdminBulkResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly stop?: boolean;
}

export interface AdminBulkOutcome {
  readonly id: string;
  readonly label: string;
  readonly status: 'succeeded' | 'failed' | 'skipped';
  readonly message?: string;
}

/** Serial execution preserves shared versions and avoids bursts at mutation endpoints. */
export const runAdminBulk = async <Item>(
  items: readonly Item[],
  identify: (item: Item) => { id: string; label: string },
  execute: (item: Item, index: number) => Promise<AdminBulkResult>,
  signal: AbortSignal,
  onProgress: (completed: number) => void,
): Promise<readonly AdminBulkOutcome[]> => {
  const outcomes: AdminBulkOutcome[] = [];
  let stopped = false;
  for (const [index, item] of items.entries()) {
    const identity = identify(item);
    if (stopped || signal.aborted) {
      outcomes.push({ ...identity, status: 'skipped' });
      continue;
    }
    let result: AdminBulkResult;
    try {
      result = await execute(item, index);
    } catch {
      result = {
        ok: false,
        stop: true,
        message:
          'Server nepotvrdil výsledek. Před dalším pokusem ověřte aktuální stav.',
      };
    }
    outcomes.push({
      ...identity,
      status: result.ok ? 'succeeded' : 'failed',
      ...(result.message ? { message: result.message } : {}),
    });
    stopped = result.stop === true;
    if (!signal.aborted) onProgress(index + 1);
  }
  return outcomes;
};

/** Each confirmation captures its own version cursor, independent of React renders. */
export const createAdminBulkVersion = (initialVersion: number) => {
  let version = initialVersion;
  return {
    read: () => version,
    accept: (confirmedVersion: number) => {
      version = confirmedVersion;
    },
  };
};
