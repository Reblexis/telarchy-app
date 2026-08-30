import { render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketChart } from '../MarketChart';

// Wide geometry constants from MarketChart (jsdom's innerWidth is 1024).
const W = 720,
  PAD_L = 46,
  PAD_R = 58;
const RIGHT_EDGE = W - PAD_R;

beforeAll(() => {
  // jsdom has no matchMedia; the chart only uses it to pick geometry.
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

const NOW = new Date('2026-08-13T17:40:30Z').getTime();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function pathXs(d: string): number[] {
  return [...d.matchAll(/[ML]([\d.]+),/g)].map(m => parseFloat(m[1]));
}

describe('MarketChart axis on young markets (2026-08-13)', () => {
  it('never extends the domain into the future: a single fresh point draws a full-width held-call line ending at the right edge', () => {
    const { container } = render(
      <MarketChart series={[{ at: iso(0), consensus: 72000 }]} consensus={72000} unit="$" />,
    );
    const line = container.querySelector('.mchart-mline')!;
    const xs = pathXs(line.getAttribute('d')!);
    // The 60s minimum span extends LEFT: line enters at the plot's left
    // edge and ends at the right edge, not at a mid-chart "now".
    expect(xs[0]).toBeCloseTo(PAD_L, 0);
    expect(Math.max(...xs)).toBeCloseTo(RIGHT_EDGE, 0);
    const dot = container.querySelector('.mchart-calldot')!;
    expect(parseFloat(dot.getAttribute('cx')!)).toBeCloseTo(RIGHT_EDGE, 0);
  });

  it('ends both branches of a conditional pair at the same right edge', () => {
    const { container } = render(
      <MarketChart
        series={[{ at: iso(0), consensus: 77316 }]}
        consensus={77316}
        unit="$"
        secondary={{
          series: [
            { at: iso(40_000), consensus: 80000 },
            { at: iso(2_000), consensus: 82390 },
          ],
          consensus: 82390,
          label: 'if approved',
          tone: 'higher',
        }}
      />,
    );
    const primaryDot = container.querySelector('.mchart-calldot')!;
    const branchDot = container.querySelector('.mchart-branch-dot')!;
    expect(parseFloat(primaryDot.getAttribute('cx')!)).toBeCloseTo(RIGHT_EDGE, 0);
    expect(parseFloat(branchDot.getAttribute('cx')!)).toBeCloseTo(RIGHT_EDGE, 0);
    // The untraded primary still draws a line (the held call), not a bare dot.
    const xs = pathXs(container.querySelector('.mchart-mline')!.getAttribute('d')!);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
  });

  it('labels ticks with seconds when the span is under ten minutes, and none are in the future', () => {
    const { container } = render(
      <MarketChart series={[{ at: iso(5_000), consensus: 72000 }]} consensus={72000} unit="$" />,
    );
    const labels = [...container.querySelectorAll('.mchart-xlabel')].map(e => e.textContent);
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
    // Distinct labels: the old future-padded domain printed the same minute
    // four times.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('pads the plot clip horizontally so edge-riding vertical strokes keep full width', () => {
    const { container } = render(
      <MarketChart series={[{ at: iso(0), consensus: 72000 }]} consensus={72000} unit="$" />,
    );
    const rect = container.querySelector('clipPath rect')!;
    // The step to the live call lands exactly on the plot's right edge; a
    // clip ending there halves the vertical stroke (owner report 2026-08-13).
    expect(parseFloat(rect.getAttribute('x')!)).toBeLessThan(PAD_L);
    expect(parseFloat(rect.getAttribute('x')!) + parseFloat(rect.getAttribute('width')!)).toBeGreaterThan(RIGHT_EDGE);
  });

  it('leaves a mature market untouched: domain starts at the first trade, minute-resolution ticks', () => {
    const series = [
      { at: iso(2 * 3600e3), consensus: 70000 },
      { at: iso(3600e3), consensus: 71000 },
      { at: iso(60_000), consensus: 72000 },
    ];
    const { container } = render(<MarketChart series={series} consensus={72000} unit="$" />);
    const xs = pathXs(container.querySelector('.mchart-mline')!.getAttribute('d')!);
    expect(xs[0]).toBeCloseTo(PAD_L, 0);
    expect(Math.max(...xs)).toBeCloseTo(RIGHT_EDGE, 0);
    const labels = [...container.querySelectorAll('.mchart-xlabel')].map(e => e.textContent);
    for (const l of labels) expect(l).toMatch(/^\d{1,2}:\d{2}$/);
  });
});

/**
 * The axis must be able to label itself. A market that ticked 25 -> 25.07 ->
 * 25 drew a full-height cliff between two ticks both reading "25" (owner
 * report 2026-08-15: "it goes from 25 to 25 and yet it goes down?"), because
 * scaling to the data alone turns a 0.3% move into the whole canvas.
 */
describe('a negligible move does not draw as a cliff', () => {
  const yLabels = (container: HTMLElement) =>
    [...container.querySelectorAll('.mchart-ylabel')].map(n => n.textContent ?? '');
  const pathYs = (d: string): number[] => [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map(m => parseFloat(m[1]));

  it('draws a 0.07 wobble on a 25 market as nearly flat', () => {
    const { container } = render(
      <MarketChart
        series={[
          { at: iso(3 * 3600e3), consensus: 25 },
          { at: iso(2 * 3600e3), consensus: 25.07 },
          { at: iso(1 * 3600e3), consensus: 25 },
        ]}
        consensus={25}
      />,
    );
    const ys = pathYs(container.querySelector('.mchart-mline')!.getAttribute('d')!);
    const spread = Math.max(...ys) - Math.min(...ys);
    // Under a tenth of the plot: visible as a wobble, not a collapse. The
    // unguarded domain put this at the full plot height.
    expect(spread).toBeLessThan(20);
  });

  it('never prints the same y label twice', () => {
    const { container } = render(
      <MarketChart
        series={[
          { at: iso(2 * 3600e3), consensus: 25 },
          { at: iso(3600e3), consensus: 25.07 },
        ]}
        consensus={25}
      />,
    );
    const labels = yLabels(container);
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('still draws a real move at full scale', () => {
    // LookPilot's actual band: 73.6k to 78.5k. The floor for labels in
    // thousands is 400, an order of magnitude below this, so nothing changes.
    const { container } = render(
      <MarketChart
        series={[
          { at: iso(3 * 3600e3), consensus: 73600 },
          { at: iso(2 * 3600e3), consensus: 78500 },
          { at: iso(3600e3), consensus: 76000 },
        ]}
        consensus={76000}
        unit="$"
      />,
    );
    const ys = pathYs(container.querySelector('.mchart-mline')!.getAttribute('d')!);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(60);
  });

  it('a market that never moved sits in the middle, not on an edge', () => {
    const { container } = render(
      <MarketChart
        series={[
          { at: iso(2 * 3600e3), consensus: 25 },
          { at: iso(3600e3), consensus: 25 },
        ]}
        consensus={25}
      />,
    );
    const ys = pathYs(container.querySelector('.mchart-mline')!.getAttribute('d')!);
    const dot = parseFloat(container.querySelector('.mchart-calldot')!.getAttribute('cy')!);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(0);
    // Comfortably inside the plot rather than pinned to its top or bottom.
    expect(dot).toBeGreaterThan(40);
    expect(dot).toBeLessThan(200);
  });
});

describe('axis number tiers', () => {
  // A $10M valuation axis once printed "$10,000k" (owner report 2026-08-28).
  test('millions and billions get their own tier', async () => {
    const { compactNum, labelQuantum } = await import('../MarketChart');
    expect(compactNum(10_000_000)).toBe('10M');
    expect(compactNum(10_100_000)).toBe('10.1M');
    expect(compactNum(1_200_000_000)).toBe('1.2B');
    expect(compactNum(77_400)).toBe('77.4k');
    expect(compactNum(25)).toBe('25');
    expect(labelQuantum(10_000_000)).toBe(1e5);
    expect(labelQuantum(1_200_000_000)).toBe(1e8);
  });
});
