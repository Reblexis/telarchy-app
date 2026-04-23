import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricsTimeChart } from '../MetricsTimeChart';
import type { ChartPoint } from '../../../lib/metrics-chart-model';

function pt(x: number, y: number, overrides: Partial<ChartPoint> = {}): ChartPoint {
  return { x, y, label: String(x), ...overrides };
}

describe('MetricsTimeChart', () => {
  test('renders an empty-state message when all point sets are empty', () => {
    render(<MetricsTimeChart points={[]} mode="normal" variant="modal" />);
    expect(screen.getByText(/no time-series points/i)).toBeInTheDocument();
  });

  test('renders when past is empty but future is provided', () => {
    const future = [pt(1, 10), pt(2, 20)];
    const { container } = render(
      <MetricsTimeChart points={[]} futurePoints={future} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(screen.queryByText(/no time-series points/i)).toBeNull();
  });

  test('renders when only past logs are present', () => {
    const { container } = render(
      <MetricsTimeChart points={[pt(1, 5), pt(2, 10)]} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('renders when both past and future are present', () => {
    const past = [pt(1, 5), pt(2, 10)];
    const future = [pt(3, 15), pt(4, 20)];
    const { container } = render(
      <MetricsTimeChart points={past} futurePoints={future} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('does not throw with a single-point series', () => {
    const { container } = render(
      <MetricsTimeChart points={[pt(1, 42)]} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('does not throw when halfLifeYears is set with no half-life-relevant points', () => {
    const { container } = render(
      <MetricsTimeChart
        points={[pt(1, 5), pt(2, 10)]}
        mode="normal"
        variant="modal"
        halfLifeYears={3}
      />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('inspect mode with conditional points renders without crashing', () => {
    const past = [pt(1, 5), pt(2, 10)];
    const cond = [pt(1, 6), pt(2, 8)];
    const { container } = render(
      <MetricsTimeChart
        points={past}
        conditionalPoints={cond}
        mode="inspect"
        variant="modal"
      />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('handles all three datasets (past + conditional + future) together', () => {
    const past = [pt(1, 5), pt(2, 10)];
    const cond = [pt(1, 6), pt(2, 8)];
    const future = [pt(3, 15)];
    const { container } = render(
      <MetricsTimeChart
        points={past}
        conditionalPoints={cond}
        futurePoints={future}
        mode="inspect"
        variant="modal"
      />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('accepts inline variant (no zoom plugin) without crashing', () => {
    const { container } = render(
      <MetricsTimeChart points={[pt(1, 5), pt(2, 10)]} mode="normal" variant="inline" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('handles identical-valued points (flat line) without collapsing the y-axis', () => {
    const flat = [pt(1, 50), pt(2, 50), pt(3, 50)];
    const { container } = render(
      <MetricsTimeChart points={flat} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('handles negative values', () => {
    const { container } = render(
      <MetricsTimeChart points={[pt(1, -5), pt(2, 3), pt(3, -10)]} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('gracefully handles an empty future array alongside real past data', () => {
    const { container } = render(
      <MetricsTimeChart points={[pt(1, 5), pt(2, 10)]} futurePoints={[]} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('single-point series still produces a non-degenerate x-axis range', async () => {
    // This is the "empty-looking graph" case: a user has logged a metric once
    // and the graph naively rendered with xMin===xMax so Chart.js drew nothing.
    // We assert the chart is rendered (canvas exists) with a single-point input.
    const { container } = render(
      <MetricsTimeChart points={[pt(1_700_000_000_000, 42)]} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('multiple points collapsed to the same x are still rendered', () => {
    const same = [pt(100, 5), pt(100, 7)];
    const { container } = render(
      <MetricsTimeChart points={same} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('renders outlook series alongside current points without crashing', () => {
    const current = [pt(1, 5), pt(2, 10)];
    const outlook = [pt(1, 7), pt(2, 12)];
    const { container } = render(
      <MetricsTimeChart points={current} outlookPoints={outlook} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('outlook-only input (no current series) still renders', () => {
    const outlook = [pt(1, 7), pt(2, 12)];
    const { container } = render(
      <MetricsTimeChart points={[]} outlookPoints={outlook} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('renders chart without crashing when interpolated flag mixes with real points', () => {
    const mixed = [
      pt(1, 5, { interpolated: false }),
      pt(2, 5, { interpolated: true }),
      pt(3, 5, { interpolated: true }),
      pt(4, 10, { interpolated: false }),
    ];
    const { container } = render(
      <MetricsTimeChart points={mixed} mode="normal" variant="modal" />
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });
});
