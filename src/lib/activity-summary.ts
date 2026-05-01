import type { ActivityItem } from './api';

export interface FriendlyActivityType { id: string; label: string; color: string }

export const FRIENDLY_ACTIVITY_TYPES: FriendlyActivityType[] = [
  { id: 'task_created',    label: 'Tasks',     color: '#db2777' },
  { id: 'task_message',    label: 'Chat',      color: '#be185d' },
  { id: 'market_created',  label: 'Markets',   color: '#7c3aed' },
  { id: 'market_resolved', label: 'Resolved',  color: '#9333ea' },
  { id: 'metric_update',   label: 'KPIs',      color: '#0891b2' },
  { id: 'trade',           label: 'Forecasts', color: '#2563eb' },
  { id: 'liquidity',       label: 'Liquidity', color: '#65a30d' },
];

export const ACTIVITY_TYPE_COLOR: Record<string, string> = Object.fromEntries(
  FRIENDLY_ACTIVITY_TYPES.map(t => [t.id, t.color]),
);
export const ACTIVITY_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  FRIENDLY_ACTIVITY_TYPES.map(t => [t.id, t.label]),
);

function n(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function s(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function getActivityTags(item: ActivityItem): string[] {
  const d = item.data as Record<string, unknown>;
  const out: string[] = [];
  const typeLabel = ACTIVITY_TYPE_LABEL[item.type];
  if (typeLabel) out.push(typeLabel);
  const metricName = s(d.metricName);
  if (metricName && metricName.toLowerCase() !== typeLabel?.toLowerCase()) {
    out.push(metricName);
  }
  return out;
}

export function summarizeActivity(item: ActivityItem): string {
  const d = item.data as Record<string, unknown>;
  const actor = item.actor?.label;
  switch (item.type) {
    case 'task_created': {
      const title = s(d.title) || 'a task';
      return actor
        ? `${actor} proposed "${title}"`
        : `Proposed "${title}"`;
    }
    case 'task_message': {
      const content = s(d.content);
      const preview = content.length > 140 ? content.slice(0, 140) + '…' : content;
      return actor ? `${actor}: ${preview}` : preview;
    }
    case 'market_created': {
      const name = s(d.metricName) || 'a metric';
      return `Forecast opened on ${name}`;
    }
    case 'market_resolved': {
      const name = s(d.metricName) || 'a metric';
      const actual = d.actualValue;
      if (d.voided) return `${name} voided`;
      return `${name} resolved at ${actual ?? '?'}`;
    }
    case 'metric_update': {
      const name = s(d.metricName) || 'a metric';
      return `${name} ${d.oldValue ?? '?'} → ${d.newValue ?? '?'}`;
    }
    case 'trade': {
      const dir = s(d.direction);
      const name = s(d.metricName) || 'a metric';
      const verb = dir === 'higher' ? 'higher' : dir === 'lower' ? 'lower' : '';
      const head = actor ?? 'Forecast';
      return verb
        ? (actor ? `${head} forecast ${verb} on ${name}` : `${head} ${verb} on ${name}`)
        : (actor ? `${head} forecast on ${name}` : `${head} on ${name}`);
    }
    case 'liquidity': {
      const amt = n(d.amount);
      const name = s(d.metricName) || 'a market';
      const sign = amt >= 0 ? '+' : '';
      return `${sign}${amt.toFixed(2)} cr liquidity on ${name}`;
    }
    default:
      return '';
  }
}
