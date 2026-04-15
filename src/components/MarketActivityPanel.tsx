import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { fmtTime, getTimestampSeconds } from '../lib/date-utils';
import { resolutionPayouts } from '../lib/amm';
import { ConsensusChart } from './charts/ConsensusChart';
import type { LiquidityEvent, Market, TradePoint } from '../types';

interface MarketPosition {
  agentId: string;
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(4).replace(/\.?0+$/, '');
  if (abs >= 0.01) return value.toFixed(6).replace(/\.?0+$/, '');
  return value.toFixed(9).replace(/\.?0+$/, '');
}

export function MarketActivityPanel({
  market,
  workspaceId,
  onError,
  refreshToken = 0,
  metricValue,
  isAdmin,
}: {
  market: Market;
  workspaceId?: string;
  onError: (msg: string) => void;
  refreshToken?: number;
  metricValue?: number | null;
  isAdmin?: boolean;
}) {
  const [trades, setTrades] = useState<TradePoint[]>([]);
  const [liquidityEvents, setLiquidityEvents] = useState<LiquidityEvent[]>([]);
  const [marketPositions, setMarketPositions] = useState<MarketPosition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tradesKey = `trades:${market.id}`;
    const liquidityKey = `liqEvents:${market.id}`;
    const cachedTrades = cacheGet<TradePoint[]>(tradesKey);
    const cachedLiquidityEvents = cacheGet<LiquidityEvent[]>(liquidityKey);
    let cancelled = false;

    if (cachedTrades) {
      setTrades(cachedTrades);
      setLoading(false);
    } else {
      setTrades([]);
      setLoading(true);
    }

    if (cachedLiquidityEvents) {
      setLiquidityEvents(cachedLiquidityEvents);
    } else {
      setLiquidityEvents([]);
    }

    api.getMarketTrades(market.id, workspaceId)
      .then(data => {
        if (cancelled) return;
        cacheSet(tradesKey, data);
        setTrades(data);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        onError(e.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    api.getMarketLiquidityEvents(market.id, workspaceId)
      .then(data => {
        if (cancelled) return;
        cacheSet(liquidityKey, data);
        setLiquidityEvents(data);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        onError(e.message);
      });

    // Admins see all participants' positions (competitive info, hence admin-gated
     // on the backend). Non-admins see only their own rows via the self-scoped endpoint.
    const positionsPromise = isAdmin
      ? api.getMarketPositions(market.id, workspaceId)
      : api.getPositions(market.id, undefined, workspaceId);
    positionsPromise
      .then((data: MarketPosition[]) => { if (!cancelled) setMarketPositions(data); })
      .catch((e: Error) => { if (!cancelled) console.error('Failed to load positions:', e.message); });

    return () => {
      cancelled = true;
    };
  }, [market.id, onError, refreshToken, workspaceId, isAdmin]);

  const logEntries = useMemo(() => {
    type LogEntry =
      | { kind: 'trade'; ts: number; data: TradePoint }
      | { kind: 'liquidity'; ts: number; data: LiquidityEvent };

    return [
      ...trades
        .filter(trade => trade.consensus != null)
        .flatMap(trade => {
          const ts = getTimestampSeconds(trade.createdAt);
          return ts == null ? [] : [{ kind: 'trade' as const, ts, data: trade }];
        }),
      ...liquidityEvents.flatMap(event => {
        const ts = getTimestampSeconds(event.createdAt);
        return ts == null ? [] : [{ kind: 'liquidity' as const, ts, data: event }];
      }),
    ].sort((a, b) => b.ts - a.ts) as LogEntry[];
  }, [liquidityEvents, trades]);

  return (
    <div style={{ marginTop: '0.75rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '0.5rem 0.5rem 0' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', paddingLeft: '0.25rem' }}>
        Prediction history
      </div>

      {loading ? (
        <div style={{ height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          Loading activity...
        </div>
      ) : (
        <ConsensusChart trades={trades} rangeMin={market.rangeMin} rangeMax={market.rangeMax} />
      )}

      {logEntries.length > 0 && (
        <div style={{ marginTop: '0.5rem', maxHeight: '160px', overflowY: 'auto', borderTop: '1px solid var(--border-color)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
                {['Time', 'Actor', 'Type', 'Amount', 'Detail', 'Result'].map(header => (
                  <th
                    key={header}
                    style={{
                      padding: '0.2rem 0.4rem',
                      textAlign: header === 'Type' ? 'center' : ['Amount', 'Detail', 'Result'].includes(header) ? 'right' : 'left',
                      color: 'var(--text-secondary)',
                      fontWeight: 500,
                      borderBottom: '1px solid var(--border-color)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logEntries.map((entry, index) => entry.kind === 'trade' ? (
                <tr key={`${entry.kind}:${entry.ts}:${index}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtTime(entry.ts)}</td>
                  <td style={{ padding: '0.2rem 0.4rem', fontFamily: 'monospace', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.data.agentId ?? '-'}</td>
                  <td style={{ padding: '0.2rem 0.4rem', textAlign: 'center', color: entry.data.direction === 'higher' ? 'var(--success-text)' : 'var(--error-text)' }}>{entry.data.direction === 'higher' ? '▲' : '▼'}</td>
                  <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontFamily: 'monospace' }}>{formatCompactNumber(entry.data.shares)}</td>
                  <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontFamily: 'monospace' }}>
                    {entry.data.cost == null ? '-' : entry.data.cost > 0 ? `paid ${formatCompactNumber(entry.data.cost)}` : `received ${formatCompactNumber(-entry.data.cost)}`}
                  </td>
                  <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{formatCompactNumber(entry.data.consensus)}</td>
                </tr>
              ) : (
                <tr key={`${entry.kind}:${entry.data.id}:${index}`} style={{ borderBottom: '1px solid var(--border-color)', opacity: 0.8 }}>
                  <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtTime(entry.ts)}</td>
                  <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-secondary)' }}>admin</td>
                  <td style={{ padding: '0.2rem 0.4rem', textAlign: 'center', color: 'var(--focus-border)' }}>{entry.data.type === 'initial' ? 'funded' : '+funds'}</td>
                  <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: 'var(--focus-border)', fontFamily: 'monospace', fontWeight: 600 }}>+{formatCompactNumber(entry.data.amount)}</td>
                  <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                    {entry.data.type === 'initial' ? 'initial funding' : 'added funds'}
                  </td>
                  <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'monospace' }}></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {marketPositions.length > 0 && (
        <PositionsBreakdown
          positions={marketPositions}
          market={market}
          metricValue={metricValue}
          scope={isAdmin ? 'all' : 'self'}
        />
      )}
    </div>
  );
}

function PositionsBreakdown({ positions, market, metricValue, scope }: {
  positions: MarketPosition[];
  market: Market;
  metricValue?: number | null;
  scope: 'all' | 'self';
}) {
  const isResolved = market.status === 'resolved';
  const consensusValue = market.consensus;
  const clampedMetric = metricValue != null ? Math.max(market.rangeMin, Math.min(market.rangeMax, metricValue)) : null;
  const resolvedValue = isResolved && market.actualValue != null
    ? Math.max(market.rangeMin, Math.min(market.rangeMax, market.actualValue))
    : null;

  const payout = (value: number, dir: 'higher' | 'lower', shares: number) => {
    const [lp, hp] = resolutionPayouts(value, market.rangeMin, market.rangeMax);
    return shares * (dir === 'higher' ? hp : lp);
  };

  const rows = useMemo(() => positions.map(pos => ({
    ...pos,
    payResolved: resolvedValue != null ? payout(resolvedValue, pos.direction, pos.shares) : null,
    payConsensus: !isResolved && consensusValue != null ? payout(consensusValue, pos.direction, pos.shares) : null,
    payMetric: !isResolved && clampedMetric != null ? payout(clampedMetric, pos.direction, pos.shares) : null,
  })), [positions, isResolved, resolvedValue, consensusValue, clampedMetric, market.rangeMin, market.rangeMax]);

  const thStyle = { padding: '0.2rem 0.4rem', color: 'var(--text-secondary)', fontWeight: 500 as const, borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' as const, fontSize: '0.72rem' };
  const tdStyle = { padding: '0.2rem 0.4rem', fontFamily: 'monospace', fontSize: '0.72rem' };

  const cellPL = (pay: number | null, cost: number) => {
    if (pay == null) return { text: '-', color: undefined as string | undefined };
    const pl = pay - cost;
    return {
      text: `${formatCompactNumber(pay)} (${pl >= 0 ? '+' : ''}${formatCompactNumber(pl)})`,
      color: pl >= 0 ? 'var(--success-text)' : 'var(--error-text)',
    };
  };

  return (
    <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.25rem' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', paddingLeft: '0.25rem' }}>
        {scope === 'self' ? 'Your positions' : 'Positions'}
        {isResolved && resolvedValue != null && (
          <span style={{ marginLeft: '0.5rem' }}>(resolved at {formatCompactNumber(market.actualValue)})</span>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: 'left' }}>Agent</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Side</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Shares</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
            {isResolved ? (
              <th style={{ ...thStyle, textAlign: 'right' }}>
                {resolvedValue != null ? `payout (P&L)` : 'payout'}
              </th>
            ) : (
              <>
                <th style={{ ...thStyle, textAlign: 'right' }}>
                  {consensusValue != null ? `@ consensus (${Math.round(consensusValue)})` : '@ consensus'}
                </th>
                <th style={{ ...thStyle, textAlign: 'right' }}>
                  {clampedMetric != null ? `@ current (${Math.round(clampedMetric)})` : '@ current'}
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.agentId}-${r.direction}-${i}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ ...tdStyle, maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.agentId}</td>
              <td style={{ ...tdStyle, textAlign: 'center', color: r.direction === 'higher' ? 'var(--success-text)' : 'var(--error-text)' }}>
                {r.direction === 'higher' ? '▲' : '▼'}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactNumber(r.shares)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactNumber(r.totalCost)}</td>
              {isResolved ? (
                (() => { const c = cellPL(r.payResolved, r.totalCost); return (
                  <td style={{ ...tdStyle, textAlign: 'right', color: c.color }}>{c.text}</td>
                ); })()
              ) : (
                <>
                  {(() => { const c = cellPL(r.payConsensus, r.totalCost); return (
                    <td style={{ ...tdStyle, textAlign: 'right', color: c.color }}>{c.text}</td>
                  ); })()}
                  {(() => { const c = cellPL(r.payMetric, r.totalCost); return (
                    <td style={{ ...tdStyle, textAlign: 'right', color: c.color }}>{c.text}</td>
                  ); })()}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
