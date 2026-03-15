import 'hammerjs';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import type { ChartPoint } from '../../lib/metrics-chart-model';
import { formatAxisValue, formatTooltipTitle, formatXAxisTick, inferSpanMs } from '../../lib/metrics-chart-model';

ChartJS.register(LinearScale, PointElement, LineElement, Filler, Tooltip, Legend, zoomPlugin);

export interface MetricsTimeChartProps {
  points: ChartPoint[];
  conditionalPoints?: ChartPoint[];
  isDark: boolean;
  mode: 'normal' | 'inspect';
  variant: 'inline' | 'modal';
}

export function MetricsTimeChart({
  points, conditionalPoints, isDark, mode, variant,
}: MetricsTimeChartProps) {
  const currentColor = '#3b82f6';
  const conditionalColor = '#f59e0b';
  const currentFill = isDark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const textColor = isDark ? '#b0b0b0' : '#666';
  const tipBg = isDark ? '#2a2a2a' : '#fff';
  const tipTitle = isDark ? '#e0e0e0' : '#1a1a1a';
  const tipBody = isDark ? '#b0b0b0' : '#4a4a4a';
  const tipBorder = isDark ? '#3a3a3a' : '#e0e0e0';

  if (points.length === 0) {
    return <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>No time-series points</div>;
  }

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const isInspect = mode === 'inspect';
  const condSorted = isInspect && conditionalPoints ? [...conditionalPoints].sort((a, b) => a.x - b.x) : [];

  const allX = [...sorted.map(p => p.x), ...condSorted.map(p => p.x)];
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const spanMs = inferSpanMs(sorted);

  const pr = variant === 'modal' ? 4 : 3;
  const phr = variant === 'modal' ? 7 : 6;

  const currentDataset = {
    label: 'Current',
    data: sorted.map(p => ({ x: p.x, y: p.y })),
    borderColor: currentColor,
    backgroundColor: currentFill,
    borderWidth: 2,
    fill: true,
    tension: 0.25,
    pointRadius: pr,
    pointHoverRadius: phr,
    pointBackgroundColor: currentColor,
  };

  const datasets: ChartData<'line'>['datasets'] = [currentDataset];

  if (isInspect && condSorted.length > 0) {
    datasets.push({
      label: 'Conditional',
      data: condSorted.map(p => ({ x: p.x, y: p.y })),
      borderColor: conditionalColor,
      borderWidth: 2,
      fill: false,
      tension: 0.25,
      pointRadius: pr,
      pointHoverRadius: phr,
      pointBackgroundColor: conditionalColor,
    });
  }

  const data: ChartData<'line'> = { datasets };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: tipBg,
        titleColor: tipTitle,
        bodyColor: tipBody,
        borderColor: tipBorder,
        borderWidth: 1,
        callbacks: {
          title: (items) => {
            const item = items.find(i => i.dataset.label === 'Current');
            if (!item) return '';
            const p = sorted[item.dataIndex];
            return p ? formatTooltipTitle(p) : '';
          },
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y != null ? formatAxisValue(ctx.parsed.y) : ''}`,
        },
      },
      zoom: variant === 'modal'
        ? {
            limits: { x: { min: xMin, max: xMax } },
            pan: { enabled: true, mode: 'x' as const },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              drag: { enabled: true },
              mode: 'x' as const,
            },
          }
        : undefined,
    },
    scales: {
      x: {
        type: 'linear',
        min: xMin,
        max: xMax,
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          maxTicksLimit: variant === 'modal' ? 8 : 5,
          callback: (v) => formatXAxisTick(Number(v), spanMs),
        },
      },
      y: {
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          callback: (v) => formatAxisValue(Number(v)),
        },
      },
    },
  };

  return <Line data={data} options={options} />;
}
