import { useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import type { Metric, MetricLog, GraphInterval } from '../types';
import { buildChartData } from '../lib/graph-utils';

Chart.register(...registerables);

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

  useEffect(() => {
    if (!metric) return;

    let cancelled = false;
    setStatus('loading');

    (async () => {
      const logs = await loadLogs(metric.id);
      if (cancelled) return;

      const data = buildChartData(logs, interval);
      if (!data) {
        setStatus('no-data');
        return;
      }

      setStatus('ready');

      // Wait for canvas to be in the DOM
      requestAnimationFrame(() => {
        if (cancelled || !canvasRef.current) return;

        if (chartRef.current) {
          chartRef.current.destroy();
        }

        const ctx = canvasRef.current.getContext('2d')!;
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
      });
    })();

    return () => {
      cancelled = true;
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [metric, interval, isDark, loadLogs]);

  if (!metric) return null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
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
          {status === 'ready' && <canvas ref={canvasRef} />}
        </div>
      </div>
    </div>
  );
}
