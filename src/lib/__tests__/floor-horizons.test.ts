import { describe, expect, test } from 'vitest';
import type { PublicWorkspace } from '../api';
import {
  buildHorizonViews,
  captionLabel,
  currencyOf,
  dateLineOf,
  datesOf,
  horizonById,
  horizonLabel,
  metricLabelOf,
  metricsOf,
  priceSeriesOf,
  primaryHorizonOf,
  settleDayOf,
  settleShortOf,
  stepDate,
  stepMetric,
} from '../floor-horizons';

/**
 * The floor's horizon model.
 *
 * Everything the page shows about "the clock on screen" comes from here, and
 * the reason it does is a run of bugs that all had the same shape: a surface
 * decided what a horizon was from its position in an array, and the array's
 * order changed under it.
 */

const WEEK = {
  marketId: 'm-week',
  metricId: 'metric-w',
  metricName: 'LookPilot revenue this week (USD)',
  targetDate: '2026-W34',
  resolvesOn: '2026-08-24T00:00:00Z',
  consensus: 213,
  probability: 0.5,
  liquidity: 200,
  rangeMin: 0,
  rangeMax: 8000,
};
const YEAR = {
  marketId: 'm-year',
  metricId: 'metric-y',
  metricName: 'LookPilot net 2026 (USD)',
  targetDate: '2026-12',
  resolvesOn: '2027-01-01T00:00:00Z',
  consensus: 78_571,
  probability: 0.52,
  liquidity: 5000,
  rangeMin: 0,
  rangeMax: 150_000,
};

/** Soonest-first, exactly as the API ships it. */
function ws(overrides: Partial<PublicWorkspace> = {}): PublicWorkspace {
  return {
    markets: [WEEK, YEAR],
    horizonHistories: [
      {
        marketId: 'm-week',
        metricName: WEEK.metricName,
        targetDate: '2026-W34',
        periodStart: '2026-08-17T00:00:00.000Z',
        description: 'This week only.',
        points: [{ at: '2026-08-17T09:00:00Z', value: 120 }],
      },
      {
        marketId: 'm-year',
        metricName: YEAR.metricName,
        targetDate: '2026-12',
        periodStart: '2026-12-01T00:00:00.000Z',
        description: 'The whole year.',
        points: [
          { at: '2026-08-01T09:00:00Z', value: 44_000 },
          { at: '2026-01-04T09:00:00Z', value: 137 },
        ],
      },
    ],
    ...overrides,
  } as unknown as PublicWorkspace;
}

describe('which market the floor is about', () => {
  test('the primary is the furthest-resolving one, whatever order the payload used', () => {
    const views = buildHorizonViews(ws());
    expect(views.map(v => v.targetDate)).toEqual(['2026-12', '2026-W34']);
    // Not views[0] by convention at the call site: the module answers it, so a
    // payload that grows or reorders markets cannot re-point a chart.
    expect(primaryHorizonOf(views)!.marketId).toBe('m-year');
  });

  test('a market resolving later than the current primary takes over', () => {
    // The rule is "furthest-resolving", not "the one that was there first".
    const LATER = { ...YEAR, marketId: 'm-2027', targetDate: '2027-12', resolvesOn: '2028-01-01T00:00:00Z' };
    const views = buildHorizonViews(ws({ markets: [WEEK, YEAR, LATER] } as Partial<PublicWorkspace>));
    expect(primaryHorizonOf(views)!.marketId).toBe('m-2027');
  });

  test('one open market is the primary', () => {
    const views = buildHorizonViews(ws({ markets: [YEAR] } as Partial<PublicWorkspace>));
    expect(views).toHaveLength(1);
    expect(primaryHorizonOf(views)!.marketId).toBe('m-year');
  });

  test('no markets, no horizons, no crash', () => {
    expect(buildHorizonViews(null)).toEqual([]);
    expect(buildHorizonViews(ws({ markets: [] } as Partial<PublicWorkspace>))).toEqual([]);
    expect(primaryHorizonOf([])).toBeNull();
  });

  test('the source array is not mutated: the API contract stays soonest-first', () => {
    const payload = ws();
    buildHorizonViews(payload);
    expect(payload.markets!.map(m => m.targetDate)).toEqual(['2026-W34', '2026-12']);
  });
});

describe('what each horizon knows', () => {
  test('label, settle day, unit and definition come from its own market', () => {
    const [decision, pulse] = buildHorizonViews(ws(), new Date('2026-08-19T12:00:00Z'));
    expect(decision.label).toBe('end of 2026');
    expect(decision.settleDay).toBe('31 December 2026');
    expect(decision.unit).toBe('$');
    expect(decision.metricLabel).toBe('LookPilot net 2026');
    expect(decision.description).toBe('The whole year.');
    expect(pulse.label).toBe('this week');
    expect(pulse.settleDay).toBe('23 August 2026');
    expect(pulse.description).toBe('This week only.');
  });

  test('the metric history is its own, oldest first', () => {
    const [decision, pulse] = buildHorizonViews(ws());
    expect(decision.metricHistory.map(p => p.value)).toEqual([137, 44_000]);
    expect(pulse.metricHistory.map(p => p.value)).toEqual([120]);
  });

  test('a horizon with no history row still renders as a horizon', () => {
    const views = buildHorizonViews(ws({ horizonHistories: undefined } as Partial<PublicWorkspace>));
    expect(views).toHaveLength(2);
    expect(views[0].metricHistory).toEqual([]);
    expect(views[0].periodStart).toBeUndefined();
    expect(views[0].description).toBeNull();
  });

  test('unusable readings are dropped, not drawn as gaps', () => {
    const views = buildHorizonViews(
      ws({
        horizonHistories: [
          {
            marketId: 'm-year',
            metricName: YEAR.metricName,
            targetDate: '2026-12',
            periodStart: '2026-12-01T00:00:00.000Z',
            description: null,
            points: [
              { at: null, value: 5 },
              { at: '2026-02-01T00:00:00Z', value: Number.NaN },
              { at: '2026-03-01T00:00:00Z', value: 900 },
            ],
          },
        ],
      } as Partial<PublicWorkspace>),
    );
    expect(views[0].metricHistory.map(p => p.value)).toEqual([900]);
  });

  test('the period start is passed through for the chart axis', () => {
    const [decision, pulse] = buildHorizonViews(ws());
    expect(pulse.periodStart).toBe('2026-08-17T00:00:00.000Z');
    expect(decision.periodStart).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('a price series belongs to one market', () => {
  const payload = ws({
    marketHistory: [{ at: '2026-08-11T06:00:00Z', consensus: 73_600 }],
    marketHistoryMarketId: 'm-year',
  } as Partial<PublicWorkspace>);

  test('the inline replay is used only for the market it names', () => {
    expect(priceSeriesOf('m-year', payload, {})).toHaveLength(1);
    // The bug: the week drew the year's line, then dropped to its own call.
    expect(priceSeriesOf('m-week', payload, {})).toEqual([]);
  });

  test('a fetched series is looked up by market id', () => {
    const fetched = { 'm-week': [{ at: '2026-08-17T09:00:00Z', consensus: 200 }] };
    expect(priceSeriesOf('m-week', payload, fetched)![0].consensus).toBe(200);
    // A fetch for one market never satisfies another.
    expect(priceSeriesOf('m-other', payload, fetched)).toEqual([]);
  });

  test('an unlabelled payload lends its series to nobody', () => {
    const unlabelled = ws({
      marketHistory: [{ at: '2026-08-11T06:00:00Z', consensus: 73_600 }],
    } as Partial<PublicWorkspace>);
    expect(priceSeriesOf('m-year', unlabelled, {})).toEqual([]);
  });

  test('no market, no series', () => {
    expect(priceSeriesOf(null, payload, {})).toEqual([]);
    expect(priceSeriesOf('m-year', null, {})).toEqual([]);
  });
});

describe('the label helpers', () => {
  // A fixed "now" inside ISO week 34 of 2026, so "this week" means something
  // an assertion can check on any day of the year.
  const NOW = new Date('2026-08-19T12:00:00Z');

  test.each([
    ['2026-W34', 'this week'],
    ['2026', 'end of 2026'],
    ['2026-12', 'end of 2026'],
    ['2026-09', 'end of September'],
    ['2026-08', 'this month'],
    ['2026-08-19', 'today'],
    ['2026-08-18', '18 Aug'],
  ])('horizonLabel(%s) is %s', (target, label) => {
    expect(horizonLabel(target, NOW)).toBe(label);
  });

  test('only the current week is called "this week"', () => {
    // Two weekly horizons can be open together ("+0w" beside "+1w"), and a
    // rolled-over week stays on the page until the hourly refresh. Two buttons
    // both reading "this week" name nothing.
    expect(horizonLabel('2026-W35', NOW)).toBe('week to 30 Aug');
    expect(horizonLabel('2026-W33', NOW)).toBe('week to 16 Aug');
    // At the very end of the week it is still this week.
    expect(horizonLabel('2026-W34', new Date('2026-08-23T23:59:00Z'))).toBe('this week');
    expect(horizonLabel('2026-W34', new Date('2026-08-24T00:01:00Z'))).toBe('week to 23 Aug');
  });

  test.each([
    ['2026-W34', '23 August 2026'],
    ['2026-W01', '4 January 2026'],
    ['2026', '31 December 2026'],
    ['2026-12', '31 December 2026'],
    ['2026-02', '28 February 2026'],
    ['2026-08-15', '15 August 2026'],
  ])('settleDayOf(%s) is %s', (target, day) => {
    expect(settleDayOf(target)).toBe(day);
  });

  test('the currency is the tail, and only the tail', () => {
    expect(currencyOf('Revenue (USD)')).toBe('$');
    expect(currencyOf('Revenue ($)')).toBe('$');
    expect(currencyOf('Weekly active verified traders')).toBe('');
    expect(currencyOf('USD earned per user')).toBe('');
  });

  test('the display label drops the tail', () => {
    expect(metricLabelOf('LookPilot net 2026 (USD)')).toBe('LookPilot net 2026');
    expect(metricLabelOf('Weekly active verified traders')).toBe('Weekly active verified traders');
  });
});

describe('captionLabel', () => {
  // The floor's identity block names the company one line above the caption,
  // so repeating it there says LookPilot twice and buries "net 2026".
  test('drops the workspace name when the metric leads with it', () => {
    expect(captionLabel('LookPilot net 2026', 'LookPilot')).toBe('net 2026');
    expect(captionLabel('LookPilot: net 2026', 'LookPilot')).toBe('net 2026');
    expect(captionLabel('lookpilot net 2026', 'LookPilot')).toBe('net 2026');
  });

  test('leaves a label that does not lead with the name alone', () => {
    expect(captionLabel('Steam review percentage', 'LookPilot')).toBe('Steam review percentage');
    // A name that is only the start of a longer word is not a prefix.
    expect(captionLabel('LookPilotter revenue', 'LookPilot')).toBe('LookPilotter revenue');
  });

  test('never strips the label down to nothing', () => {
    expect(captionLabel('LookPilot', 'LookPilot')).toBe('LookPilot');
    expect(captionLabel('LookPilot net 2026', '')).toBe('LookPilot net 2026');
    expect(captionLabel('LookPilot net 2026', null)).toBe('LookPilot net 2026');
  });
});

/**
 * Stepping between clocks (owner ask 2026-08-20: arrows beside the metric's
 * name). Selection is a market id, never an index, so the cases that matter
 * are the ones where the list changes underneath a held selection.
 */
describe('stepping between horizons', () => {
  const views = buildHorizonViews(ws()); // [year, week], furthest first

  test('no selection opens on the primary', () => {
    expect(horizonById(views, null)?.marketId).toBe('m-year');
    expect(horizonById(views, undefined)?.marketId).toBe('m-year');
  });

  test('a held id survives, and a stale one falls back rather than blanking', () => {
    expect(horizonById(views, 'm-week')?.marketId).toBe('m-week');
    // The market a reader was looking at settled under them.
    expect(horizonById(views, 'm-gone')?.marketId).toBe('m-year');
  });

  test('two metrics on the fixture: the metric arrows walk them, and loop', () => {
    // WEEK and YEAR are different metrics with one date each, so on this
    // floor the metric stepper is the only one that moves.
    expect(stepMetric(views, 'm-year', 1)?.marketId).toBe('m-week');
    expect(stepMetric(views, 'm-week', -1)?.marketId).toBe('m-year');
    // Owner ask 2026-08-20. Off the end of the list is the other end of it.
    expect(stepMetric(views, 'm-year', -1)?.marketId).toBe('m-week');
    expect(stepMetric(views, 'm-week', 1)?.marketId).toBe('m-year');
  });

  test('a metric with one open date has no date arrows', () => {
    expect(stepDate(views, 'm-year', 1)).toBeNull();
    expect(stepDate(views, 'm-week', -1)).toBeNull();
  });

  test('a floor with one market renders neither stepper', () => {
    const one = buildHorizonViews(ws({ markets: [YEAR] }));
    expect(stepMetric(one, 'm-year', 1)).toBeNull();
    expect(stepDate(one, 'm-year', 1)).toBeNull();
  });

  test('an empty floor steps to nothing instead of throwing', () => {
    expect(stepMetric([], 'm-year', 1)).toBeNull();
    expect(stepDate([], 'm-year', 1)).toBeNull();
    expect(horizonById([], 'm-year')).toBeNull();
  });
});

/**
 * The settle day the caption's date line puts after the clock's name (owner
 * ask 2026-08-20). Computed from the market's target date, never stored on
 * the metric, which is the whole point: the weekly market rolls to a new
 * target every Monday and nothing has to be renamed.
 */
describe('settleShortOf', () => {
  const inYear = new Date('2026-08-20T12:00:00Z');

  test('a week settles on its Sunday, and the current year is left off', () => {
    // The PERIOD ends on Sunday the 23rd; the market's resolvesOn is midnight
    // into the 24th. The caption names the day the week ended, not the instant
    // the payout ran, because that is the day a reader is forecasting.
    expect(settleShortOf('2026-W34', inYear)).toBe('23 Aug');
  });

  test('a month settles on its last day', () => {
    expect(settleShortOf('2026-09', inYear)).toBe('30 Sep');
    expect(settleShortOf('2026-10-14', inYear)).toBe('14 Oct');
  });

  test('another year is named, because that is the only thing that matters then', () => {
    expect(settleShortOf('2027-W02', inYear)).toBe('17 Jan 2027');
    expect(settleShortOf('2026-12', inYear)).toBe('31 Dec');
  });

  test('a target date nothing can be made of gives null, not a guess', () => {
    expect(settleShortOf('whenever', inYear)).toBeNull();
  });

  test('the caption date rolls with the market, with no rename anywhere', () => {
    // The same metric, two weeks running: this is what would go stale if the
    // date lived in the stored metric name instead.
    expect(settleShortOf('2026-W34', inYear)).toBe('23 Aug');
    expect(settleShortOf('2026-W35', inYear)).toBe('30 Aug');
  });
});

/**
 * The grid (owner ask 2026-08-25): two metrics, each read today, this week
 * and this month, plus the hero's absolute September market. Soonest-first
 * as the API ships it, with ties on the settle instant between the metrics.
 */
const NOW_GRID = new Date('2026-08-25T12:00:00Z');
const cell = (
  marketId: string,
  metricId: string,
  metricName: string,
  metricOrder: number | null,
  targetDate: string,
  resolvesOn: string,
) => ({
  marketId,
  metricId,
  metricName,
  metricOrder,
  targetDate,
  resolvesOn,
  consensus: 10,
  probability: 0.5,
  liquidity: 100,
  rangeMin: 0,
  rangeMax: 100,
});
const REV = 'LookPilot net revenue, trailing 30 days (USD)';
const REVIEWS = 'LookPilot Steam reviews';
const GRID = [
  cell('rev-day', 'rev', REV, 1, '2026-08-25', '2026-08-26T00:00:00Z'),
  cell('rvw-day', 'rvw', REVIEWS, 2, '2026-08-25', '2026-08-26T00:00:00Z'),
  cell('rev-week', 'rev', REV, 1, '2026-W35', '2026-08-31T00:00:00Z'),
  cell('rvw-week', 'rvw', REVIEWS, 2, '2026-W35', '2026-08-31T00:00:00Z'),
  cell('rvw-month', 'rvw', REVIEWS, 2, '2026-08', '2026-09-01T00:00:00Z'),
  cell('rev-month', 'rev', REV, 1, '2026-08', '2026-09-01T00:00:00Z'),
  cell('rev-sep', 'rev', REV, 1, '2026-09', '2026-10-01T00:00:00Z'),
];

describe('a floor that prices several metrics', () => {
  const grid = buildHorizonViews(ws({ markets: GRID, horizonHistories: [] }), NOW_GRID);

  test('the primary is the furthest-resolving market, whatever the payload order', () => {
    expect(primaryHorizonOf(grid)?.marketId).toBe('rev-sep');
    const shuffled = buildHorizonViews(ws({ markets: [...GRID].reverse(), horizonHistories: [] }), NOW_GRID);
    expect(primaryHorizonOf(shuffled)?.marketId).toBe('rev-sep');
  });

  test('a tie on the settle instant goes to the lower metric order, never to liquidity', () => {
    // Drop September: both metrics now end on 1 September. Reviews has more
    // liquidity in this payload and still loses on order.
    const tied = GRID.filter(m => m.marketId !== 'rev-sep').map(m =>
      m.marketId === 'rvw-month' ? { ...m, liquidity: 9_999 } : m,
    );
    expect(primaryHorizonOf(buildHorizonViews(ws({ markets: tied, horizonHistories: [] }), NOW_GRID))?.marketId).toBe(
      'rev-month',
    );
    // Without orders at all, the earlier name wins the tie, and the rule is total.
    const unordered = tied.map(m => ({ ...m, metricOrder: null }));
    expect(
      primaryHorizonOf(buildHorizonViews(ws({ markets: unordered, horizonHistories: [] }), NOW_GRID))?.marketId,
    ).toBe('rvw-month');
  });

  test('the list is grouped by metric, primary metric first, dates furthest first', () => {
    expect(grid.map(v => v.marketId)).toEqual([
      'rev-sep',
      'rev-month',
      'rev-week',
      'rev-day',
      'rvw-month',
      'rvw-week',
      'rvw-day',
    ]);
    expect(metricsOf(grid).map(v => v.metricId)).toEqual(['rev', 'rvw']);
    expect(datesOf(grid, 'rvw').map(v => v.targetDate)).toEqual(['2026-08', '2026-W35', '2026-08-25']);
  });

  test('the date arrows stay inside the metric, and loop', () => {
    expect(stepDate(grid, 'rev-sep', 1)?.marketId).toBe('rev-month');
    expect(stepDate(grid, 'rev-day', 1)?.marketId).toBe('rev-sep');
    expect(stepDate(grid, 'rev-sep', -1)?.marketId).toBe('rev-day');
    expect(stepDate(grid, 'rvw-day', -1)?.marketId).toBe('rvw-week');
  });

  test('the metric arrows keep the date when the next metric has it', () => {
    expect(stepMetric(grid, 'rev-week', 1)?.marketId).toBe('rvw-week');
    expect(stepMetric(grid, 'rvw-day', -1)?.marketId).toBe('rev-day');
  });

  test("and fall to that metric's furthest date when it does not", () => {
    // Reviews has no September market.
    expect(stepMetric(grid, 'rev-sep', 1)?.marketId).toBe('rvw-month');
  });

  test('the date line names the clock and its settle day, both computed', () => {
    expect(dateLineOf(horizonById(grid, 'rev-day'))).toBe('today @ 25 Aug');
    expect(dateLineOf(horizonById(grid, 'rev-week'))).toBe('this week @ 30 Aug');
    expect(dateLineOf(horizonById(grid, 'rev-month'))).toBe('this month @ 31 Aug');
    expect(dateLineOf(horizonById(grid, 'rev-sep'))).toBe('end of September @ 30 Sep');
    expect(dateLineOf(null)).toBe('');
  });

  test('a day that has ended is a date, not "today"', () => {
    const later = buildHorizonViews(ws({ markets: GRID, horizonHistories: [] }), new Date('2026-08-26T00:30:00Z'));
    expect(dateLineOf(horizonById(later, 'rev-day'))).toBe('@ 25 Aug');
  });
});
