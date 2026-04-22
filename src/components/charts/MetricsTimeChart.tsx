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
  type Plugin,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import type { ChartPoint } from '../../lib/metrics-chart-model';
import { formatAxisValue, formatTooltipTitle, formatXAxisTick } from '../../lib/metrics-chart-model';

ChartJS.register(LinearScale, PointElement, LineElement, Filler, Tooltip, Legend, zoomPlugin);

export interface MetricsTimeChartProps {
  points: ChartPoint[];
  conditionalPoints?: ChartPoint[];
  /** Forecast points to overlay on top of the main series (rendered as a dashed line with a "now" divider). */
  futurePoints?: ChartPoint[];
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
  points, conditionalPoints, futurePoints, mode, variant, rangeMin, rangeMax, halfLifeYears, onPointClick,
}: MetricsTimeChartProps) {
  const currentColor = '#b45309';
  const conditionalColor = '#0f766e';
  const currentFill = 'rgba(180,83,9,0.08)';
  const rootStyles = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const cssVar = (name: string, fallback: string) => {
    const v = rootStyles?.getPropertyValue(name).trim();
    return v && v.length > 0 ? v : fallback;
  };
  const gridColor = 'rgba(127,127,127,0.15)';
  const textColor = cssVar('--text-secondary', '#666');
  const tipBg = cssVar('--bg-elevated', '#fff');
  const tipTitle = cssVar('--text-primary', '#1a1a1a');
  const tipBody = cssVar('--text-secondary', '#4a4a4a');
  const tipBorder = cssVar('--border-color', '#e0e0e0');

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const isInspect = mode === 'inspect';
  const condSorted = isInspect && conditionalPoints ? [...conditionalPoints].sort((a, b) => a.x - b.x) : [];
  const futureSorted = futurePoints ? [...futurePoints].sort((a, b) => a.x - b.x) : [];

  if (sorted.length === 0 && condSorted.length === 0 && futureSorted.length === 0) {
    return <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>No time-series points</div>;
  }

  const allX = [...sorted.map(p => p.x), ...condSorted.map(p => p.x), ...futureSorted.map(p => p.x)];
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const spanMs = Math.max(1, xMax - xMin);

  const pr = variant === 'modal' ? 4 : 3;
  const phr = variant === 'modal' ? 7 : 6;

  const datasets: ChartData<'line'>['datasets'] = [];

  if (sorted.length > 0) {
    // Interpolated points (e.g. forward-filled gaps between sparse logs) should
    // not render as dots — otherwise a single old log becomes a long plateau of
    // identical-looking points and the user can't tell real logs from padding.
    // The line still passes through them so the visual continuity is preserved.
    const interpolatedFlags = sorted.map(p => p.interpolated === true);
    const hasInterpolation = interpolatedFlags.some(Boolean);
    datasets.push({
      label: 'Current',
      data: sorted.map(p => ({ x: p.x, y: p.y, interpolated: p.interpolated === true })),
      borderColor: currentColor,
      backgroundColor: currentFill,
      borderWidth: 2,
      fill: true,
      tension: 0.25,
      pointRadius: hasInterpolation
        ? (ctx) => (interpolatedFlags[ctx.dataIndex] ? 0 : pr)
        : pr,
      pointHoverRadius: hasInterpolation
        ? (ctx) => (interpolatedFlags[ctx.dataIndex] ? 0 : phr)
        : phr,
      pointBackgroundColor: currentColor,
    });
  }

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

  if (futureSorted.length > 0) {
    datasets.push({
      label: 'Forecast',
      data: futureSorted.map(p => ({ x: p.x, y: p.y })),
      borderColor: conditionalColor,
      backgroundColor: 'rgba(15,118,110,0.06)',
      borderWidth: 2,
      borderDash: [6, 4],
      fill: false,
      tension: 0.25,
      pointRadius: pr,
      pointHoverRadius: phr,
      pointBackgroundColor: conditionalColor,
    });
  }

  const data: ChartData<'line'> = { datasets };

  // TP decay weight overlay is drawn as a chart plugin rather than a dataset so
  // it does not participate in hit detection or tooltip resolution. Using a
  // dataset caused index/nearest interaction modes to pick its 41 dense points
  // as the nearest element, breaking point highlight and tooltip positioning.
  const decayOverlay: Plugin<'line'> | null = halfLifeYears && halfLifeYears > 0 ? {
    id: 'decayOverlay',
    afterDatasetsDraw(chart) {
      const xScale = chart.scales.x;
      if (!xScale) return;
      const { ctx, chartArea } = chart;
      const nowMs = Date.now();
      const lambda = Math.LN2 / halfLifeYears;
      const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
      const steps = 40;
      const top = chartArea.top;
      const bottom = chartArea.bottom;
      const height = bottom - top;
      const weightAt = (x: number) => {
        const yearsFromNow = (x - nowMs) / msPerYear;
        return yearsFromNow <= 0 ? 1.0 : Math.exp(-lambda * yearsFromNow);
      };
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = xMin + (i / steps) * (xMax - xMin);
        const px = xScale.getPixelForValue(x);
        const py = bottom - weightAt(x) * height;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineTo(xScale.getPixelForValue(xMax), bottom);
      ctx.lineTo(xScale.getPixelForValue(xMin), bottom);
      ctx.closePath();
      ctx.fillStyle = 'rgba(139,92,246,0.05)';
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = xMin + (i / steps) * (xMax - xMin);
        const px = xScale.getPixelForValue(x);
        const py = bottom - weightAt(x) * height;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(139,92,246,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    },
  } : null;

  // "Now" divider is drawn when a future forecast overlay is shown, so the user
  // can tell at a glance where past logs end and projections begin.
  const nowDivider: Plugin<'line'> | null = futureSorted.length > 0 ? {
    id: 'nowDivider',
    afterDatasetsDraw(chart) {
      const xScale = chart.scales.x;
      if (!xScale) return;
      const nowMs = Date.now();
      if (nowMs < xMin || nowMs > xMax) return;
      const { ctx, chartArea } = chart;
      const px = xScale.getPixelForValue(nowMs);
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(127,127,127,0.45)';
      ctx.lineWidth = 1;
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    },
  } : null;

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      mode: 'nearest',
      axis: 'x',
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
        yAlign: 'bottom',
        caretPadding: 10,
        // Hovering a forward-filled gap should not show the stale carried
        // value as if it were a real log.
        filter: (item) => !((item.raw as { interpolated?: boolean } | null)?.interpolated),
        callbacks: {
          title: (items) => {
            const item = items[0];
            if (!item) return '';
            const source = item.dataset.label === 'Conditional'
              ? condSorted
              : item.dataset.label === 'Forecast'
                ? futureSorted
                : sorted;
            const p = source[item.dataIndex];
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
          const allY = [...sorted, ...condSorted, ...futureSorted].map(p => p.y);
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
    },
  };

  const plugins = [decayOverlay, nowDivider].filter((p): p is Plugin<'line'> => p !== null);

  return <Line data={data} options={options} plugins={plugins.length > 0 ? plugins : undefined} />;
}
