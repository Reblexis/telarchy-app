import { describe, expect, test } from 'vitest';
import type { PublicWorkspace } from '../api';
import {
  buildHorizonViews,
  dateQuestionOf,
  dateSegmentOf,
  datesOf,
  forecastDayOf,
  horizonLabel,
  moveQuestionOf,
  settleInstant,
  settleShortOf,
  timeLeftOf,
} from '../floor-horizons';
import { describeEntry, entryFor, resolveEntry } from '../horizon-entries';

/**
 * A date that settles when the owner settles it, and a title for any date,
 * as the floor and the sheet read them (docs/ui-conventions.md, "The
 * question line", "The stat row"; docs/owner-on-the-floor.md, dialog 2).
 */

const NOW = new Date('2026-09-14T10:00:00Z');
const FAR = '9999-12-31T00:00:00.000Z';

const market = (over: Record<string, unknown>) => ({
  marketId: 'm',
  metricId: 'len',
  metricName: 'Reached length',
  metricOrder: 0,
  targetDate: '2026-W38',
  resolvesOn: '2026-09-21T00:00:00.000Z',
  consensus: 20,
  probability: 0.5,
  liquidity: 100,
  pool: 3000,
  rangeMin: 0,
  rangeMax: 64,
  ...over,
});

const ws = (markets: Array<Record<string, unknown>>) =>
  ({ markets, horizonHistories: [], marketHistory: [] }) as unknown as PublicWorkspace;

describe('the entry, on the sheet', () => {
  test('until-settled reads as what it is, and resolves to itself', () => {
    const e = describeEntry('until-settled');
    expect(e.every).toBe('settled');
    expect(e.label).toBe('Until you settle it');
    expect(resolveEntry('until-settled', NOW)).toBe('until-settled');
  });

  test('choosing "When I settle it" stores until-settled', () => {
    expect(entryFor('settled', 0, '', '')).toBe('until-settled');
  });
});

describe('an until-settled book on the floor has no clock', () => {
  const [v] = buildHorizonViews(ws([market({ targetDate: 'until-settled', resolvesOn: FAR })]), NOW);

  test('it is marked as settled by the owner', () => {
    expect(v.settlesByOwner).toBe(true);
  });

  test('untitled, it is called "until settled"', () => {
    expect(horizonLabel('until-settled', NOW)).toBe('until settled');
    expect(v.label).toBe('until settled');
    expect(dateQuestionOf(v)).toEqual({ word: 'until settled', lead: '' });
  });

  test('it names no day, no short day and no time left', () => {
    expect(v.settleDay).toBeNull();
    expect(v.settleShort).toBeNull();
    expect(settleShortOf('until-settled', NOW)).toBeNull();
    expect(timeLeftOf(v, NOW)).toBeNull();
  });

  test('the far instant is never read as a day or a moment', () => {
    expect(forecastDayOf(FAR)).toBeNull();
    expect(settleInstant(FAR)).toBe('when the owner settles it');
  });

  test('beside dated books it is the furthest, so the soonest-first strip puts it last', () => {
    const views = buildHorizonViews(
      ws([market({ marketId: 'wk' }), market({ marketId: 'open', targetDate: 'until-settled', resolvesOn: FAR })]),
      NOW,
    );
    const soonestFirst = [...datesOf(views, 'len')].reverse();
    expect(soonestFirst.map(x => x.marketId)).toEqual(['wk', 'open']);
  });
});

describe('the number chart never stretches its axis to a date with no clock', () => {
  test('a window asked to end at the far instant ends at now', async () => {
    const { windowFor } = await import('../../components/NumberChart');
    const [start, end] = windowFor(FAR, null, [{ at: '2026-09-14T07:05:00Z', value: 2 }], NOW);
    expect(end - start).toBeLessThan(2 * 86_400_000);
    expect(end).toBeLessThan(Date.parse('2026-09-15T00:00:00Z'));
  });
});

describe('a titled date reads as its title', () => {
  test('the title replaces the clock name on the tab, the segment and the question, with no lead word', () => {
    const [v] = buildHorizonViews(
      ws([market({ targetDate: 'until-settled', resolvesOn: FAR, dateTitle: 'this attempt' })]),
      NOW,
    );
    expect(v.label).toBe('this attempt');
    expect(dateSegmentOf(v)).toBe('this attempt');
    expect(dateQuestionOf(v)).toEqual({ word: 'this attempt', lead: '' });
  });

  test('a dated book takes its title too, and keeps its settle day', () => {
    const [v] = buildHorizonViews(ws([market({ dateTitle: 'at the end of season 1' })]), NOW);
    expect(v.label).toBe('at the end of season 1');
    expect(dateQuestionOf(v)).toEqual({ word: 'at the end of season 1', lead: '' });
    expect(v.settleDay).not.toBeNull();
    expect(v.settlesByOwner).toBe(false);
  });

  test('a titled minute cell reads its title on a game floor, not a move count', () => {
    const [v] = buildHorizonViews(
      ws([market({ targetDate: '2026-09-14T11:00', resolvesOn: '2026-09-14T11:01:00.000Z', dateTitle: 'next hour' })]),
      NOW,
    );
    expect(moveQuestionOf(v, NOW)).toEqual({ word: 'next hour', lead: '' });
  });

  test('a blank title is no title', () => {
    const [v] = buildHorizonViews(ws([market({ dateTitle: '   ' })]), NOW);
    expect(v.label).not.toBe('   ');
    expect(v.label).toMatch(/week|Sep/);
  });
});
