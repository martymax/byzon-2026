import { describe, expect, it, vi } from 'vitest';
import type { AdminInvitationRecipient } from '@byzon/domain/contracts';
import {
  filterInvitationRecipients,
  selectVisibleRecipients,
  sendInvitationBatch,
  waitForInvitationWindow,
} from './admin-invitations-model';

const person = (index: number): AdminInvitationRecipient => ({
  userId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  displayName: index === 1 ? 'Kateřina Novotná' : `Osoba ${index}`,
  email: `person${index}@example.test`,
  roles: index === 1 ? ['participant', 'speaker'] : ['organizer_admin'],
  invitation: { status: 'not_sent', lastSentAt: null },
  delivery: index === 1 ? 'participant' : 'team',
});

describe('invitation recipient selection', () => {
  it('combines roles with OR, matches names without accents and returns a person once', () => {
    expect(
      filterInvitationRecipients(
        [person(1), person(2)],
        new Set(['participant', 'speaker']),
        'katerina',
        'not_sent',
      ),
    ).toEqual([person(1)]);
    expect(
      filterInvitationRecipients([person(1)], new Set(), '', 'sent'),
    ).toEqual([]);
    expect(
      filterInvitationRecipients(
        [person(1), person(2)],
        new Set(),
        'PERSON2@',
        'all',
      ),
    ).toEqual([person(2)]);
  });
  it('selects and deselects only the visible recipients while preserving other roles', () => {
    const selected = selectVisibleRecipients(
      new Set(['hidden']),
      ['a', 'b'],
      true,
    );
    expect([...selected]).toEqual(['hidden', 'a', 'b']);
    expect([...selectVisibleRecipients(selected, ['a', 'b'], false)]).toEqual([
      'hidden',
    ]);
  });
});

describe('invitation delivery batches', () => {
  const options = () => ({
    items: [person(1), person(2), person(3)],
    signal: new AbortController().signal,
    onPause: vi.fn(),
    onProgress: vi.fn(),
    wait: vi.fn(async () => {}),
    execute: vi.fn(async () => ({ ok: true })),
  });
  it('sends every recipient exactly once and waits between groups of ten', async () => {
    const input = {
      ...options(),
      items: Array.from({ length: 23 }, (_, i) => person(i + 1)),
    };
    const result = await sendInvitationBatch(input);
    expect(result.every((row) => row.status === 'succeeded')).toBe(true);
    expect(input.execute).toHaveBeenCalledTimes(23);
    expect(input.wait).toHaveBeenCalledTimes(2);
    expect(input.wait).toHaveBeenCalledWith(61_000, input.signal);
  });
  it('retries a known rate limit for the same person after waiting', async () => {
    const input = options();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, stop: true, rateLimited: true })
      .mockResolvedValue({ ok: true });
    const result = await sendInvitationBatch({ ...input, execute });
    expect(execute.mock.calls[0]).toEqual(execute.mock.calls[1]);
    expect(input.wait).toHaveBeenCalledTimes(1);
    expect(result.every((row) => row.status === 'succeeded')).toBe(true);
  });
  it('stops after an uncertain response and keeps unattempted recipients distinguishable', async () => {
    const input = options();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('connection lost'));
    const result = await sendInvitationBatch({ ...input, execute });
    expect(result.map((row) => row.status)).toEqual([
      'succeeded',
      'failed',
      'skipped',
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('finishes the in-flight recipient and skips the rest on stop', async () => {
    const input = options();
    const abort = new AbortController();
    const execute = vi.fn(async () => {
      abort.abort();
      return { ok: true };
    });
    const result = await sendInvitationBatch({
      ...input,
      execute,
      signal: abort.signal,
    });
    expect(result.map((row) => row.status)).toEqual([
      'succeeded',
      'skipped',
      'skipped',
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('cancels a rate-limit pause without retrying', async () => {
    const input = options();
    const abort = new AbortController();
    const execute = vi.fn(async () => ({
      ok: false,
      rateLimited: true,
      stop: true,
    }));
    const result = await sendInvitationBatch({
      ...input,
      execute,
      signal: abort.signal,
      wait: async () => {
        abort.abort();
      },
    });
    expect(result.map((row) => row.status)).toEqual([
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('releases a pending timer when paused delivery is cancelled', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const waiting = waitForInvitationWindow(61_000, abort.signal);
    abort.abort();
    await waiting;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
