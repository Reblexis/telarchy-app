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
  mode: 'normal' | 'inspect';
  variant: 'inline' | 'modal';
  rangeMin?: number;
  rangeMax?: number;
  /** Time preference half-life in years. When set, overlays a subtle decay weight curve. */
  halfLifeYears?: number;
  /** Invoked when the user clicks a data point. Receives the underlying ChartPoint. */
  onPointClick?: (point: ChartPoint) => void;
}

export function MetricsTimeChart({
  points, conditionalPoints, mode, variant, rangeMin, rangeMax, halfLifeYears, onPointClick,
}: MetricsTimeChartProps) {
  const currentColor = '#b45309';
  const conditionalColor = '#0f766e';
  const currentFill = 'rgba(180,83,9,0.08)';
  const gridColor = 'rgba(23,23,28,0.08)';
  const textColor = '#666';
  const tipBg = '#fff';
  const tipTitle = '#1a1a1a';
  const tipBody = '#4a4a4a';
  const tipBorder = '#e0e0e0';

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

  // Overlay TP decay weight curve on a hidden secondary y-axis
  if (halfLifeYears && halfLifeYears > 0) {
    const nowMs = Date.now();
    const lambda = Math.LN2 / halfLifeYears;
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const steps = 40;
    const decayPoints = [];
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (i / steps) * (xMax - xMin);
      const yearsFromNow = (x - nowMs) / msPerYear;
      // Weight is 1.0 at t=0, decays for future, clamps to 1.0 for past
      const weight = yearsFromNow <= 0 ? 1.0 : Math.exp(-lambda * yearsFromNow);
      decayPoints.push({ x, y: weight });
    }
    datasets.push({
      label: 'Weight',
      data: decayPoints,
      borderColor: 'rgba(139,92,246,0.25)',
      backgroundColor: 'rgba(139,92,246,0.05)',
      borderWidth: 1,
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 0,
      pointHitRadius: 0,
      yAxisID: 'yWeight',
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
    onHover: onPointClick
      ? (event, _elements, chart) => {
          const target = event.native?.target as HTMLElement | undefined;
          if (!target) return;
          const canvas = chart.canvas;
          const rect = canvas.getBoundingClientRect();
          const native = event.native as MouseEvent | undefined;
          if (!native) { target.style.cursor = 'default'; return; }
          const px = native.clientX - rect.left;
          const py = native.clientY - rect.top;
          const inArea = px >= chart.chartArea.left && px <= chart.chartArea.right
            && py >= chart.chartArea.top && py <= chart.chartArea.bottom;
          target.style.cursor = inArea ? 'pointer' : 'default';
        }
      : undefined,
    onClick: onPointClick
      ? (event, _elements, chart) => {
          const native = event.native as MouseEvent | undefined;
          if (!native) return;
          const rect = chart.canvas.getBoundingClientRect();
          const px = native.clientX - rect.left;
          if (px < chart.chartArea.left || px > chart.chartArea.right) return;
          const xScale = chart.scales.x;
          if (!xScale) return;
          const xValue = xScale.getValueForPixel(px);
          if (xValue === undefined) return;
          const pickNearest = (pts: ChartPoint[]) => {
            if (pts.length === 0) return null;
            let best = pts[0];
            let bestDist = Math.abs(pts[0].x - xValue);
            for (let i = 1; i < pts.length; i++) {
              const d = Math.abs(pts[i].x - xValue);
              if (d < bestDist) { best = pts[i]; bestDist = d; }
            }
            return best;
          };
          const point = pickNearest(sorted);
          if (point) onPointClick(point);
        }
      : undefined,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: tipBg,
        titleColor: tipTitle,
        bodyColor: tipBody,
        borderColor: tipBorder,
        borderWidth: 1,
        position: 'nearest',
        filter: (item) => item.dataset.label !== 'Weight',
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
        ...(() => {
          const allY = [...sorted, ...condSorted].map(p => p.y);
          const dataMin = Math.min(...allY);
          const dataMax = Math.max(...allY);
          const dataSpan = dataMax - dataMin;
          if (dataSpan > 0) return rangeMin !== undefined && rangeMax !== undefined ? { min: rangeMin, max: rangeMax } : {};
          // All points are the same value; enforce a minimum visible span
          const center = dataMin;
          const minSpan = rangeMin !== undefined && rangeMax !== undefined
            ? (rangeMax !== rangeMin ? (rangeMax - rangeMin) * 0.1 : Math.abs(rangeMax) * 0.1 || 1)
            : Math.abs(center) * 0.1 || 1;
          const yLo = center - minSpan / 2;
          const yHi = center + minSpan / 2;
          if (rangeMin !== undefined && rangeMax !== undefined) {
            return { min: Math.max(rangeMin, yLo), max: Math.min(rangeMax, yHi) };
          }
          return { min: yLo, max: yHi };
        })(),
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          callback: (v) => formatAxisValue(Number(v)),
        },
      },
      ...(halfLifeYears ? {
        yWeight: {
          display: false,
          min: 0,
          max: 1,
          position: 'right' as const,
        },
      } : {}),
    },
  };

  return <Line data={data} options={options} />;
}
