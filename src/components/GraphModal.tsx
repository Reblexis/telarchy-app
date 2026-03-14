import { useEffect, useState, useCallback } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Tooltip, Filler,
  type ChartData, type ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import type { Metric, MetricLog, GraphInterval } from '../types';
import { buildChartData } from '../lib/graph-utils';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Filler);

interface GraphModalProps {
  metric: Metric | null;
  interval: GraphInterval;
  isDark: boolean;
  loadLogs: (metricId: string) => Promise<MetricLog[]>;
  onClose: () => void;
}

export function GraphModal({ metric, interval, isDark, loadLogs, onClose }: GraphModalProps) {
  const [chartConfig, setChartConfig] = useState<{
    data: ChartData<'bar'>;
    options: ChartOptions<'bar'>;
  } | null>(null);
  const [status, setStatus] = useState<'loading' | 'no-data' | 'ready'>('loading');

  const loadChart = useCallback(async (m: Metric) => {
    setStatus('loading');
    setChartConfig(null);

    const logs = await loadLogs(m.id);
    const built = buildChartData(logs, interval);
    if (!built) {
      setStatus('no-data');
      return;
    }

    const actualColor = isDark ? '#60a5fa' : '#1a73e8';
    const interpolatedColor = isDark ? 'rgba(96, 165, 250, 0.4)' : 'rgba(26, 115, 232, 0.4)';
    const actualBorder = isDark ? '#3b82f6' : '#1557b0';
    const interpolatedBorder = isDark ? 'rgba(59, 130, 246, 0.5)' : 'rgba(21, 87, 176, 0.5)';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const textColor = isDark ? '#b0b0b0' : '#666';

    const isMobile = window.innerWidth <= 768;
    const tickFontSize = isMobile ? 9 : 11;
    const maxTicksLimit = isMobile ? 8 : 20;

    const minVal = Math.min(...built.barData);
    const maxVal = Math.max(...built.barData);
    const yMin = Math.max(minVal - (maxVal - minVal) * 0.2, 0);

    const data: ChartData<'bar'> = {
      labels: built.labels,
      datasets: [{
        label: 'Value',
        data: built.barData,
        backgroundColor: built.isInterpolated.map(i => i ? interpolatedColor : actualColor),
        borderColor: built.isInterpolated.map(i => i ? interpolatedBorder : actualBorder),
        borderWidth: 1,
      }],
    };

    const options: ChartOptions<'bar'> = {
      responsive: true,
      maintainAspectRatio: false,
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
          min: yMin,
          grid: { color: gridColor },
          ticks: { color: textColor, font: { size: tickFontSize } },
        },
      },
    };

    setChartConfig({ data, options });
    setStatus('ready');
  }, [interval, isDark, loadLogs]);

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
          {status === 'ready' && chartConfig && (
            <div style={{ position: 'relative', width: '100%', height: '350px' }}>
              <Bar data={chartConfig.data} options={chartConfig.options} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
