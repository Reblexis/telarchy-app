import { describe, expect, test } from 'vitest';
import {
  buildHorizonViews, currencyOf, decisionOf, horizonLabel, metricLabelOf, priceSeriesOf, settleDayOf,
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

describe('order and role', () => {
  test('furthest-resolving first, and index 0 is the decision', () => {
    const views = buildHorizonViews(ws());
    expect(views.map(v => v.targetDate)).toEqual(['2026-12', '2026-W34']);
    expect(views.map(v => v.role)).toEqual(['decision', 'pulse']);
    expect(decisionOf(views)!.marketId).toBe('m-year');
  });

  test('each horizon carries its own caption', () => {
    // The caption used to be chosen by comparing an index to the array length,
    // which inverted the day the list was reversed: "speed, not the decision"
    // printed beside "end of 2026" (owner report 2026-08-17).
    const [decision, pulse] = buildHorizonViews(ws());
    expect(decision.roleNote).toBe('the number I fund on');
    expect(pulse.roleNote).toBe('speed, not the decision');
  });

  test('a single-clock floor has one horizon, and it is the decision', () => {
    const views = buildHorizonViews(ws({ markets: [YEAR] } as Partial<PublicWorkspace>));
    expect(views).toHaveLength(1);
    expect(views[0].role).toBe('decision');
  });

  test('no markets, no horizons, no crash', () => {
    expect(buildHorizonViews(null)).toEqual([]);
    expect(buildHorizonViews(ws({ markets: [] } as Partial<PublicWorkspace>))).toEqual([]);
    expect(decisionOf([])).toBeNull();
  });

  test('the source array is not mutated: the API contract stays soonest-first', () => {
    const payload = ws();
    buildHorizonViews(payload);
    expect(payload.markets!.map(m => m.targetDate)).toEqual(['2026-W34', '2026-12']);
  });
});

describe('what each horizon knows', () => {
  test('label, settle day, unit and definition come from its own market', () => {
    const [decision, pulse] = buildHorizonViews(ws());
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
  test.each([
    ['2026-W34', 'this week'],
    ['2026', 'end of 2026'],
    ['2026-12', 'end of 2026'],
    ['2026-09', 'end of September'],
  ])('horizonLabel(%s) is %s', (target, label) => {
    expect(horizonLabel(target)).toBe(label);
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
