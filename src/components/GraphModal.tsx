import { useEffect, useRef, useState, useCallback } from 'react';
import { Chart, registerables } from 'chart.js';
import type { Metric, MetricLog, GraphInterval } from '../types';
import { buildChartData } from '../lib/graph-utils';

Chart.register(...registerables);

let effectRunId = 0;

interface GraphModalProps {
  metric: Metric | null;
  interval: GraphInterval;
  isDark: boolean;
  loadLogs: (metricId: string) => Promise<MetricLog[]>;
  onClose: () => void;
}

export function GraphModal({ metric, interval, isDark, loadLogs, onClose }: GraphModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [status, setStatus] = useState<'loading' | 'no-data' | 'ready'>('loading');

  console.log(`[Graph RENDER] status=${status}, metric=${metric?.name ?? 'null'}, isDark=${isDark}, interval=${interval}`);

  const destroyChart = useCallback(() => {
    if (chartRef.current) {
      console.log('[Graph] destroying chart');
      chartRef.current.destroy();
      chartRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!metric) return;

    const runId = ++effectRunId;
    let cancelled = false;
    console.log(`[Graph EFFECT #${runId}] starting for ${metric.name}, isDark=${isDark}, interval=${interval}`);
    setStatus('loading');
    destroyChart();

    (async () => {
      console.time(`[Graph #${runId}] loadLogs`);
      const logs = await loadLogs(metric.id);
      console.timeEnd(`[Graph #${runId}] loadLogs`);

      if (cancelled) {
        console.log(`[Graph #${runId}] CANCELLED after loadLogs`);
        return;
      }

      console.log(`[Graph #${runId}] ${logs.length} logs, building chart data`);
      const data = buildChartData(logs, interval);
      if (!data) {
        console.log(`[Graph #${runId}] no data`);
        setStatus('no-data');
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        console.log(`[Graph #${runId}] canvas ref is null!`);
        return;
      }
      if (cancelled) {
        console.log(`[Graph #${runId}] CANCELLED before chart creation`);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      console.log(`[Graph #${runId}] canvas dimensions: ${rect.width}x${rect.height}`);

      destroyChart();

      const ctx = canvas.getContext('2d')!;
      const actualColor = isDark ? '#60a5fa' : '#1a73e8';
      const interpolatedColor = isDark ? 'rgba(96, 165, 250, 0.4)' : 'rgba(26, 115, 232, 0.4)';
      const actualBorderColor = isDark ? '#3b82f6' : '#1557b0';
      const interpolatedBorderColor = isDark ? 'rgba(59, 130, 246, 0.5)' : 'rgba(21, 87, 176, 0.5)';
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
      const textColor = isDark ? '#b0b0b0' : '#666';

      const backgroundColors = data.isInterpolated.map(interp => interp ? interpolatedColor : actualColor);
      const borderColors = data.isInterpolated.map(interp => interp ? interpolatedBorderColor : actualBorderColor);

      const minValue = Math.min(...data.barData);
      const maxValue = Math.max(...data.barData);
      const yAxisMin = Math.max(minValue - (maxValue - minValue) * 0.2, 0);

      const isMobile = window.innerWidth <= 768;
      const tickFontSize = isMobile ? 9 : 11;
      const maxTicksLimit = isMobile ? 8 : 20;

      console.log(`[Graph #${runId}] creating Chart.js with ${data.barData.length} bars`);

      chartRef.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.labels,
          datasets: [{
            label: 'Value',
            data: data.barData,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: !isMobile,
          aspectRatio: isMobile ? undefined : 2.5,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: isDark ? '#2a2a2a' : '#ffffff',
              titleColor: isDark ? '#e0e0e0' : '#1a1a1a',
              bodyColor: isDark ? '#b0b0b0' : '#4a4a4a',
              borderColor: isDark ? '#3a3a3a' : '#e0e0e0',
              borderWidth: 1,
            },
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: {
                maxRotation: isMobile ? 90 : 45,
                minRotation: 45,
                font: { size: tickFontSize },
                color: textColor,
                maxTicksLimit,
              },
            },
            y: {
              min: yAxisMin,
              grid: { color: gridColor },
              ticks: { color: textColor, font: { size: tickFontSize } },
            },
          },
        },
      });

      console.log(`[Graph #${runId}] Chart.js created, setting status=ready`);
      setStatus('ready');

      if (cancelled) {
        console.log(`[Graph #${runId}] CANCELLED right after setStatus(ready)!`);
      }
    })();

    return () => {
      console.log(`[Graph CLEANUP #${runId}] cancelled`);
      cancelled = true;
      destroyChart();
    };
  }, [metric, interval, isDark, loadLogs, destroyChart]);

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
        <div className="graph-modal-container" style={{ position: 'relative' }}>
          {status === 'loading' && <div className="graph-loading">Loading graph...</div>}
          {status === 'no-data' && <div className="graph-no-data">No data yet. Values will be logged as they change.</div>}
          <div style={{
            position: 'relative', width: '100%', height: '350px',
            visibility: status === 'ready' ? 'visible' : 'hidden',
          }}>
            <canvas ref={canvasRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
