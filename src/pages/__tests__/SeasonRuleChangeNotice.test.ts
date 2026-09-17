/**
 * EVERY MID-SEASON RULE CHANGE IS ANNOUNCED ON THE SEASON PAGE, NEWEST VISIBLE.
 *
 * docs/seasons.md, "Rule changes": a Season 0 rule may change mid-season
 * provided the change is announced on the season page. The notice is a
 * collapsed list whose summary line is the newest change, because an
 * announcement a visitor has to open is not announced.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const page = readFileSync(join(__dirname, '..', 'SeasonPage.tsx'), 'utf8');
const details = page.slice(page.indexOf('<details className="seasonp-rulechanges">'), page.indexOf('</details>'));
const summary = details.slice(details.indexOf('<summary'), details.indexOf('</summary>')).replace(/\s+/g, ' ');
const earlier = details.slice(details.indexOf('</summary>')).replace(/\s+/g, ' ');

describe('every mid-season rule change is announced on the season page, newest visible', () => {
  test('the visible line is the 2026-09-17 change: a fault refund counts in the season score', () => {
    expect(summary).toContain('Rule change, 2026-09-17');
    expect(summary).toMatch(/fault/i);
    expect(summary).toMatch(/refund|repa/i);
  });

  test('the visible line carries exactly one change', () => {
    expect(summary.match(/Rule change,/g)).toHaveLength(1);
  });

  test('the transfers change of 2026-09-16 is still announced, among the earlier ones', () => {
    expect(earlier).toContain('Rule change, 2026-09-16');
    expect(earlier).toMatch(/transfer/i);
  });

  test('the earlier changes keep their order, newest first', () => {
    const dates = [...earlier.matchAll(/Rule change, (\d{4}-\d{2}-\d{2})/g)].map(m => m[1]);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates).toEqual(expect.arrayContaining(['2026-09-16', '2026-08-31', '2026-08-28']));
  });
});
