import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * The migration journal is the migration list.
 *
 * drizzle-kit applies exactly what `drizzle/meta/_journal.json` names, in idx
 * order. A .sql file that nobody journalled therefore does not exist in
 * production, however plausibly it sits in the directory.
 *
 * On 2026-08-17 that cost the whole site: a hand-written
 * `0056_metric_resets_every.sql` was never journalled, the test harness applied
 * it anyway (it globbed the directory), 820 tests went green, and the deploy of
 * the code that selects `resets_every` 500'd every public floor until the column
 * was added by hand. The harness now reads the journal; this test makes the
 * two sides of that proposal match, so the omission cannot be silent.
 *
 * Static: no database, no server, milliseconds.
 */

const DIR = join(__dirname, '..', '..', 'drizzle');

type Journal = { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };

const journal = JSON.parse(readFileSync(join(DIR, 'meta', '_journal.json'), 'utf8')) as Journal;
const sqlFiles = readdirSync(DIR).filter(f => f.endsWith('.sql'));

test('the journal is not empty and the directory has files', () => {
  // A guard on the guard: an empty read would make every assertion vacuous.
  expect(journal.entries.length).toBeGreaterThan(50);
  expect(sqlFiles.length).toBeGreaterThan(50);
});

test('every journal entry names a file that exists', () => {
  const missing = journal.entries.map(e => `${e.tag}.sql`).filter(f => !sqlFiles.includes(f));
  expect(missing).toEqual([]);
});

test('every migration file is named by the journal', () => {
  // The failure mode: a written, committed, reviewed migration that production
  // never runs.
  const journalled = new Set(journal.entries.map(e => `${e.tag}.sql`));
  const orphans = sqlFiles.filter(f => !journalled.has(f));
  expect(orphans).toEqual([]);
});

test('idx values are unique and contiguous from zero', () => {
  const idxs = journal.entries.map(e => e.idx).sort((a, b) => a - b);
  expect(new Set(idxs).size).toBe(idxs.length);
  expect(idxs).toEqual(idxs.map((_, i) => i));
});

test('tags are unique, and every entry carries a version and a timestamp', () => {
  const tags = journal.entries.map(e => e.tag);
  expect(new Set(tags).size).toBe(tags.length);
  for (const e of journal.entries) {
    expect(typeof e.version).toBe('string');
    expect(e.version.length).toBeGreaterThan(0);
    expect(Number.isFinite(e.when)).toBe(true);
    expect(e.when).toBeGreaterThan(0);
  }
});

test('journal order is timestamp order, so replay order is authoring order', () => {
  const byIdx = [...journal.entries].sort((a, b) => a.idx - b.idx);
  for (let i = 1; i < byIdx.length; i++) {
    expect(byIdx[i].when).toBeGreaterThanOrEqual(byIdx[i - 1].when);
  }
});

test('no migration file is empty', () => {
  for (const f of sqlFiles) {
    const body = readFileSync(join(DIR, f), 'utf8')
      .split('\n')
      .filter(l => l.trim() && !l.trim().startsWith('--'))
      .join('\n')
      .trim();
    expect(body.length).toBeGreaterThan(0);
  }
});
