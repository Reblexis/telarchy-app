import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { describe, expect, test } from 'vitest';

/**
 * EVERY POLL PAUSES WHILE THE TAB IS HIDDEN (docs/ui-conventions.md, "A
 * hidden tab asks for nothing"). A drift guard in the shape of api-parity:
 * a fixed-cadence poll goes through src/lib/visible-poll.ts, so a new
 * `setInterval` elsewhere is either a local clock (it only moves state such as
 * `now` or a replay cursor, and never calls the API) or a poll that would keep
 * asking from a background tab, which is what made one idle laptop 60% of the
 * site's traffic.
 *
 * A legitimate exception belongs in ALLOWED, with the reason.
 */

const SRC = resolve(__dirname, '../..');

const ALLOWED = new Set([
  'lib/visible-poll.ts', // the helper itself
  'lib/build-watch.ts', // the stale-tab guard: its own hidden-aware check, pinned by build-watch.test.ts
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === '__tests__' || name === 'test' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).map(f => ({ path: relative(SRC, f), text: readFileSync(f, 'utf8') }));

/** Every setInterval in `text` whose callback is not a local clock, as "line: code". */
function unpausedIntervals(text: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!/\bsetInterval\(/.test(line)) return;
    const body = lines.slice(i, i + 3).join('\n');
    const clock = /\bset(Now|Replay)\(/.test(body) && !/\bapi\./.test(body);
    if (!clock) out.push(`${i + 1}: ${line.trim()}`);
  });
  return out;
}

test('the scan actually sees the frontend', () => {
  expect(files.length).toBeGreaterThan(20);
  const paths = files.map(f => f.path);
  expect(paths).toContain('components/NotificationsBell.tsx');
  expect(paths).toContain('pages/TradePage.tsx');
});

test('the scan tells a poll from a clock', () => {
  expect(unpausedIntervals('const t = setInterval(load, 30_000);')).toHaveLength(1);
  expect(
    unpausedIntervals('const id = window.setInterval(() => {\n  api.getActions(f).then(x);\n}, POLL_MS);'),
  ).toHaveLength(1);
  expect(unpausedIntervals('const t = window.setInterval(() => setNow(Date.now()), 1000);')).toEqual([]);
  expect(unpausedIntervals('const t = window.setInterval(() => {\n  setReplay(cur => {\n')).toEqual([]);
});

describe('EVERY POLL PAUSES WHILE THE TAB IS HIDDEN', () => {
  test('no setInterval outside the shared helper, except local clocks', () => {
    const offenders = files
      .filter(f => !ALLOWED.has(f.path))
      .flatMap(f => unpausedIntervals(f.text).map(hit => `${f.path}:${hit}`));
    expect(offenders).toEqual([]);
  });
});
