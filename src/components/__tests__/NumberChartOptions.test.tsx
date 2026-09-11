import { render } from '@testing-library/react';
import { beforeAll, describe, expect, test } from 'vitest';
import { NumberChart } from '../NumberChart';

/**
 * The chart of a proposal with options (docs/ui-conventions.md, "A proposal
 * with options shows one world per option", "The chart draws every
 * option"): one line per option, the selected one in the green and full
 * weight, the others thinner in the muted ink, each labelled with its
 * option's name at its right end where the pair chart prints its two
 * prices. No baseline "without it" line.
 */
beforeAll(() => {
  if (!window.matchMedia) {
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
  }
});

const NOW = new Date('2026-09-11T12:00:00Z');
const SETTLE = '2026-09-11T17:31:00Z';
const readings = [
  { at: '2026-09-11T10:00:00Z', value: 4 },
  { at: '2026-09-11T11:00:00Z', value: 6 },
];
const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const series = () => [
  {
    id: 'forward',
    label: 'Continue',
    points: [
      { at: '2026-09-11T11:10:00Z', value: 6 },
      { at: '2026-09-11T11:40:00Z', value: 7.2 },
    ],
    consensus: 7.2,
    emphasis: false,
  },
  {
    id: 'left',
    label: 'Turn left',
    points: [
      { at: '2026-09-11T11:10:00Z', value: 6 },
      { at: '2026-09-11T11:30:00Z', value: 8 },
      { at: '2026-09-11T11:50:00Z', value: 8.9 },
    ],
    consensus: 8.9,
    emphasis: true,
  },
  { id: 'right', label: 'Turn right', points: [], consensus: null, emphasis: false },
];

const draw = (extra: Record<string, unknown> = {}) =>
  render(
    <NumberChart
      points={readings}
      markers={[{ marketId: 'm-len', resolvesOn: SETTLE, consensus: 6, selected: true }]}
      selectedResolvesOn={SETTLE}
      granularity="day"
      unit=""
      now={NOW}
      series={series()}
      {...(extra as object)}
    />,
  );
const xsOf = (d: string | null) => [...(d ?? '').matchAll(/[ML]([\d.-]+) /g)].map(m => Number(m[1]));

describe('THE CHART DRAWS EVERY OPTION', () => {
  test('one line per priced option, the selected one alone at full weight; an unpriced option draws nothing', () => {
    const { container } = draw();
    const lines = [...container.querySelectorAll('.nchart-series')];
    expect(lines.map(l => l.getAttribute('data-option'))).toEqual(['forward', 'left']);
    expect(lines.filter(l => l.classList.contains('is-selected')).map(l => l.getAttribute('data-option'))).toEqual([
      'left',
    ]);
  });

  test("each line runs through its market's call history and holds to the settle instant, where its end is", () => {
    const { container } = draw();
    const left = container.querySelector('.nchart-series[data-option="left"] path') as SVGPathElement;
    const xs = xsOf(left.getAttribute('d'));
    // Three traded points, then the hold to the settle instant.
    expect(xs).toHaveLength(4);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    const settleX = Number(container.querySelector('.nchart-marker.is-selected line')?.getAttribute('x1'));
    expect(xs[xs.length - 1]).toBeCloseTo(settleX, 3);
  });

  test("each line is labelled at its right end with its price and its option's name", () => {
    const { container } = draw();
    const labels = [...container.querySelectorAll('.nchart-series-label')].map(words);
    expect(labels).toEqual(expect.arrayContaining(['7.2 Continue', '8.9 Turn left']));
    expect(labels).toHaveLength(2);
    expect(words(container.querySelector('svg'))).not.toMatch(/Turn right/);
  });

  test('no baseline: no "without it", no unconditional call dot on the settle marker, no pair anatomy', () => {
    const { container } = draw();
    const svgText = words(container.querySelector('svg'));
    expect(svgText).not.toMatch(/without it/);
    expect(svgText).not.toMatch(/if approved|if declined/);
    expect(container.querySelector('.nchart-marker.is-selected circle')).toBeNull();
    expect(container.querySelector('.nchart-marker.is-selected .nchart-now-label')).toBeNull();
    expect(container.querySelector('.nchart-pair-bar')).toBeNull();
  });

  test('the y axis makes room for every option: every line end sits inside the plot', () => {
    const { container } = draw({
      series: [
        { id: 'a', label: 'A', points: [], consensus: 40, emphasis: true },
        { id: 'b', label: 'B', points: [], consensus: 2, emphasis: false },
      ],
    });
    const svg = container.querySelector('svg') as SVGSVGElement;
    const h = Number((svg.getAttribute('viewBox') ?? '0 0 0 0').split(' ')[3]);
    const ys = [...container.querySelectorAll('.nchart-series-dot')].map(o => Number(o.getAttribute('cy')));
    expect(ys).toHaveLength(2);
    for (const y of ys) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(h);
    }
  });

  test('an option nobody has traded yet is a held line from now to the settle instant, never a lone dot', () => {
    const { container } = draw({
      series: [
        { id: 'a', label: 'A', points: [], consensus: 5, emphasis: true },
        { id: 'b', label: 'B', points: [], consensus: 3, emphasis: false },
      ],
    });
    const xs = xsOf(container.querySelector('.nchart-series[data-option="a"] path')?.getAttribute('d') ?? null);
    expect(xs).toHaveLength(2);
    expect(xs[1]).toBeGreaterThan(xs[0]);
  });

  test('the legend names the options with the selected one marked, not "if approved" / "if not" / "the market now"', () => {
    const { container } = draw({ marksLegend: true });
    const legend = container.querySelector('.nchart-legend') as HTMLElement;
    const items = [...legend.querySelectorAll(':scope > span')].map(words);
    expect(items).toEqual(['Continue', 'Turn left']);
    expect(legend.querySelectorAll('.is-selected')).toHaveLength(1);
    expect(words(legend.querySelector('.is-selected'))).toBe('Turn left');
    expect(words(legend)).not.toMatch(/if approved|if not|the market now|market's call/i);
  });

  test('without series the pair anatomy is exactly as before', () => {
    const { container } = render(
      <NumberChart
        points={readings}
        markers={[
          { marketId: 'm-len', resolvesOn: SETTLE, consensus: 6, selected: true, pair: { approved: 7.4, declined: 6 } },
        ]}
        selectedResolvesOn={SETTLE}
        granularity="day"
        unit=""
        now={NOW}
        legend={{ approved: 'if paid', declined: 'if not' }}
      />,
    );
    expect(container.querySelector('.nchart-pair-bar')).toBeTruthy();
    expect(container.querySelector('.nchart-series')).toBeNull();
    expect(words(container.querySelector('.nchart-marker'))).toMatch(/without it/);
    expect(words(container.querySelector('.nchart-legend'))).toMatch(/if paid.*if not.*the market now/);
  });
});
