import { useState, useMemo } from 'react';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> { key: K; dir: SortDir }

export function compare(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function useSortableRows<T, K extends string>(
  rows: T[],
  keyFns: Record<K, (row: T) => unknown>,
  initial: SortState<K>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const toggle = (key: K) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const sorted = useMemo(() => {
    const fn = keyFns[sort.key];
    const copy = [...rows];
    copy.sort((a, b) => {
      const c = compare(fn(a), fn(b));
      return sort.dir === 'asc' ? c : -c;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  return { sorted, sort, toggle };
}

export function sortArrow(active: boolean, dir: SortDir): string {
  if (!active) return '';
  return dir === 'asc' ? ' ▲' : ' ▼';
}
