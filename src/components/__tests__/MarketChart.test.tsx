import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MarketChart } from '../MarketChart';

// Wide geometry constants from MarketChart (jsdom's innerWidth is 1024).
const W = 720, PAD_L = 46, PAD_R = 58;
const RIGHT_EDGE = W - PAD_R;

beforeAll(() => {
  // jsdom has no matchMedia; the chart only uses it to pick geometry.
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const NOW = new Date('2026-08-13T17:40:30Z').getTime();
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

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
          series: [{ at: iso(40_000), consensus: 80000 }, { at: iso(2_000), consensus: 82390 }],
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
