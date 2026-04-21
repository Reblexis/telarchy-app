import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { Metric, MetricLog, GraphInterval } from '../types';
import { buildPointsFromLogs, buildPointsFromTimeSeries } from '../lib/metrics-chart-model';
import { MetricsTimeChart } from './charts/MetricsTimeChart';

interface GraphModalProps {
  metric: Metric | null;
  interval: GraphInterval;
  isInspectMode: boolean;
  loadLogs: (metricId: string) => Promise<MetricLog[]>;
  onClose: () => void;
}

export function GraphModal({ metric, interval, isInspectMode, loadLogs, onClose }: GraphModalProps) {
  const [points, setPoints] = useState<ReturnType<typeof buildPointsFromLogs>>([]);
  const [status, setStatus] = useState<'loading' | 'no-data' | 'ready'>('loading');
  const [showFuture, setShowFuture] = useState(false);
  const reqIdRef = useRef(0);

  const futurePoints = useMemo(() => {
    if (!metric?.timeSeries || metric.timeSeries.length === 0) return [];
    const now = Date.now();
    return buildPointsFromTimeSeries(metric.timeSeries).filter(p => p.x >= now);
  }, [metric?.timeSeries]);
  const hasFuture = futurePoints.length > 0;

  const loadChart = useCallback(async (m: Metric) => {
    const reqId = ++reqIdRef.current;
    setStatus('loading');
    try {
      const logs = await loadLogs(m.id);
      if (reqId !== reqIdRef.current) return;
      const nextPoints = buildPointsFromLogs(logs, interval);
      setPoints(nextPoints);
      setStatus(nextPoints.length === 0 ? 'no-data' : 'ready');
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
  const hasAnyData = points.length > 0 || (showFuture && hasFuture);
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
