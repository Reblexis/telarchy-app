import { render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { MarketChart } from '../MarketChart';

/**
 * Prices print in the call chart's own whole-number format (fullNum).
 *
 * The CALL view of a proposal with options (docs/ui-conventions.md, "The
 * chart draws every option"): the selected option is the loud line, labelled
 * with its name at its right end; every other option is a thinner muted
 * line labelled the same way. No "without it" line: there is no baseline.
 */
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
const NOW = new Date('2026-09-11T12:00:00Z').getTime();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const draw = (extra: Record<string, unknown> = {}) =>
  render(
    <MarketChart
      series={[
        { at: iso(3_600_000), consensus: 6 },
        { at: iso(600_000), consensus: 9 },
      ]}
      consensus={9}
      endLabel="Turn left"
      others={[
        { label: 'Continue', consensus: 7, series: [{ at: iso(1_800_000), consensus: 7 }] },
        { label: 'Turn right', consensus: 2, series: [] },
      ]}
      {...(extra as object)}
    />,
  );

describe('THE CALL CHART DRAWS EVERY OPTION', () => {
  test('one quiet line per other option, each labelled at its right end with its price and name', () => {
    const { container } = draw();
    const others = [...container.querySelectorAll('.mchart-other')];
    expect(others).toHaveLength(2);
    for (const o of others) expect(o.querySelector('path.mchart-other-line')).toBeTruthy();
    expect(others.map(o => words(o.querySelector('.mchart-other-label')))).toEqual(['7 Continue', '2 Turn right']);
  });

  test('the loud line is the selected option, its end label naming it', () => {
    const { container } = draw();
    expect(words(container.querySelector('.mchart-calllabel'))).toBe('9 Turn left');
    expect(words(container.querySelector('svg'))).not.toMatch(/without it|if approved|if declined/);
  });

  test("every option's price is on the canvas: the y domain widens to the lowest other", () => {
    const { container } = draw();
    const svg = container.querySelector('svg') as SVGSVGElement;
    const h = Number((svg.getAttribute('viewBox') ?? '0 0 0 0').split(' ')[3]);
    for (const dot of container.querySelectorAll('.mchart-other-dot')) {
      const y = Number(dot.getAttribute('cy'));
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(h);
    }
  });

  test('without others or an end label the call chart is as before', () => {
    const { container } = render(<MarketChart series={[{ at: iso(600_000), consensus: 8 }]} consensus={8} />);
    expect(container.querySelector('.mchart-other')).toBeNull();
    expect(words(container.querySelector('.mchart-calllabel'))).toBe('8');
  });
});
