import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stub the chart component. Chart.js can't cleanly update itself inside
// jsdom when React re-renders (no layout engine to acquire a canvas context),
// so we bypass it and assert DOM structure/props on a pure-React stand-in.
vi.mock('../charts/MetricsTimeChart', () => ({
  MetricsTimeChart: (props: {
    points: { x: number; y: number }[];
    futurePoints?: { x: number; y: number }[];
  }) => (
    <div
      data-testid="chart-stub"
      data-points={props.points.length}
      data-future={props.futurePoints?.length ?? 0}
    />
  ),
}));

import { GraphModal } from '../GraphModal';
import type { Metric, MetricLog } from '../../types';

function makeMetric(overrides: Partial<Metric> = {}): Metric {
  return {
    id: 'm1',
    name: 'Test Metric',
    description: '',
    value: 10,
    total: 10,
    formula: '0',
    order: 0,
    depth: 0,
    ...overrides,
  };
}

function makeLog(ts: string, value: number): MetricLog {
  return { metricId: 'm1', metricName: 'Test Metric', value, timestamp: new Date(ts) };
}

describe('GraphModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns null when metric is null', () => {
    const { container } = render(
      <GraphModal metric={null} interval="day" isInspectMode={false} loadLogs={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('shows loading then ready when logs exist', async () => {
    vi.useRealTimers();
    const loadLogs = vi.fn().mockResolvedValue([makeLog('2026-04-20T10:00:00', 5)]);
    render(
      <GraphModal metric={makeMetric()} interval="day" isInspectMode={false} loadLogs={loadLogs} onClose={vi.fn()} />
    );
    await waitFor(() => expect(loadLogs).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(screen.getByTestId('chart-stub')).toBeInTheDocument());
  });

  test('shows no-data state when logs are empty and no future is available', async () => {
    vi.useRealTimers();
    const loadLogs = vi.fn().mockResolvedValue([]);
    render(
      <GraphModal metric={makeMetric()} interval="day" isInspectMode={false} loadLogs={loadLogs} onClose={vi.fn()} />
    );
    await screen.findByText(/no data yet/i);
  });

  test('does not render the future-toggle button when metric has no forward-dated timeSeries', async () => {
    vi.useRealTimers();
    const loadLogs = vi.fn().mockResolvedValue([makeLog('2026-04-20T10:00:00', 5)]);
    render(
      <GraphModal
        metric={makeMetric({ timeSeries: [{ date: '2020-01-01', value: 1 }] })}
        interval="day"
        isInspectMode={false}
        loadLogs={loadLogs}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByTestId('chart-stub')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /show future predictions/i })).toBeNull();
  });

  test('renders the future-toggle button when metric has forward-dated timeSeries', async () => {
    vi.useRealTimers();
    const loadLogs = vi.fn().mockResolvedValue([makeLog('2026-04-20T10:00:00', 5)]);
    render(
      <GraphModal
        metric={makeMetric({ timeSeries: [{ date: '2027-01-01', value: 99 }] })}
        interval="day"
        isInspectMode={false}
        loadLogs={loadLogs}
        onClose={vi.fn()}
      />
    );
    const toggle = await screen.findByRole('button', { name: /show future predictions/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('clicking the future toggle flips aria-pressed and feeds future points to the chart', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const loadLogs = vi.fn().mockResolvedValue([makeLog('2026-04-20T10:00:00', 5)]);
    render(
      <GraphModal
        metric={makeMetric({
          timeSeries: [
            { date: '2027-01-01', value: 99 },
            { date: '2027-07-01', value: 88 },
          ],
        })}
        interval="day"
        isInspectMode={false}
        loadLogs={loadLogs}
        onClose={vi.fn()}
      />
    );
    const toggle = await screen.findByRole('button', { name: /show future predictions/i });
    const chart = await screen.findByTestId('chart-stub');
    expect(chart).toHaveAttribute('data-future', '0');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('chart-stub')).toHaveAttribute('data-future', '2');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('chart-stub')).toHaveAttribute('data-future', '0');
  });

  test('past-dated timeSeries entries are filtered out of future overlay', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const loadLogs = vi.fn().mockResolvedValue([makeLog('2026-04-20T10:00:00', 5)]);
    render(
      <GraphModal
        metric={makeMetric({
          timeSeries: [
            { date: '2020-01-01', value: 1 }, // past - should be excluded
            { date: '2027-01-01', value: 99 }, // future - should be included
          ],
        })}
        interval="day"
        isInspectMode={false}
        loadLogs={loadLogs}
        onClose={vi.fn()}
      />
    );
    const toggle = await screen.findByRole('button', { name: /show future predictions/i });
    await user.click(toggle);
    expect(screen.getByTestId('chart-stub')).toHaveAttribute('data-future', '1');
  });

  test('stale loadLogs response does not overwrite newer metric state', async () => {
    vi.useRealTimers();
    // Two metrics; loadLogs for m1 hangs, then for m2 resolves quickly,
    // then m1 resolves last. The modal must end up displaying m2's data.
    let resolveA: ((v: MetricLog[]) => void) | null = null;
    const loadLogs = vi.fn().mockImplementation((id: string) => {
      if (id === 'm1') return new Promise<MetricLog[]>(r => { resolveA = r; });
      return Promise.resolve([makeLog('2026-04-20T10:00:00', 999)]);
    });
    const { rerender } = render(
      <GraphModal
        metric={makeMetric({ id: 'm1', name: 'A' })}
        interval="day"
        isInspectMode={false}
        loadLogs={loadLogs}
        onClose={vi.fn()}
      />
    );
    // Switch to m2 before m1 resolves.
    rerender(
      <GraphModal
        metric={makeMetric({ id: 'm2', name: 'B' })}
        interval="day"
        isInspectMode={false}
        loadLogs={loadLogs}
        onClose={vi.fn()}
      />
    );
    // Now let m1's stale response land.
    await waitFor(() => expect(resolveA).not.toBeNull());
    resolveA!([makeLog('2020-01-01T00:00:00', 1)]);
    // m2's data should be what ends up displayed; title reflects the current metric.
    expect(await screen.findByRole('heading', { name: /B/ })).toBeInTheDocument();
  });

  test('close button invokes onClose', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onClose = vi.fn();
    const loadLogs = vi.fn().mockResolvedValue([makeLog('2026-04-20T10:00:00', 5)]);
    render(
      <GraphModal metric={makeMetric()} interval="day" isInspectMode={false} loadLogs={loadLogs} onClose={onClose} />
    );
    await user.click(screen.getByRole('button', { name: /×/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
