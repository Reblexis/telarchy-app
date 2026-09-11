import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { GEOM } from '../MarketChart';
import { dodge, granularityOf, NumberChart, RANGE_WORDS, windowFor } from '../NumberChart';

/**
 * The number view follows the market on screen (docs/ui-conventions.md,
 * "The price and the chart"): its window ends at the selected settle instant
 * and spans the selected horizon, and the other open markets are grey
 * context, or a chevron when they fall outside the window.
 */
const NOW = new Date('2026-08-25T18:00:00Z');
const points = [
  { at: '2026-07-27T10:00:00Z', value: 2 },
  { at: '2026-08-10T10:00:00Z', value: 4 },
  { at: '2026-08-25T10:00:00Z', value: 5 },
];

describe('the window follows the selected horizon', () => {
  test('a day market shows about two days ending at its settle instant', () => {
    const [a, b] = windowFor('2026-08-26T00:00:00Z', RANGE_WORDS.day[0].ms, points, NOW);
    expect(new Date(a).toISOString()).toBe('2026-08-23T18:00:00.000Z');
    expect(b).toBeGreaterThan(new Date('2026-08-26T00:00:00Z').getTime());
  });

  test('a far market shows the last month of readings, then the future to its settle instant', () => {
    const [a, b] = windowFor('2026-10-01T00:00:00Z', RANGE_WORDS.month[0].ms, points, NOW);
    expect(new Date(a).toISOString()).toBe('2026-07-26T18:00:00.000Z');
    expect(b).toBeGreaterThan(new Date('2026-10-01T00:00:00Z').getTime());
  });

  test('ALL starts at the first reading', () => {
    const [a] = windowFor('2026-10-01T00:00:00Z', null, points, NOW);
    expect(new Date(a).toISOString()).toBe('2026-07-27T10:00:00.000Z');
  });

  test('a market that has passed its instant still shows the window up to now', () => {
    const [, b] = windowFor('2026-08-25T00:00:00Z', RANGE_WORDS.day[0].ms, points, NOW);
    expect(b).toBeGreaterThanOrEqual(NOW.getTime());
  });

  test('granularity comes from the target date', () => {
    expect(granularityOf('2026-08-26')).toBe('day');
    expect(granularityOf('2026-W35')).toBe('week');
    expect(granularityOf('2026-09')).toBe('month');
    expect(granularityOf('2026')).toBe('other');
  });
});

describe('every open date in the band is the date control', () => {
  // docs/ui-conventions.md, "The price and the chart" (2026-09-09): a reader
  // who can see four dots priced differently and cannot press them is being
  // shown a control that is not one.
  const markers = [
    { marketId: 'today', resolvesOn: '2026-08-26T00:00:00Z', consensus: 6, selected: true },
    { marketId: 'week', resolvesOn: '2026-08-31T00:00:00Z', consensus: 6.5, selected: false },
    { marketId: 'sep', resolvesOn: '2026-10-01T00:00:00Z', consensus: 19.8, selected: false },
  ];
  const wide = (onPickDate?: (id: string) => void) =>
    render(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
        onPickDate={onPickDate}
      />,
    );

  test('an unselected marker is a button that names the date it would switch to', () => {
    const picked: string[] = [];
    const { container } = wide(id => picked.push(id));
    const buttons = [...container.querySelectorAll('.nchart-marker[role="button"]')];
    expect(buttons.length).toBeGreaterThan(0);
    const week = container.querySelector('.nchart-marker[data-market="week"]') as SVGGElement;
    expect(week.getAttribute('role')).toBe('button');
    expect(week.getAttribute('aria-label')).toMatch(/6\.5/);
    fireEvent.click(week);
    expect(picked).toEqual(['week']);
  });

  test('the selected marker is not pressable: it is where you already are', () => {
    const picked: string[] = [];
    const { container } = wide(id => picked.push(id));
    const selected = container.querySelector('.nchart-marker.is-selected') as SVGGElement;
    expect(selected.getAttribute('role')).toBeNull();
    fireEvent.click(selected);
    expect(picked).toEqual([]);
  });

  test('with no handler nothing is pressable, so the chart stays a picture', () => {
    const { container } = wide();
    expect(container.querySelector('.nchart-marker[role="button"]')).toBeNull();
  });

  test('an unselected marker carries its call in the quiet register', () => {
    const { container } = wide(() => {});
    const week = container.querySelector('.nchart-marker[data-market="week"]') as SVGGElement;
    expect(week.textContent).toContain('6.5');
  });
});

describe('the markers', () => {
  const markers = [
    { marketId: 'today', resolvesOn: '2026-08-26T00:00:00Z', consensus: 6, selected: true },
    { marketId: 'week', resolvesOn: '2026-08-31T00:00:00Z', consensus: 6.5, selected: false },
    { marketId: 'sep', resolvesOn: '2026-10-01T00:00:00Z', consensus: 19.8, selected: false },
  ];

  test('the selected market is the labeled one; the others are grey or beyond the edge', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-08-26T00:00:00Z"
        granularity="day"
        now={NOW}
      />,
    );
    const selected = container.querySelectorAll('.nchart-marker.is-selected');
    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toContain('6');
    // Week and September lie beyond a two-day window and are simply not drawn.
    expect(container.querySelectorAll('.nchart-marker').length).toBe(1);
  });

  test('with September selected the near markers are in the window, grey, each with its call', () => {
    const sel = markers.map(m => ({ ...m, selected: m.marketId === 'sep' }));
    const { container } = render(
      <NumberChart
        points={points}
        markers={sel}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
      />,
    );
    expect(container.querySelectorAll('.nchart-marker').length).toBe(3);
    // Since 2026-09-09 an unselected date carries its own call in the quiet
    // register, so the date strip and the settlement band agree.
    expect(container.querySelectorAll('.nchart-marker-val').length).toBe(2);
    const grey = [...container.querySelectorAll('.nchart-marker:not(.is-selected) .nchart-marker-val')].map(
      t => t.textContent,
    );
    expect(grey).toEqual(['6', '6.5']);
  });

  test("the composed bet's ghost draws on the selected marker", () => {
    // Owner ask 2026-08-28: the impact of the bet being composed is visible
    // on the metric chart too, in the market chart's ghost vocabulary.
    const { container } = render(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-08-26T00:00:00Z"
        granularity="day"
        now={NOW}
        preview={{ value: 9, direction: 'higher' }}
      />,
    );
    const ghost = container.querySelector('.nchart-marker.is-selected .mchart-ghost');
    expect(ghost).toBeTruthy();
    expect(ghost?.querySelector('.mchart-ghost-dot')).toBeTruthy();
    expect(container.querySelector('.nchart-marker.is-selected')?.textContent).toContain('▲ 9');
  });

  test("the range words are the granularity's", () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-08-26T00:00:00Z"
        granularity="day"
        now={NOW}
      />,
    );
    expect([...container.querySelectorAll('.mchart-range')].map(b => b.textContent)).toEqual(['2D', '1W', 'ALL']);
  });
});

describe('a metric with no reading yet', () => {
  test('says so instead of drawing a line at zero', () => {
    const { container } = render(
      <NumberChart
        points={[]}
        markers={[{ marketId: 'sep', resolvesOn: '2026-10-01T00:00:00Z', consensus: 10_000_000, selected: true }]}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        unit="$"
        now={NOW}
      />,
    );
    expect(container.querySelector('.nchart-empty')?.textContent).toBe('no reading yet');
    expect(container.querySelector('.nchart-line')).toBeNull();
    expect(container.querySelector('.nchart-marker.is-selected')?.textContent).toContain('$10M');
  });
});

describe('hover', () => {
  test('snaps to the nearest reading, so the dot is on the line and the tooltip names that reading', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={[]}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        unit="$"
        now={NOW}
      />,
    );
    const svg = container.querySelector('svg')!;
    svg.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 660,
      height: 200,
      right: 660,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    // On the past side, between readings: the tooltip must be one of them, never an interpolation.
    // jsdom has no PointerEvent; a MouseEvent of that type reaches React's onPointerMove with coordinates.
    fireEvent(svg, new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 100 }));
    const tip = container.querySelector('.mchart-tip')?.textContent ?? '';
    expect(tip).toMatch(/reading \$(2|4|5)$/);
    expect(tip).toMatch(/27 Jul|10 Aug|25 Aug/);
  });
});

describe('hover on a marker with a proposal open', () => {
  test('lists the pair in the tooltip', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={[
          {
            marketId: 'sep',
            resolvesOn: '2026-10-01T00:00:00Z',
            consensus: 19.8,
            selected: true,
            pair: { approved: 21, declined: 19.5 },
          },
        ]}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
      />,
    );
    const svg = container.querySelector('svg')!;
    const { W, H } = GEOM.wide;
    svg.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: W,
      height: H,
      right: W,
      bottom: H,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent(svg, new MouseEvent('pointermove', { bubbles: true, clientX: W - 70, clientY: 100 }));
    const tip = container.querySelector('.mchart-tip')?.textContent ?? '';
    expect(tip).toContain('the market says 19.8');
    expect(tip).toContain('if approved 21');
    expect(tip).toContain('if declined 19.5');
  });
});

describe('a proposal open', () => {
  const withPairs = [
    {
      marketId: 'today',
      resolvesOn: '2026-08-26T00:00:00Z',
      consensus: 6,
      selected: false,
      pair: { approved: 6.2, declined: 6 },
    },
    {
      marketId: 'sep',
      resolvesOn: '2026-10-01T00:00:00Z',
      consensus: 19.8,
      selected: true,
      pair: { approved: 21, declined: 19.5 },
    },
  ];

  test('every marker in the window carries the pair; only the selected one is labeled with the impact', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={withPairs}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
        legend={{ approved: 'if Jason is paid $80', declined: 'if not' }}
      />,
    );
    expect(container.querySelectorAll('.nchart-pair').length).toBe(2);
    expect(container.querySelectorAll('.nchart-pair-label').length).toBe(2);
    const sel = container.querySelector('.nchart-marker.is-selected')!;
    expect(sel.textContent).toContain('if approved 21');
    expect(sel.textContent).toContain('if declined 19.5');
    expect(sel.textContent).toContain('+1.5');
    // "without it", not a second "now": the cell beside the chart carries the
    // last logged reading (review 2026-09-10).
    expect(sel.textContent).toContain('19.8 without it');
    expect(container.querySelector('.nchart-legend')?.textContent).toContain('if Jason is paid $80');
  });

  test('the impact is stated from the world on screen: declined flips the sign', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={withPairs}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
        impactFrom="declined"
      />,
    );
    expect(container.querySelector('.nchart-pair-delta')?.textContent).toBe('-1.5');
  });

  test('no proposal, no pair and no legend', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={withPairs.map(m => ({ ...m, pair: null }))}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
      />,
    );
    expect(container.querySelectorAll('.nchart-pair').length).toBe(0);
    expect(container.querySelector('.nchart-legend')).toBeNull();
  });
});

describe('labels never collide', () => {
  test('dodge keeps a minimum gap and stays inside the plot', () => {
    const out = dodge(
      [
        { key: 'a', at: 100 },
        { key: 'b', at: 103 },
        { key: 'c', at: 106 },
      ],
      20,
      180,
    );
    expect(out.map(l => l.y)).toEqual([100, 113, 126]);
    const low = dodge(
      [
        { key: 'a', at: 175 },
        { key: 'b', at: 178 },
      ],
      20,
      180,
    );
    expect(low[1].y).toBeLessThanOrEqual(180);
    expect(low[1].y - low[0].y).toBeGreaterThanOrEqual(13);
  });

  test('three labels at nearly the same value render at distinct heights', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={[
          {
            marketId: 'sep',
            resolvesOn: '2026-10-01T00:00:00Z',
            consensus: 13.1,
            selected: true,
            pair: { approved: 13.4, declined: 12.9 },
          },
        ]}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
      />,
    );
    const ys = [...container.querySelectorAll('.nchart-marker.is-selected text')]
      .filter(t => !t.classList.contains('nchart-pair-delta'))
      .map(t => Number(t.getAttribute('y')))
      .sort((a, b) => a - b);
    expect(ys.length).toBe(3);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(12);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(12);
  });
});

describe('the label number tiers', () => {
  // "$10,000,000" as a marker label ran off the plot (owner report
  // 2026-08-28); quotes below a million stay exact.
  test('millions compact, thousands stay exact', async () => {
    const { fmt } = await import('../NumberChart');
    expect(fmt(10_000_000, '$')).toBe('$10M');
    expect(fmt(1_150_000_000, '$')).toBe('$1.2B');
    expect(fmt(7_146, '$')).toBe('$7,146');
    expect(fmt(19.8, '')).toBe('19.8');
  });
});

describe('the vertical axis never magnifies a wobble into a cliff', () => {
  // docs/ui-conventions.md, "The number chart": the axis spans at least a
  // tenth of the largest value drawn. The Wallpaper Animator floor's net
  // revenue read 6,107.52 then 6,125.84 within seventeen minutes, and the
  // chart drew that as a wall from the floor to the ceiling of the plot at
  // the now rule (owner report 2026-09-02, "why does the graph look so weird").
  const plotHeight = GEOM.wide.H - 16 - 24;
  const dotYs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.nchart-dot')).map(c => Number(c.getAttribute('cy')));

  test('a third-of-a-percent wobble is a small step, not the whole plot', () => {
    const now = new Date('2026-09-02T21:00:00Z');
    const { container } = render(
      <NumberChart
        points={[
          { at: '2026-09-02T16:12:39Z', value: 6107.52 },
          { at: '2026-09-02T16:23:27Z', value: 6125.84 },
          { at: '2026-09-02T16:29:31Z', value: 6125.84 },
        ]}
        markers={[
          { marketId: 'w', resolvesOn: '2026-09-07T00:00:00Z', consensus: 6107.52, selected: false },
          { marketId: 'y', resolvesOn: '2027-01-01T00:00:00Z', consensus: 6125.84, selected: true },
        ]}
        selectedResolvesOn="2027-01-01T00:00:00Z"
        granularity="other"
        unit="$"
        now={now}
      />,
    );
    const ys = dotYs(container);
    expect(ys).toHaveLength(3);
    const spread = Math.max(...ys) - Math.min(...ys);
    // 18.32 on a floor of 612.6 (a tenth of 6,125.84), then 25% padding each
    // side: about 2% of the plot.
    expect(spread).toBeLessThan(plotHeight * 0.05);
    expect(spread).toBeGreaterThan(0);
  });

  test('a real move still fills the plot', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={[]}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        unit="$"
        now={NOW}
      />,
    );
    const ys = dotYs(container);
    // 2 to 5 is a 150% move: the readings span the plot minus the padding.
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(plotHeight * 0.6);
  });

  test('a metric at zero keeps a unit of room rather than a zero-height axis', () => {
    const { container } = render(
      <NumberChart
        points={[{ at: '2026-08-20T10:00:00Z', value: 0 }]}
        markers={[]}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        unit="$"
        now={NOW}
      />,
    );
    const [y] = dotYs(container);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe('the legend names the marks (docs/ui-conventions.md, "The price and the chart")', () => {
  const markers = [
    { marketId: 'sep', resolvesOn: '2026-10-01T00:00:00Z', consensus: 19.8, selected: true },
    { marketId: 'week', resolvesOn: '2026-08-31T00:00:00Z', consensus: 6.5, selected: false },
  ];

  test('actual, the call for the day before the selected settle instant, and the other open dates', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
        marksLegend
      />,
    );
    const legend = container.querySelector('.nchart-legend') as HTMLElement;
    expect(legend.textContent).toContain('actual');
    expect(legend.textContent).toContain("market's call for 30 Sep");
    expect(legend.textContent).toContain('other open dates');
  });

  test('no other open dates, no words for them', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={[markers[0]]}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
        marksLegend
      />,
    );
    expect(container.querySelector('.nchart-legend')?.textContent).not.toContain('other open dates');
  });

  test('a proposal legend replaces it', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
        marksLegend
        legend={{ approved: 'if Ada is paid $80', declined: 'if not' }}
      />,
    );
    expect(container.querySelectorAll('.nchart-legend').length).toBe(1);
    expect(container.querySelector('.nchart-legend')?.textContent).toContain('if Ada is paid $80');
    expect(container.querySelector('.nchart-legend')?.textContent).not.toContain('actual');
  });

  test('without the flag there is no legend, as before', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
      />,
    );
    expect(container.querySelector('.nchart-legend')).toBeNull();
  });
});

describe('DECISIONS: the forks, on the number (docs/ui-conventions.md, the DECISIONS segment)', () => {
  // The market on screen settles 1 Oct; two proposals were decided on its
  // pair, one approved on 10 Aug and one declined on 20 Aug.
  const markers = [{ marketId: 'sep', resolvesOn: '2026-10-01T00:00:00Z', consensus: 18.8, selected: true }];
  const forks = [
    { id: 'p18', at: '2026-08-10T12:00:00Z', approved: 30.8, declined: 20.9, taken: 'approved' as const, label: '#18' },
    { id: 'p28', at: '2026-08-20T12:00:00Z', approved: 20, declined: 18.6, taken: 'declined' as const, label: '#28' },
  ];
  const draw = (over: Record<string, unknown> = {}) =>
    render(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
        forks={forks}
        openForkId="p18"
        {...over}
      />,
    );

  test('A DECISION PRICED ON THIS DATE IS A NODE ON THE LINE at the instant it was made', () => {
    const { container } = draw({ openForkId: null });
    const nodes = container.querySelectorAll('.nchart-fork');
    expect(nodes).toHaveLength(2);
    // No decision is open, so no world is drawn.
    expect(container.querySelector('.nchart-world')).toBeNull();
    // A node sits left of the one after it: the x is the decision's instant.
    const xs = Array.from(nodes).map(n => Number(n.querySelector('circle')?.getAttribute('cx')));
    expect(xs[0]).toBeLessThan(xs[1]);
  });

  test('THE OPEN DECISION DRAWS ITS TWO WORLDS at the prices recorded at the decision: the one taken dotted, the other dashed', () => {
    const { container } = draw();
    const taken = container.querySelector('.nchart-world--taken');
    const ghost = container.querySelector('.nchart-world--ghost');
    expect(taken?.classList.contains('nchart-world--approved')).toBe(true);
    expect(ghost?.classList.contains('nchart-world--declined')).toBe(true);
    expect(container.textContent).toContain('if approved 30.8');
    expect(container.textContent).toContain('if declined 20.9');
  });

  test('a declined decision takes the declined world', () => {
    const { container } = draw({ openForkId: 'p28' });
    expect(container.querySelector('.nchart-world--taken')?.classList.contains('nchart-world--declined')).toBe(true);
    expect(container.querySelector('.nchart-world--ghost')?.classList.contains('nchart-world--approved')).toBe(true);
  });

  test('pressing another decision opens it', () => {
    const picked: string[] = [];
    const { container } = draw({ onPickFork: (id: string) => picked.push(id) });
    const other = container.querySelector('.nchart-fork[data-fork="p28"]') as Element;
    fireEvent.click(other);
    expect(picked).toEqual(['p28']);
  });

  test('a decision outside the window is not drawn', () => {
    const { container } = draw({
      forks: [{ ...forks[0], id: 'old', at: '2020-01-01T00:00:00Z' }],
      openForkId: 'old',
    });
    expect(container.querySelector('.nchart-fork')).toBeNull();
    expect(container.querySelector('.nchart-world')).toBeNull();
  });

  test('the legend names the marks, and a date nobody decided on says so', () => {
    const { container, rerender } = draw();
    const legend = container.querySelector('.nchart-legend')?.textContent ?? '';
    expect(legend).toContain('a decision');
    expect(legend).toContain('the world chosen');
    expect(legend).toContain('the world not taken');
    rerender(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
        forks={[]}
      />,
    );
    expect(container.textContent).toContain('no decision priced on this date yet');
  });
});
