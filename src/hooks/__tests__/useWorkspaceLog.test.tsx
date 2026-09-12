import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * How the Live column stays live (docs/ui-conventions.md, "The live log"):
 * one shared read of the workspace's log on open, every 15 seconds while the
 * tab is visible, and at once on refresh(); new rows found by id, marked as
 * new, never removed by a poll; a failed read leaves the rows standing.
 */

vi.mock('../../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { getActions: vi.fn() },
}));

import { api } from '../../lib/api';
import { useWorkspaceLog } from '../useWorkspaceLog';

const row = (id: string, at: string) => ({
  id,
  at,
  kind: 'trade',
  workspace: { slug: 'snake', name: 'Snake' },
  actor: { id: 'v', handle: 'vi0' },
  text: 'bought',
  detail: {},
  href: '/snake',
});
const page = (rows: ReturnType<typeof row>[]) => ({ generatedAt: 'x', kinds: [], workspaces: [], rows, next: null });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(api.getActions).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useWorkspaceLog', () => {
  test('reads the one shared query on open, and marks nothing new on the first read', async () => {
    vi.mocked(api.getActions).mockResolvedValue(page([row('a', '2026-09-12T20:00:00Z')]) as never);
    const { result } = renderHook(() => useWorkspaceLog('snake'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(api.getActions).toHaveBeenCalledWith({ workspace: 'snake', limit: '30' });
    expect(result.current.rows.map(x => x.id)).toEqual(['a']);
    expect(result.current.newIds.size).toBe(0);
    expect(result.current.state).toBe('ready');
  });

  test('every 15 seconds it reads again; a row it did not have is prepended and marked new', async () => {
    vi.mocked(api.getActions).mockResolvedValueOnce(page([row('a', '2026-09-12T20:00:00Z')]) as never);
    const { result } = renderHook(() => useWorkspaceLog('snake'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    vi.mocked(api.getActions).mockResolvedValue(
      page([row('b', '2026-09-12T20:00:10Z'), row('a', '2026-09-12T20:00:00Z')]) as never,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });
    expect(result.current.rows.map(x => x.id)).toEqual(['a']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(result.current.rows.map(x => x.id)).toEqual(['b', 'a']);
    expect([...result.current.newIds]).toEqual(['b']);
    act(() => result.current.markSeen());
    expect(result.current.newIds.size).toBe(0);
  });

  test('refresh() reads at once, the way a live feed step asks it to', async () => {
    vi.mocked(api.getActions).mockResolvedValue(page([row('a', '2026-09-12T20:00:00Z')]) as never);
    const { result } = renderHook(() => useWorkspaceLog('snake'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const before = vi.mocked(api.getActions).mock.calls.length;
    await act(async () => {
      result.current.refresh();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(vi.mocked(api.getActions).mock.calls.length).toBe(before + 1);
  });

  test('a failed read leaves the rows standing, and nothing drawn is removed by a poll', async () => {
    vi.mocked(api.getActions).mockResolvedValueOnce(
      page([row('a', '2026-09-12T20:00:00Z'), row('z', '2026-09-12T19:00:00Z')]) as never,
    );
    const { result } = renderHook(() => useWorkspaceLog('snake'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    vi.mocked(api.getActions).mockRejectedValueOnce(new Error('down'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_100);
    });
    expect(result.current.rows.map(x => x.id)).toEqual(['a', 'z']);
    // A later page that no longer carries the oldest row does not remove it.
    vi.mocked(api.getActions).mockResolvedValueOnce(page([row('a', '2026-09-12T20:00:00Z')]) as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_100);
    });
    expect(result.current.rows.map(x => x.id)).toEqual(['a', 'z']);
  });
});
