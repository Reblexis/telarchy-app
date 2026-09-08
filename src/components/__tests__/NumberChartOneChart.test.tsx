import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { GEOM } from '../MarketChart';
import { labelWidth, NumberChart } from '../NumberChart';

/**
 * Stage 3 of the 2026-09-08 floor redesign (docs/ui-conventions.md, "The
 * chart"): ONE chart, the number's own, with the market's call drawn on
 * it. Every test here is named after the rule in the doc's words.
 */

const NOW = new Date('2026-09-08T10:00:00Z');
const css = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');

/** Two readings, an ink step line's worth. */
const readings = [
  { at: '2026-08-20T09:00:00Z', value: 8 },
  { at: '2026-09-05T09:00:00Z', value: 9 },
];
/** The selected market's call since it opened. */
const call = [
  { at: '2026-08-20T09:00:00Z', consensus: 25 },
  { at: '2026-09-01T09:00:00Z', consensus: 19.5 },
  { at: '2026-09-08T08:00:00Z', consensus: 19.8 },
];
const markers = [
  { marketId: 'm-week', resolvesOn: '2026-09-14T00:00:00Z', consensus: 11.2, selected: false },
  { marketId: 'm-month', resolvesOn: '2026-10-01T00:00:00Z', consensus: 19.8, selected: true },
];

function chart(extra: Record<string, unknown> = {}) {
  return render(
    <NumberChart
      points={readings}
      call={call}
      markers={markers}
      selectedResolvesOn="2026-10-01T00:00:00Z"
      granularity="month"
      rangeMin={0}
      rangeMax={50}
      now={NOW}
      {...extra}
    />,
  );
}

/** The x of the "now" rule, which is where the call line has to end. */
function nowX(container: HTMLElement): number {
  return Number((container.querySelector('.nchart-now') as SVGLineElement).getAttribute('x1'));
}

function pathPoints(d: string): Array<[number, number]> {
  return (d.match(/[ML]-?[\d.]+ -?[\d.]+/g) ?? []).map(seg => {
    const [x, y] = seg.slice(1).split(' ').map(Number);
    return [x, y] as [number, number];
  });
}

describe("the chart draws the reading and the market's call over time", () => {
  test("the call's history is a thin amber step line ending at now", () => {
    const { container } = chart();
    const line = container.querySelector('.nchart-call') as SVGPathElement;
    expect(line).toBeTruthy();
    const pts = pathPoints(line.getAttribute('d') ?? '');
    // A step: every pair of consecutive points shares an x or a y.
    for (let i = 1; i < pts.length; i++) {
      const sameX = Math.abs(pts[i][0] - pts[i - 1][0]) < 0.001;
      const sameY = Math.abs(pts[i][1] - pts[i - 1][1]) < 0.001;
      expect(sameX || sameY).toBe(true);
    }
    // Three calls step to six points, then the hold to now.
    expect(pts.length).toBe(6);
    expect(pts[pts.length - 1][0]).toBeCloseTo(nowX(container), 3);
  });

  test('a market nobody has traded draws the line flat at its opening price', () => {
    const { container } = chart({ call: [{ at: '2026-08-25T09:00:00Z', consensus: 6.25 }] });
    const pts = pathPoints((container.querySelector('.nchart-call') as SVGPathElement).getAttribute('d') ?? '');
    expect(pts.length).toBe(2);
    expect(pts[0][1]).toBeCloseTo(pts[1][1], 6);
    expect(pts[1][0]).toBeCloseTo(nowX(container), 3);
  });

  test('the ink reading line is still drawn, with a dot at each reading', () => {
    const { container } = chart();
    expect(container.querySelector('.nchart-line')).toBeTruthy();
    expect(container.querySelectorAll('.nchart-dot').length).toBe(2);
  });
});

describe('the connector and the settle marker', () => {
  test("from the call's end at now a DOTTED amber connector runs to the settle marker", () => {
    const { container } = chart();
    const c = container.querySelector('.nchart-connector') as SVGLineElement;
    expect(c).toBeTruthy();
    expect(Number(c.getAttribute('x1'))).toBeCloseTo(nowX(container), 3);
    const marker = container.querySelector('.nchart-marker.is-selected circle') as SVGCircleElement;
    expect(Number(c.getAttribute('x2'))).toBeCloseTo(Number(marker.getAttribute('cx')), 3);
    expect(Number(c.getAttribute('y2'))).toBeCloseTo(Number(marker.getAttribute('cy')), 3);
    // Dotted so it never reads as a forecast path.
    expect(css).toMatch(/\.nchart-connector\s*{[^}]*stroke-dasharray/);
  });

  test('the settle marker is an amber dot labelled "19.8 · settles"', () => {
    const { container } = chart();
    const sel = container.querySelector('.nchart-marker.is-selected') as SVGGElement;
    expect(sel.textContent).toContain('19.8 · settles');
  });

  test('every other open market is a grey, unlabelled dot at its settle instant', () => {
    const { container } = chart();
    const others = [...container.querySelectorAll('.nchart-marker')].filter(m => !m.classList.contains('is-selected'));
    expect(others.length).toBe(1);
    expect(others[0].textContent).toBe('');
  });
});

describe('settle labels sit INSIDE the plot, to the left of their marker', () => {
  test('the label is left of the marker and inside the plot', () => {
    const { container } = chart();
    const sel = container.querySelector('.nchart-marker.is-selected') as SVGGElement;
    const marker = sel.querySelector('circle') as SVGCircleElement;
    const label = sel.querySelector('text') as SVGTextElement;
    expect(label.getAttribute('text-anchor')).toBe('end');
    expect(Number(label.getAttribute('x'))).toBeLessThan(Number(marker.getAttribute('cx')));
    expect(Number(label.getAttribute('x')) - labelWidth(label.textContent ?? '')).toBeGreaterThan(0);
  });

  test('the plot keeps a right margin the width of the widest label', () => {
    const { W, PAD_R } = GEOM.wide;
    // A money metric in the millions: "$1,200,000 · settles" is far wider
    // than the 58 units the base geometry leaves on the right.
    const wide = chart({
      unit: '$',
      call: [{ at: '2026-09-01T09:00:00Z', consensus: 1_200_000 }],
      points: [{ at: '2026-09-01T09:00:00Z', value: 1_100_000 }],
      markers: [{ marketId: 'm-month', resolvesOn: '2026-10-01T00:00:00Z', consensus: 1_200_000, selected: true }],
      rangeMax: 2_000_000,
    });
    const sel = wide.container.querySelector('.nchart-marker.is-selected') as SVGGElement;
    const text = (sel.querySelector('text') as SVGTextElement).textContent ?? '';
    expect(labelWidth(text)).toBeGreaterThan(PAD_R);
    const cx = Number((sel.querySelector('circle') as SVGCircleElement).getAttribute('cx'));
    expect(cx).toBeLessThanOrEqual(W - labelWidth(text));
  });
});

describe('the y range defaults to the data with padding', () => {
  test('never the whole settlement range: a 0-to-500 range under a number that moves between 200 and 215', () => {
    const { container } = chart({
      points: [
        { at: '2026-08-20T09:00:00Z', value: 200 },
        { at: '2026-09-05T09:00:00Z', value: 210 },
      ],
      call: [{ at: '2026-09-01T09:00:00Z', consensus: 205 }],
      markers: [{ marketId: 'm-month', resolvesOn: '2026-10-01T00:00:00Z', consensus: 205, selected: true }],
      rangeMin: 0,
      rangeMax: 500,
    });
    const ticks = [...container.querySelectorAll('.mchart-ylabel')].map(t => Number(t.textContent));
    expect(Math.min(...ticks)).toBeGreaterThan(100);
    expect(Math.max(...ticks)).toBeLessThan(300);
  });

  test('the range rails are drawn only when they fall inside twice the data span', () => {
    // Data spans 8 to 25: the floor at 0 is within another span of it, the
    // top at 50 is not.
    const { container } = chart();
    const rails = [...container.querySelectorAll('.nchart-rail')];
    expect(rails.length).toBe(1);
    expect(container.querySelector('.nchart-rail-label')?.textContent).toBe('0');
  });

  test('both rails are drawn when both fall inside twice the data span', () => {
    const { container } = chart({ rangeMax: 30 });
    expect(container.querySelectorAll('.nchart-rail').length).toBe(2);
    expect([...container.querySelectorAll('.nchart-rail-label')].map(l => l.textContent)).toEqual(['30', '0']);
    expect(container.querySelector('.nchart-range-label')).toBeNull();
  });

  test('otherwise the axis label states "range 0 to 50" in the corner of the plot instead', () => {
    const { container } = chart();
    expect(container.querySelector('.nchart-range-label')?.textContent).toBe('range 0 to 50');
  });
});

describe('a legend under the plot names the marks', () => {
  test("reading, the market's call, when the selected market settles, and the other open dates", () => {
    const { container } = chart();
    const legend = container.querySelector('.nchart-legend') as HTMLElement;
    expect(legend.textContent).toContain('reading');
    expect(legend.textContent).toContain("market's call");
    expect(legend.textContent).toContain('settles 30 Sep');
    expect(legend.textContent).toContain('other open dates');
  });

  test('"other open dates" only when there are any', () => {
    const { container } = chart({ markers: [markers[1]] });
    expect((container.querySelector('.nchart-legend') as HTMLElement).textContent).not.toContain('other open dates');
  });
});

describe('with a proposal selected the chart carries the pair', () => {
  const branches = {
    approved: [
      { at: '2026-08-15T09:00:00Z', consensus: 19.5 },
      { at: '2026-09-05T09:00:00Z', consensus: 17.04 },
    ],
    declined: [
      { at: '2026-08-15T09:00:00Z', consensus: 19.5 },
      { at: '2026-09-04T09:00:00Z', consensus: 17.0 },
    ],
  };
  const paired = markers.map(m =>
    m.selected ? { ...m, pair: { approved: 17.04, declined: 17.0 } } : { ...m, pair: null },
  );

  test('the two branch calls are green and red step lines, each with a dotted connector in its colour', () => {
    const { container } = chart({ branches, markers: paired });
    expect(container.querySelector('.nchart-branch--approved')).toBeTruthy();
    expect(container.querySelector('.nchart-branch--declined')).toBeTruthy();
    for (const b of ['approved', 'declined']) {
      const c = container.querySelector(`.nchart-connector--${b}`) as SVGLineElement;
      expect(c).toBeTruthy();
      expect(Number(c.getAttribute('x1'))).toBeCloseTo(nowX(container), 3);
    }
    expect(css).toMatch(/\.nchart-connector--approved\s*{[^}]*var\(--higher\)/);
    expect(css).toMatch(/\.nchart-connector--declined\s*{[^}]*var\(--lower\)/);
  });

  test("only the selected date's markers are labelled, with the branch values and the difference", () => {
    const { container } = chart({ branches, markers: paired });
    const sel = container.querySelector('.nchart-marker.is-selected') as SVGGElement;
    const text = sel.textContent ?? '';
    expect(text).toContain('if approved 17.04');
    expect(text).toContain('if declined 17.00');
    expect(text).toContain('+0.04');
    const others = [...container.querySelectorAll('.nchart-marker')].filter(m => !m.classList.contains('is-selected'));
    expect(others[0].textContent).toBe('');
  });

  test('whichever branch the markets price higher sits on top', () => {
    const { container } = chart({ branches, markers: paired });
    const lines = [...container.querySelectorAll('.nchart-branch')];
    expect(lines[lines.length - 1].classList.contains('nchart-branch--approved')).toBe(true);
    const flipped = chart({
      branches: { approved: branches.declined, declined: branches.approved },
      markers: markers.map(m => (m.selected ? { ...m, pair: { approved: 17.0, declined: 17.04 } } : m)),
    });
    const flippedLines = [...flipped.container.querySelectorAll('.nchart-branch')];
    expect(flippedLines[flippedLines.length - 1].classList.contains('nchart-branch--declined')).toBe(true);
  });

  test('the legend becomes reading, market now, if approved, if declined, and each item toggles its line', () => {
    const { container, getByRole } = chart({ branches, markers: paired });
    const legend = container.querySelector('.nchart-legend') as HTMLElement;
    expect([...legend.querySelectorAll('button')].map(b => b.textContent)).toEqual([
      'reading',
      'market now',
      'if approved',
      'if declined',
    ]);
    const toggle = getByRole('button', { name: 'if approved' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.nchart-branch--approved')).toBeNull();
    expect(container.querySelector('.nchart-branch--declined')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'reading' }));
    expect(container.querySelector('.nchart-line')).toBeNull();
  });
});
