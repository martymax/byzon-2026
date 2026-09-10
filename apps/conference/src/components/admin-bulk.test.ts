import { describe, expect, it, vi } from 'vitest';
import { runAdminBulk } from './admin-bulk';
import { contentBulkPatch } from './admin-content-bulk-model';

const items = ['a', 'b', 'c'];
const identify = (id: string) => ({ id, label: id.toUpperCase() });

describe('admin bulk execution', () => {
  it('waits for each confirmed version and reports partial validation failures', async () => {
    let version = 3;
    const versions: number[] = [];
    const progress = vi.fn();
    const results = await runAdminBulk(
      items,
      identify,
      async (id) => {
        versions.push(version);
        await Promise.resolve();
        if (id === 'b')
          return { ok: false, message: 'Kapacita je příliš nízká.' };
        version += 1;
        return { ok: true };
      },
      new AbortController().signal,
      progress,
    );
    expect(versions).toEqual([3, 4, 4]);
    expect(results.map(({ status }) => status)).toEqual([
      'succeeded',
      'failed',
      'succeeded',
    ]);
    expect(results[1]?.message).toContain('Kapacita');
    expect(progress).toHaveBeenLastCalledWith(3);
  });

  it('stops a batch after a security or stale failure', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: false,
      stop: true,
      message: 'Přístup vypršel.',
    });
    const results = await runAdminBulk(
      items,
      identify,
      execute,
      new AbortController().signal,
      vi.fn(),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(results.map(({ status }) => status)).toEqual([
      'failed',
      'skipped',
      'skipped',
    ]);
  });

  it('does not retry an ambiguous request or start the remaining requests', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('Lost response'));
    const results = await runAdminBulk(
      items,
      identify,
      execute,
      new AbortController().signal,
      vi.fn(),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(results[0]?.message).toContain('Server nepotvrdil');
    expect(results[2]?.status).toBe('skipped');
  });

  it('does not start more mutations after unmount or a scope change aborts the batch', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort();
      return { ok: true };
    });
    const progress = vi.fn();
    const results = await runAdminBulk(
      items,
      identify,
      execute,
      controller.signal,
      progress,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
    expect(results.map(({ status }) => status)).toEqual([
      'succeeded',
      'skipped',
      'skipped',
    ]);
  });
});

describe('content bulk changes', () => {
  const session = {
    id: 'session',
    title: 'Přednáška',
    speakerIds: ['first', 'second'],
    startsAt: '2026-09-18T08:00:00Z',
    endsAt: '2026-09-18T09:00:00Z',
  };
  it('preserves unrelated speaker assignments without duplicating speakers', () => {
    expect(
      contentBulkPatch('addSpeaker', session, { value: 'first' }, 0),
    ).toEqual({ speakerIds: ['first', 'second'] });
    expect(
      contentBulkPatch('addSpeaker', session, { value: 'third' }, 0),
    ).toEqual({ speakerIds: ['first', 'second', 'third'] });
    expect(
      contentBulkPatch('removeSpeaker', session, { value: 'first' }, 0),
    ).toEqual({ speakerIds: ['second'] });
    expect(session.speakerIds).toEqual(['first', 'second']);
  });
  it('shifts both instants without changing duration or unrelated fields', () => {
    expect(contentBulkPatch('shiftTime', session, { value: '-30' }, 0)).toEqual(
      {
        startsAt: '2026-09-18T07:30:00.000Z',
        endsAt: '2026-09-18T08:30:00.000Z',
      },
    );
  });
  it('distinguishes clearing a field from leaving unrelated fields untouched', () => {
    expect(
      contentBulkPatch('roomId', session, { value: '__none__' }, 0),
    ).toEqual({ roomId: null });
    expect(contentBulkPatch('capacity', session, { value: '' }, 0)).toEqual({
      capacity: null,
    });
    expect(contentBulkPatch('sortOrder', session, { value: '10' }, 2)).toEqual({
      sortOrder: 12,
    });
  });
});
