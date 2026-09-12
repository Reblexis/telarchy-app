import { useCallback, useEffect, useRef, useState } from 'react';
import { type ActionRow, api } from '../lib/api';

/**
 * The floor's Live column, kept live (docs/ui-conventions.md, "The live log").
 *
 * Every reader of a floor asks the same read, `workspace=<slug>&limit=30`,
 * which the server holds for five seconds (docs/data-room.md, "The feed"), so
 * this never asks with `after`: it reads the held page and finds new rows by
 * id. It reads on open, every 15 seconds while the tab is visible, and at once
 * on refresh() (a live feed's step). A failed read leaves the rows standing,
 * and a poll never removes a row already held.
 */

export const LIVE_LOG_POLL_MS = 15_000;
export const LIVE_LOG_LIMIT = 30;
/** How many rows a long-open tab keeps; the block draws the newest of them. */
const KEEP = 200;

const newestFirst = (a: ActionRow, b: ActionRow) => Date.parse(b.at) - Date.parse(a.at);

export function useWorkspaceLog(slug: string | null | undefined) {
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const rowsRef = useRef<ActionRow[]>([]);
  rowsRef.current = rows;
  const loaded = useRef(false);
  const slugRef = useRef(slug);
  slugRef.current = slug;

  const read = useCallback(async () => {
    const want = slugRef.current;
    if (!want) return;
    try {
      const page = await api.getActions({ workspace: want, limit: String(LIVE_LOG_LIMIT) });
      if (slugRef.current !== want) return;
      if (!loaded.current) {
        loaded.current = true;
        setRows([...page.rows].sort(newestFirst));
        setState('ready');
        return;
      }
      const have = new Set(rowsRef.current.map(r => r.id));
      const fresh = page.rows.filter(r => !have.has(r.id));
      if (fresh.length === 0) return;
      setRows([...fresh, ...rowsRef.current].sort(newestFirst).slice(0, KEEP));
      setNewIds(prev => new Set([...prev, ...fresh.map(r => r.id)]));
    } catch {
      if (!loaded.current) setState('failed');
    }
  }, []);

  useEffect(() => {
    loaded.current = false;
    setRows([]);
    setNewIds(new Set());
    setState('loading');
    if (!slug) return;
    void read();
    const id = window.setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void read();
    }, LIVE_LOG_POLL_MS);
    return () => window.clearInterval(id);
  }, [slug, read]);

  const refresh = useCallback(() => {
    void read();
  }, [read]);
  const markSeen = useCallback(() => {
    setNewIds(prev => (prev.size ? new Set() : prev));
  }, []);

  return { rows, newIds, state, refresh, markSeen };
}
