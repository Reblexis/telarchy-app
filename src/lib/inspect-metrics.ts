import { calculateMetricDepths, recalculateMetrics, evaluateFormulaAtTime } from './metrics-engine';
import type { Market, Metric, TaskUtilitySummary } from '../types';

export function enrichMetrics(metrics: Metric[], consensusMap: Record<string, number> = {}): Metric[] {
  recalculateMetrics(metrics, consensusMap);
  const depths = calculateMetricDepths(metrics);
  metrics.forEach(m => {
    if (depths[m.id] === undefined) console.error(`enrichMetrics: no depth for metric ${m.id} (${m.name})`);
    m.depth = depths[m.id] ?? 0;
  });
  metrics.sort((a, b) => (
    b.depth !== undefined && a.depth !== undefined && a.depth !== b.depth
      ? a.depth - b.depth
      : (a.order || 999) - (b.order || 999)
  ));
  return metrics;
}

/** Build a consensus map from market data, optionally filtering by tradeCount. */
export function buildConsensusMap(markets: Market[], onlyTraded = false): Record<string, number> {
  const map: Record<string, number> = {};
  for (const market of markets) {
    if (market.consensus === null) continue;
    if (onlyTraded && market.tradeCount === 0) continue;
    map[`${market.metricName}:${market.targetDate}`] = market.consensus;
  }
  return map;
}

/** Extract baseline consensus map from metrics' timeSeries data. */
function buildBaselineConsensusFromMetrics(metrics: Metric[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const m of metrics) {
    if (!m.timeSeries) continue;
    for (const { date, value } of m.timeSeries) {
      map[`${m.name}:${date}`] = value;
    }
  }
  return map;
}

export function attachConditionalTimeSeries(
  metrics: Metric[],
  consensusMap: Record<string, number>,
): void {
  const nameToFormula: Record<string, string> = {};
  metrics.forEach(m => { nameToFormula[m.name] = m.formula || '0'; });

  for (const metric of metrics) {
    if (!metric.timeSeries || metric.timeSeries.length === 0) continue;
    const isLeaf = !metric.formula || metric.formula.trim() === '0';
    const series: Array<{ date: string; value: number }> = [];
    const memo: Record<string, number> = {};

    for (const { date } of metric.timeSeries) {
      if (isLeaf) {
        const value = consensusMap[`${metric.name}:${date}`];
        if (value !== undefined) series.push({ date, value });
      } else {
        series.push({ date, value: evaluateFormulaAtTime(metric.formula, nameToFormula, consensusMap, date, memo) });
      }
    }

    metric.conditionalTimeSeries = series.length > 0 ? series : undefined;
  }
}

export function buildInspectMetrics(metricsData: Metric[], marketsData: Market[]): Metric[] {
  // Start from baseline consensus (embedded in metrics' timeSeries) and
  // overlay only conditional markets that have actually been traded on.
  const baselineConsensus = buildBaselineConsensusFromMetrics(metricsData);
  const tradedOverlay = buildConsensusMap(marketsData, true);
  const consensusMap = { ...baselineConsensus, ...tradedOverlay };

  const cloned = metricsData.map(metric => ({ ...metric, baselineTotal: metric.total }));
  const enriched = enrichMetrics(cloned, consensusMap);
  attachConditionalTimeSeries(enriched, consensusMap);
  return enriched;
}

export function getInspectUtilitySummary(metricsData: Metric[], marketsData: Market[]): TaskUtilitySummary {
  const baselineUtility = metricsData.find(metric => metric.name === 'Utility')?.total ?? null;
  const inspectMetrics = buildInspectMetrics(metricsData, marketsData);
  const expectedCurrentUtility = inspectMetrics.find(metric => metric.name === 'Utility')?.total ?? null;
  return { expectedCurrentUtility, baselineUtility };
}
