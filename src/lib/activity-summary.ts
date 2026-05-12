import type { ActivityItem } from './api';
import { formatTargetDateDisplay } from './date-utils';

export interface FriendlyActivityType { id: string; label: string; color: string }

export const FRIENDLY_ACTIVITY_TYPES: FriendlyActivityType[] = [
  { id: 'proposal_created',    label: 'Proposals',     color: '#db2777' },
  { id: 'proposal_message',    label: 'Chat',      color: '#be185d' },
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

export function activityDetail(item: ActivityItem): string | null {
  const d = item.data as Record<string, unknown>;
  switch (item.type) {
    case 'proposal_created': {
      const status = s(d.status);
      return status || null;
    }
    case 'market_created':
    case 'market_resolved': {
      const target = s(d.targetDate);
      return target ? formatTargetDateDisplay(target) : null;
    }
    case 'metric_update': {
      const oldV = typeof d.oldValue === 'number' ? d.oldValue : Number(d.oldValue);
      const newV = typeof d.newValue === 'number' ? d.newValue : Number(d.newValue);
      if (!Number.isFinite(oldV) || !Number.isFinite(newV)) return null;
      const diff = newV - oldV;
      if (Math.abs(diff) < 0.005) return 'no change';
      const sign = diff > 0 ? '+' : '';
      if (Math.abs(oldV) >= 0.01) {
        const pct = (diff / Math.abs(oldV)) * 100;
        return `${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(1)}%)`;
      }
      return `${sign}${diff.toFixed(2)}`;
    }
    case 'trade': {
      const cost = n(d.cost);
      const shares = n(d.shares);
      if (Math.abs(cost) >= 0.01) return `${cost.toFixed(2)} cr`;
      if (Math.abs(shares) >= 0.01) return `${shares.toFixed(2)} sh`;
      return null;
    }
    case 'liquidity': {
      const total = n(d.totalLiquidity);
      if (total > 0) return `pool ${total.toFixed(2)} cr`;
      return null;
    }
    default:
      return null;
  }
}

export function activityHref(item: ActivityItem): string | null {
  if (item.proposalId) {
    return `/proposals?id=${encodeURIComponent(item.proposalId)}`;
  }
  if (item.marketId) {
    return `/markets?marketId=${encodeURIComponent(item.marketId)}`;
  }
  if (item.metricId) {
    return `/metrics?focus=${encodeURIComponent(item.metricId)}`;
  }
  return null;
}

export function summarizeActivity(item: ActivityItem): string {
  const d = item.data as Record<string, unknown>;
  const actor = item.actor?.label;
  switch (item.type) {
    case 'proposal_created': {
      const title = s(d.title) || 'a proposal';
      return actor
        ? `${actor} proposed "${title}"`
        : `Proposed "${title}"`;
    }
    case 'proposal_message': {
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
