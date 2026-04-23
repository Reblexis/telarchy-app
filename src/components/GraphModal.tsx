import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { Metric, MetricLog, GraphInterval } from '../types';
import { buildPointsFromLogs, buildOutlookPointsFromLogs, buildPointsFromTimeSeries } from '../lib/metrics-chart-model';
import { MetricsTimeChart } from './charts/MetricsTimeChart';

function isLeafMetric(m: Metric): boolean {
  const f = (m.formula || '').trim();
  return f === '' || f === '0';
}

function hasTimePreference(m: Metric): boolean {
  return !!m.timePreference?.enabled || (m.inheritedHalfLife ?? 0) > 0;
}

interface GraphModalProps {
  metric: Metric | null;
  interval: GraphInterval;
  isInspectMode: boolean;
  loadLogs: (metricId: string) => Promise<MetricLog[]>;
  onClose: () => void;
}

export function GraphModal({ metric, interval, isInspectMode, loadLogs, onClose }: GraphModalProps) {
  const [points, setPoints] = useState<ReturnType<typeof buildPointsFromLogs>>([]);
  const [outlookPoints, setOutlookPoints] = useState<ReturnType<typeof buildPointsFromLogs>>([]);
  const [status, setStatus] = useState<'loading' | 'no-data' | 'ready'>('loading');
  const [showFuture, setShowFuture] = useState(false);
  const reqIdRef = useRef(0);

  // We pick which series to render based on metric shape, not on whether the
  // numbers happen to differ in a given log row:
  //   - Composite (has formula): outlook only; the raw value column is always 0.
  //   - Leaf without TP: value only; outlook === value so the second line would
  //     be redundant.
  //   - Leaf with TP: both. Value is the user-authored "Now:" number and
  //     outlook is the value/future-consensus blend.
  const shape: 'value-only' | 'outlook-only' | 'both' = useMemo(() => {
    if (!metric) return 'value-only';
    if (!isLeafMetric(metric)) return 'outlook-only';
    return hasTimePreference(metric) ? 'both' : 'value-only';
  }, [metric]);

  const futurePoints = useMemo(() => {
    if (!metric?.timeSeries || metric.timeSeries.length === 0) return [];
    const now = Date.now();
    return buildPointsFromTimeSeries(metric.timeSeries).filter(p => p.x >= now);
  }, [metric?.timeSeries]);
  const hasFuture = futurePoints.length > 0;

  const loadChart = useCallback(async (m: Metric, s: 'value-only' | 'outlook-only' | 'both') => {
    const reqId = ++reqIdRef.current;
    setStatus('loading');
    try {
      const logs = await loadLogs(m.id);
      if (reqId !== reqIdRef.current) return;
      const valuePts = s === 'outlook-only' ? [] : buildPointsFromLogs(logs, interval);
      const outlookPts = s === 'value-only' ? [] : buildOutlookPointsFromLogs(logs, interval);
      setPoints(valuePts);
      setOutlookPoints(outlookPts);
      setStatus(valuePts.length === 0 && outlookPts.length === 0 ? 'no-data' : 'ready');
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      console.error('GraphModal: failed to load logs', e);
      setPoints([]);
      setOutlookPoints([]);
      setStatus('no-data');
    }
  }, [interval, loadLogs]);

  useEffect(() => {
    if (metric) {
      loadChart(metric, shape);
    }
  }, [metric, shape, loadChart]);

  if (!metric) return null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const effectiveFuture = showFuture ? futurePoints : undefined;
  const hasAnyData = points.length > 0 || outlookPoints.length > 0 || (showFuture && hasFuture);
  const showChart = status !== 'loading' && hasAnyData;
  const showNoData = status === 'no-data' && !hasAnyData;

  return (
    <div className="modal show" onClick={handleOverlayClick}>
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h3>{metric.name} - Progress Graph</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {hasFuture && (
          <div className="graph-modal-toolbar">
            <button
              type="button"
              className={`graph-modal-toggle${showFuture ? ' active' : ''}`}
              onClick={() => setShowFuture(v => !v)}
              aria-pressed={showFuture}
            >
              <span className="graph-modal-toggle-swatch" aria-hidden="true" />
              Show future predictions
            </button>
          </div>
        )}
        <div className="graph-modal-container">
          {status === 'loading' && <div className="graph-loading">Loading graph...</div>}
          {showNoData && <div className="graph-no-data">No data yet. Values will be logged as they change.</div>}
          {showChart && (
            <div style={{ position: 'relative', width: '100%', height: '350px' }}>
              <MetricsTimeChart
                points={points}
                outlookPoints={outlookPoints}
                futurePoints={effectiveFuture}
                mode={isInspectMode ? 'inspect' : 'normal'}
                variant="modal"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
