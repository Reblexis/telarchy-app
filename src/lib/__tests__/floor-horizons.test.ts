import { describe, expect, test } from 'vitest';
import {
  buildHorizonViews, captionLabel, currencyOf, horizonLabel, metricLabelOf, priceSeriesOf, primaryHorizonOf, settleDayOf,
} from '../floor-horizons';
import type { PublicWorkspace } from '../api';

/**
 * The floor's horizon model.
 *
 * Everything the page shows about "the clock on screen" comes from here, and
 * the reason it does is a run of bugs that all had the same shape: a surface
 * decided what a horizon was from its position in an array, and the array's
 * order changed under it.
 */

const WEEK = {
  marketId: 'm-week', metricId: 'metric-w', metricName: 'LookPilot revenue this week (USD)',
  targetDate: '2026-W34', resolvesOn: '2026-08-24T00:00:00Z', consensus: 213,
  probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 8000,
};
const YEAR = {
  marketId: 'm-year', metricId: 'metric-y', metricName: 'LookPilot net 2026 (USD)',
  targetDate: '2026-12', resolvesOn: '2027-01-01T00:00:00Z', consensus: 78_571,
  probability: 0.52, liquidity: 5000, rangeMin: 0, rangeMax: 150_000,
};

/** Soonest-first, exactly as the API ships it. */
function ws(overrides: Partial<PublicWorkspace> = {}): PublicWorkspace {
  return {
    markets: [WEEK, YEAR],
    horizonHistories: [
      {
        marketId: 'm-week', metricName: WEEK.metricName, targetDate: '2026-W34',
        periodStart: '2026-08-17T00:00:00.000Z', description: 'This week only.',
        points: [{ at: '2026-08-17T09:00:00Z', value: 120 }],
      },
      {
        marketId: 'm-year', metricName: YEAR.metricName, targetDate: '2026-12',
        periodStart: '2026-12-01T00:00:00.000Z', description: 'The whole year.',
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
    const views = buildHorizonViews(ws({
      horizonHistories: [{
        marketId: 'm-year', metricName: YEAR.metricName, targetDate: '2026-12',
        periodStart: '2026-12-01T00:00:00.000Z', description: null,
        points: [
          { at: null, value: 5 },
          { at: '2026-02-01T00:00:00Z', value: Number.NaN },
          { at: '2026-03-01T00:00:00Z', value: 900 },
        ],
      }],
    } as Partial<PublicWorkspace>));
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
    const unlabelled = ws({ marketHistory: [{ at: '2026-08-11T06:00:00Z', consensus: 73_600 }] } as Partial<PublicWorkspace>);
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
    expect(captionLabel('Steam review percentage', 'LookPilot'))
      .toBe('Steam review percentage');
    // A name that is only the start of a longer word is not a prefix.
    expect(captionLabel('LookPilotter revenue', 'LookPilot')).toBe('LookPilotter revenue');
  });

  test('never strips the label down to nothing', () => {
    expect(captionLabel('LookPilot', 'LookPilot')).toBe('LookPilot');
    expect(captionLabel('LookPilot net 2026', '')).toBe('LookPilot net 2026');
    expect(captionLabel('LookPilot net 2026', null)).toBe('LookPilot net 2026');
  });
});
