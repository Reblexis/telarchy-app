import { useEffect, useState, useCallback } from 'react';
import type { Metric, MetricLog, GraphInterval } from '../types';
import { buildPointsFromLogs } from '../lib/metrics-chart-model';
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

  const loadChart = useCallback(async (m: Metric) => {
    setStatus('loading');
    setPoints([]);

    const logs = await loadLogs(m.id);
    const nextPoints = buildPointsFromLogs(logs, interval);
    if (nextPoints.length === 0) {
      setStatus('no-data');
      return;
    }
    setPoints(nextPoints);
    setStatus('ready');
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

  return (
    <div className="modal show" onClick={handleOverlayClick}>
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h3>{metric.name} - Progress Graph</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="graph-modal-container">
          {status === 'loading' && <div className="graph-loading">Loading graph...</div>}
          {status === 'no-data' && <div className="graph-no-data">No data yet. Values will be logged as they change.</div>}
          {status === 'ready' && points.length > 0 && (
            <div style={{ position: 'relative', width: '100%', height: '350px' }}>
              <MetricsTimeChart
                points={points}
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
