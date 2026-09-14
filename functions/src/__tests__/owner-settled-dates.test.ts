/**
 * A date that settles when the owner settles it, and a title for any date
 * (docs/guides/time-preference.md, "A date that settles when you settle it"
 * and "A title for a date"; docs/market-integrity.md, "A date with no clock").
 *
 * Viktor, 2026-09-14, of the snake floor's hourly cell: "it should be asking
 * for reached legnth ever not in one hour.. lets add setting to a metric date
 * to not auto resolves.. esentially the date should have a customziable title
 * as well".
 *
 * THE RULE: a book on the `until-settled` date never settles, voids or gives
 * up on a clock. The only thing that settles it is the owner settling the
 * metric, and once it has settled the next refresh opens a fresh book.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, markets, metricLogs, metrics } from '../db/schema';
import { periodEndInstant, resolutionInstant, settlementInstantFor } from '../lib/date-utils';
import { horizonEntryFor } from '../lib/horizon-credits';
import { provisionWorkspace } from '../lib/participants';
import { desiredMarketDates, generatesMarkets, resolveCustomHorizons } from '../lib/time-preference';
import { toUnits } from '../lib/validation';
import { parseTimePreference } from '../routes/metrics';
import { refreshRelativeDateMarkets } from '../services/markets';
import { resolvePredictions, settleMetricEarly } from '../services/predictions';
import type { TimePreference } from '../types';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-owner-settled';
const OWNER = 'agent-owner-settled';
const M = 'metric-attempt';
const FAR = '9999-12-31T00:00:00.000Z';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed(tp: TimePreference, opts: { resolvesNaUntilMeasured?: boolean; lag?: number } = {}) {
  await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h-owner-settled', balance: toUnits(100000) }]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Snake',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: M,
    workspaceId: WS,
    name: 'Reached length',
    value: 2,
    formula: '0',
    marketRangeMax: 64,
    timePreference: tp,
    resolvesNaUntilMeasured: opts.resolvesNaUntilMeasured ?? false,
    settlementLagMinutes: opts.lag ?? 0,
  });
}

const booksOn = async () =>
  db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.metricId, M)));

const OWNER_SETTLED: TimePreference = { enabled: false, halfLife: 1, customHorizons: ['until-settled'] };

describe('the until-settled entry is accepted and kept', () => {
  test('parseTimePreference accepts "until-settled" as an entry, not as an invalid date', () => {
    const tp = parseTimePreference({ enabled: false, halfLife: 1, customHorizons: ['until-settled', '+0w'] });
    expect(tp).not.toBeInstanceOf(Error);
    expect((tp as TimePreference).customHorizons).toEqual(['until-settled', '+0w']);
  });

  test('a metric has at most one: a second copy is a duplicate and is dropped', () => {
    const tp = parseTimePreference({ enabled: false, halfLife: 1, customHorizons: ['until-settled', 'until-settled'] });
    expect((tp as TimePreference).customHorizons).toEqual(['until-settled']);
  });

  test('a near miss is still refused as a date it cannot read', () => {
    const tp = parseTimePreference({ enabled: false, halfLife: 1, customHorizons: ['until-setled'] });
    expect(tp).toBeInstanceOf(Error);
  });

  test('it is never pruned as a passed period, and it makes the metric generate markets', () => {
    const base = new Date('2030-01-01T00:00:00Z');
    expect(resolveCustomHorizons(['until-settled'], base)).toEqual(['until-settled']);
    expect(desiredMarketDates(OWNER_SETTLED, base)).toEqual(['until-settled']);
    expect(generatesMarkets(OWNER_SETTLED, base)).toBe(true);
  });

  test('its period ends at the far edge no clock reaches, as a well-formed instant', () => {
    expect(periodEndInstant('until-settled').toISOString()).toBe(FAR);
    expect(resolutionInstant('until-settled')).toBe('9999-12-31T00:00:00Z');
  });

  test('the reporting lag does not apply to it', () => {
    expect(settlementInstantFor('until-settled', 3 * 24 * 60).toISOString()).toBe(FAR);
  });

  test('its credits and title are found by its entry', () => {
    expect(horizonEntryFor(OWNER_SETTLED, 'until-settled')).toBe('until-settled');
  });
});

describe('a title for a date', () => {
  const parse = (horizonTitles: unknown, customHorizons = ['until-settled', '+0w']) =>
    parseTimePreference({ enabled: false, halfLife: 1, customHorizons, horizonTitles });

  test('a title is kept, keyed by its entry, trimmed', () => {
    const tp = parse({ 'until-settled': '  this attempt  ', '+0w': 'this week of the season' }) as TimePreference;
    expect(tp.horizonTitles).toEqual({ 'until-settled': 'this attempt', '+0w': 'this week of the season' });
  });

  test('a blank title is no title', () => {
    const tp = parse({ 'until-settled': '   ', '+0w': 'this week' }) as TimePreference;
    expect(tp.horizonTitles).toEqual({ '+0w': 'this week' });
  });

  test('a key that names no entry is dropped, never stored', () => {
    const tp = parse({ '+1m': 'next month' }) as TimePreference;
    expect(tp.horizonTitles).toBeUndefined();
  });

  test('a title is at most 60 characters', () => {
    expect(parse({ '+0w': 'x'.repeat(60) })).not.toBeInstanceOf(Error);
    expect(parse({ '+0w': 'x'.repeat(61) })).toBeInstanceOf(Error);
  });

  test('a title that is not a string, or titles that are not an object, are refused', () => {
    expect(parse({ '+0w': 7 })).toBeInstanceOf(Error);
    expect(parse(['this week'])).toBeInstanceOf(Error);
  });

  test('absent titles store nothing', () => {
    expect((parse(undefined) as TimePreference).horizonTitles).toBeUndefined();
  });
});

describe('THE RULE: an owner-settled date never settles on a clock', () => {
  test('the refresh opens one book on it, stamped with the far instant, and never a second', async () => {
    await seed(OWNER_SETTLED, { lag: 3 * 24 * 60 });
    await refreshRelativeDateMarkets(WS, { force: true });
    await refreshRelativeDateMarkets(WS, { force: true });
    const books = await booksOn();
    expect(books).toHaveLength(1);
    expect(books[0].targetDate).toBe('until-settled');
    expect(books[0].settlesAt?.toISOString()).toBe(FAR);
    expect(books[0].resolved).toBe(false);
  });

  test('the resolver leaves it open, however much later it runs and whatever readings exist', async () => {
    await seed(OWNER_SETTLED);
    await refreshRelativeDateMarkets(WS, { force: true });
    await db.insert(metricLogs).values({
      id: 'log-1',
      workspaceId: WS,
      metricId: M,
      metricName: 'Reached length',
      value: 9,
      outlook: 9,
      timestamp: new Date(),
    });
    const r = await resolvePredictions('9000-01-01', WS);
    expect(r.resolved).toBe(0);
    const [book] = await booksOn();
    expect(book.resolved).toBe(false);
    expect(book.voided).toBe(false);
  });

  test('a metric that resolves N/A until measured does not void it for want of a reading', async () => {
    await seed(OWNER_SETTLED, { resolvesNaUntilMeasured: true });
    await refreshRelativeDateMarkets(WS, { force: true });
    await resolvePredictions('9000-01-01', WS);
    const [book] = await booksOn();
    expect(book.resolved).toBe(false);
    expect(book.voided).toBe(false);
  });

  test('settling the metric settles it at the value, and the next refresh opens a fresh book', async () => {
    await seed(OWNER_SETTLED);
    await refreshRelativeDateMarkets(WS, { force: true });
    const [first] = await booksOn();
    const r = await settleMetricEarly(M, WS, { value: 26, reason: 'Game 3, attempt 12 ended at length 26' });
    expect(r.settled).toEqual([first.id]);
    await refreshRelativeDateMarkets(WS, { force: true });
    const books = await booksOn();
    expect(books).toHaveLength(2);
    const settled = books.find(b => b.id === first.id)!;
    expect(settled.resolved).toBe(true);
    expect(settled.voided).toBe(false);
    expect(settled.actualValue).toBe(26);
    const next = books.find(b => b.id !== first.id)!;
    expect(next.targetDate).toBe('until-settled');
    expect(next.resolved).toBe(false);
  });

  test('stopping the entry is how it ends: an untraded book goes, and nothing reopens', async () => {
    await seed(OWNER_SETTLED);
    await refreshRelativeDateMarkets(WS, { force: true });
    await db
      .update(metrics)
      .set({ timePreference: { enabled: false, halfLife: 1, customHorizons: ['+0w'] } })
      .where(eq(metrics.id, M));
    await refreshRelativeDateMarkets(WS, { force: true });
    const open = (await booksOn()).filter(b => b.targetDate === 'until-settled' && !b.resolved);
    expect(open).toHaveLength(0);
  });
});
