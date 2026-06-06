import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Metric, MetricLog, GraphInterval, Market } from '../types';
import { buildPointsFromLogs, buildOutlookPointsFromLogs, buildPointsFromTimeSeries, parseTargetDateToMs, type ChartPoint } from '../lib/metrics-chart-model';
import { MetricsTimeChart } from './charts/MetricsTimeChart';
import { api } from '../lib/api';

function isLeafMetric(m: Metric): boolean {
  const f = (m.formula || '').trim();
  return f === '' || f === '0';
}

const INTERVAL_OPTIONS: Array<{ value: GraphInterval; label: string }> = [
  { value: 'hour', label: 'Hourly (last 7 days)' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
];

interface GraphModalProps {
  metric: Metric | null;
  /** Initial history bucketing; the user can change it via the dropdown. */
  interval: GraphInterval;
  isInspectMode: boolean;
  loadLogs: (metricId: string) => Promise<MetricLog[]>;
  onClose: () => void;
}

export function GraphModal({ metric, interval: initialInterval, isInspectMode, loadLogs, onClose }: GraphModalProps) {
  const navigate = useNavigate();
  const [interval, setInterval_] = useState<GraphInterval>(initialInterval);
  const [points, setPoints] = useState<ReturnType<typeof buildPointsFromLogs>>([]);
  const [status, setStatus] = useState<'loading' | 'no-data' | 'ready'>('loading');
  const [showFuture, setShowFuture] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [pastPoints, setPastPoints] = useState<ChartPoint[]>([]);
  const reqIdRef = useRef(0);

  const futurePoints = useMemo(() => {
    if (!metric?.timeSeries || metric.timeSeries.length === 0) return [];
    const now = Date.now();
    return buildPointsFromTimeSeries(metric.timeSeries).filter(p => p.x >= now);
  }, [metric?.timeSeries]);
  const hasFuture = futurePoints.length > 0;
  const hasPast = pastPoints.length > 0;

  // Past predictions: the final consensus of this metric's markets whose
  // period has already passed (resolved, closed, or simply elapsed). Voided
  // markets are excluded (refunded, never settled on a prediction), as are
  // untraded ones (no consensus to show).
  useEffect(() => {
    if (!metric) { setPastPoints([]); setShowPast(false); return; }
    let cancelled = false;
    api.getMarkets(undefined, undefined, { status: 'all', kind: 'baseline' })
      .then((markets: Market[]) => {
        if (cancelled) return;
        const now = Date.now();
        const pts = markets
          .filter(m => m.metricId === metric.id && m.status !== 'voided' && m.consensus !== null)
          .map(m => ({
            x: parseTargetDateToMs(m.targetDate),
            y: m.consensus as number,
            label: m.targetDate,
            marketId: m.id,
          }))
          .filter(p => !Number.isNaN(p.x) && p.x < now);
        setPastPoints(pts);
      })
      .catch((e: unknown) => { if (!cancelled) console.error('GraphModal: failed to load past markets', e); });
    return () => { cancelled = true; };
  }, [metric]);

  // The chart draws a single historical line: the metric's realized value over
  // time. For a leaf that is the user-authored "Now:" number (the `value`
  // column). For a composite the `value` column is always 0, so we plot the
  // computed `outlook` (m.total) instead, which is the formula result. We do
  // not draw the value/future-consensus blend as a separate "outlook" line;
  // future market consensus is shown on demand via "Show future predictions".
  const loadChart = useCallback(async (m: Metric) => {
    const reqId = ++reqIdRef.current;
    setStatus('loading');
    try {
      const logs = await loadLogs(m.id);
      if (reqId !== reqIdRef.current) return;
      const pts = isLeafMetric(m)
        ? buildPointsFromLogs(logs, interval)
        : buildOutlookPointsFromLogs(logs, interval);
      setPoints(pts);
      setStatus(pts.length === 0 ? 'no-data' : 'ready');
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      console.error('GraphModal: failed to load logs', e);
      setPoints([]);
      setStatus('no-data');
    }
  }, [interval, loadLogs]);

  useEffect(() => {
    if (metric) {
      loadChart(metric);
    }
  }, [metric, loadChart]);

  if (!metric) return null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const effectiveFuture = showFuture ? futurePoints : undefined;
  const effectivePast = showPast ? pastPoints : undefined;
  const hasAnyData = points.length > 0 || (showFuture && hasFuture) || (showPast && hasPast);
  const showChart = status !== 'loading' && hasAnyData;
  const showNoData = status === 'no-data' && !hasAnyData;

  return (
    <div className="modal show" onClick={handleOverlayClick}>
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h3>{metric.name} - Progress Graph</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="graph-modal-toolbar">
          <label className="graph-modal-interval">
            <span>Granularity</span>
            <select
              value={interval}
              onChange={e => setInterval_(e.target.value as GraphInterval)}
              aria-label="History granularity"
            >
              {INTERVAL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          {hasPast && (
            <button
              type="button"
              className={`graph-modal-toggle${showPast ? ' active' : ''}`}
              onClick={() => setShowPast(v => !v)}
              aria-pressed={showPast}
              title="Final consensus of this metric's resolved and closed markets, plotted against the realized values. Click a point to open its market."
            >
              <span className="graph-modal-toggle-swatch graph-modal-toggle-swatch--past" aria-hidden="true" />
              Show past predictions
            </button>
          )}
          {hasFuture && (
            <button
              type="button"
              className={`graph-modal-toggle${showFuture ? ' active' : ''}`}
              onClick={() => setShowFuture(v => !v)}
              aria-pressed={showFuture}
            >
              <span className="graph-modal-toggle-swatch" aria-hidden="true" />
              Show future predictions
            </button>
          )}
        </div>
        <div className="graph-modal-container">
          {status === 'loading' && <div className="graph-loading">Loading graph...</div>}
          {showNoData && <div className="graph-no-data">No data yet. Values will be logged as they change.</div>}
          {showChart && (
            <div style={{ position: 'relative', width: '100%', height: '350px' }}>
              <MetricsTimeChart
                points={points}
                futurePoints={effectiveFuture}
                pastPoints={effectivePast}
                mode={isInspectMode ? 'inspect' : 'normal'}
                variant="modal"
                hourTicks={interval === 'hour'}
                onPointClick={showPast ? (p) => {
                  // Only past-prediction points carry a marketId; clicks on the
                  // history line do nothing here. status=all so the resolved /
                  // closed market is visible when the markets page opens.
                  if (p.marketId) navigate(`/markets?marketId=${p.marketId}&status=all`);
                } : undefined}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
