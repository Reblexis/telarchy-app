import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { fmtTime, getTimestampSeconds } from '../lib/date-utils';
import { previewTrade } from '../lib/amm';
import { ConsensusChart } from './charts/ConsensusChart';
import type { Market, Position, TradePoint, LiquidityEvent } from '../types';

const inputStyle = { padding: '0.4rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', width: '80px' } as const;
const labelStyle = { display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' } as const;

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(4).replace(/\.?0+$/, '');
  if (abs >= 0.01) return value.toFixed(6).replace(/\.?0+$/, '');
  return value.toFixed(9).replace(/\.?0+$/, '');
}

export function TradingPanel({ market, workspaceId, showLiquidityControls = true, onTrade, onError }: {
  market: Market; workspaceId?: string; showLiquidityControls?: boolean;
  onTrade: () => void; onError: (msg: string) => void;
}) {
  const [tradeAmount, setTradeAmount] = useState('');
  const [liqAmount, setLiqAmount] = useState('');
  const [trading, setTrading] = useState(false);
  const [lastResult, setLastResult] = useState<{ direction: string; shares: number; cost: number; consensus: number } | null>(null);
  const [trades, setTrades] = useState<TradePoint[]>([]);
  const [liquidityEvents, setLiquidityEvents] = useState<LiquidityEvent[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [positions, setPositions] = useState<Position[]>([]);
  const [sellInputs, setSellInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    const tKey = `trades:${market.id}`;
    const lKey = `liqEvents:${market.id}`;
    const pKey = `positions:${market.id}:me`;

    const cachedTrades = cacheGet<TradePoint[]>(tKey);
    const cachedLiquidityEvents = cacheGet<LiquidityEvent[]>(lKey);
    const cachedPositions = cacheGet<Position[]>(pKey);

    if (cachedTrades) setTrades(cachedTrades);
    if (cachedLiquidityEvents) setLiquidityEvents(cachedLiquidityEvents);
    if (cachedPositions) setPositions(cachedPositions);

    setTradesLoading(!cachedTrades);
    api.getMarketTrades(market.id, workspaceId)
      .then(data => { cacheSet(tKey, data); setTrades(data); })
      .catch((e: Error) => onError(e.message))
      .finally(() => setTradesLoading(false));
    api.getMarketLiquidityEvents(market.id, workspaceId)
      .then(data => { cacheSet(lKey, data); setLiquidityEvents(data); })
      .catch((e: Error) => onError(e.message));
    api.getPositions(market.id, undefined, workspaceId)
      .then(data => { cacheSet(pKey, data); setPositions(data); })
      .catch((e: Error) => onError(e.message));
  }, [market.id, workspaceId, onError]);

  const amount = parseFloat(tradeAmount);
  const preview = useMemo(() => {
    if (isNaN(amount) || amount <= 0 || market.probability == null) return null;
    const higher = previewTrade(market.probability, market.liquidity, 'higher', amount);
    const lower = previewTrade(market.probability, market.liquidity, 'lower', amount);
    return { higher, lower };
  }, [amount, market.probability, market.liquidity]);

  const refreshPositions = () => api.getPositions(market.id, undefined, workspaceId).then(data => {
    cacheSet(`positions:${market.id}:me`, data);
    setPositions(data);
  }).catch((e: Error) => onError(`Failed to refresh positions: ${e.message}`));

  const handleBetDirection = async (direction: 'higher' | 'lower') => {
    if (isNaN(amount) || amount <= 0) return;
    setTrading(true);
    const result = await api.trade({ marketId: market.id, direction, amount }, workspaceId)
      .catch((e: Error) => { onError(e.message); return null; });
    setTrading(false);
    if (result) {
      setLastResult({ direction, shares: result.shares, cost: result.cost, consensus: result.consensus });
      setTradeAmount('');
      setTrades(prev => {
        const next = [...prev, { consensus: result.consensus, createdAt: { _seconds: Date.now() / 1000 }, direction, shares: result.shares, cost: result.cost }];
        cacheSet(`trades:${market.id}`, next);
        return next;
      });
      api.getMarketTrades(market.id, workspaceId).then(data => {
        cacheSet(`trades:${market.id}`, data);
        setTrades(data);
      }).catch((e: Error) => onError(`Failed to refresh trades: ${e.message}`));
      refreshPositions();
      onTrade();
    }
  };

  const handleSell = async (direction: 'higher' | 'lower') => {
    const sellShares = parseFloat(sellInputs[direction] || '');
    if (isNaN(sellShares) || sellShares <= 0) return;
    setTrading(true);
    const result = await api.trade({ marketId: market.id, direction, sellShares }, workspaceId)
      .catch((e: Error) => { onError(e.message); return null; });
    setTrading(false);
    if (result) {
      setLastResult({ direction, shares: result.shares, cost: -result.proceeds, consensus: result.consensus });
      setSellInputs(prev => ({ ...prev, [direction]: '' }));
      setTrades(prev => {
        const next = [...prev, { consensus: result.consensus, createdAt: { _seconds: Date.now() / 1000 }, direction, shares: result.shares, cost: -result.proceeds }];
        cacheSet(`trades:${market.id}`, next);
        return next;
      });
      refreshPositions();
      onTrade();
    }
  };

  const handleLiquidity = async () => {
    const a = parseFloat(liqAmount);
    if (isNaN(a) || a <= 0) return;
    const result = await api.injectLiquidity(market.id, a).catch((e: Error) => { onError(e.message); return null; });
    if (result) {
      setLiqAmount('');
      const optimistic: LiquidityEvent = {
        id: `optimistic-${Date.now()}`,
        amount: a,
        totalLiquidity: result.liquidity,
        type: 'injection',
        createdAt: { _seconds: Date.now() / 1000 },
      };
      setLiquidityEvents(prev => {
        const next = [...prev, optimistic];
        cacheSet(`liqEvents:${market.id}`, next);
        return next;
      });
      api.getMarketLiquidityEvents(market.id).then(data => {
        cacheSet(`liqEvents:${market.id}`, data);
        setLiquidityEvents(data);
      }).catch((e: Error) => onError(`Failed to refresh liquidity events: ${e.message}`));
      onTrade();
    }
  };

  const previewConsensus = (dir: 'higher' | 'lower') => {
    if (!preview) return null;
    const p = dir === 'higher' ? preview.higher.newProb : preview.lower.newProb;
    return market.rangeMin + p * (market.rangeMax - market.rangeMin);
  };
  const previewShares = (dir: 'higher' | 'lower') => preview ? (dir === 'higher' ? preview.higher.shares : preview.lower.shares) : null;

  return (
    <div style={{ padding: '0.75rem 0.5rem 0.5rem' }}>
      {!tradesLoading && (
        <div style={{ marginBottom: '0.75rem', background: 'var(--bg-secondary, #f8f9fa)', borderRadius: '0.375rem', padding: '0.5rem 0.5rem 0' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', paddingLeft: '0.25rem' }}>
            Consensus history
          </div>
          <ConsensusChart trades={trades} rangeMin={market.rangeMin} rangeMax={market.rangeMax} />
          {(trades.length > 0 || liquidityEvents.length > 0) && (() => {
            type LogEntry =
              | { kind: 'trade'; ts: number; data: TradePoint }
              | { kind: 'liquidity'; ts: number; data: LiquidityEvent };
            const entries: LogEntry[] = [
              ...trades.filter(t => t.consensus != null).flatMap(t => { const ts = getTimestampSeconds(t.createdAt); return ts != null ? [{ kind: 'trade' as const, ts, data: t }] : []; }),
              ...liquidityEvents.flatMap(e => { const ts = getTimestampSeconds(e.createdAt); return ts != null ? [{ kind: 'liquidity' as const, ts, data: e }] : []; }),
            ].sort((a, b) => b.ts - a.ts);
            return (
              <div style={{ marginTop: '0.5rem', maxHeight: '160px', overflowY: 'auto', borderTop: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary, #f8f9fa)' }}>
                      {['Time', 'Actor', 'Type', 'Amount', 'Detail', 'Result'].map(h => (
                        <th key={h} style={{ padding: '0.2rem 0.4rem', textAlign: h === 'Type' ? 'center' : ['Amount', 'Detail', 'Result'].includes(h) ? 'right' : 'left', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, i) => entry.kind === 'trade' ? (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtTime(entry.ts)}</td>
                        <td style={{ padding: '0.2rem 0.4rem', fontFamily: 'monospace', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.data.agentId ?? '—'}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'center', color: entry.data.direction === 'higher' ? '#22c55e' : '#ef4444' }}>{entry.data.direction === 'higher' ? '▲' : '▼'}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontFamily: 'monospace' }}>{formatCompactNumber(entry.data.shares)}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontFamily: 'monospace' }}>
                          {entry.data.cost == null ? '—' : entry.data.cost > 0 ? `cost ${formatCompactNumber(entry.data.cost)}` : `proceeds ${formatCompactNumber(-entry.data.cost)}`}
                        </td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{formatCompactNumber(entry.data.consensus)}</td>
                      </tr>
                    ) : (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-color)', opacity: 0.8 }}>
                        <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtTime(entry.ts)}</td>
                        <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-secondary)' }}>admin</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'center', color: '#3b82f6' }}>{entry.data.type === 'initial' ? 'init' : '+liq'}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: '#3b82f6', fontFamily: 'monospace', fontWeight: 600 }}>+{formatCompactNumber(entry.data.amount)}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {entry.data.type === 'initial' ? 'initial liquidity' : 'liquidity injection'}
                        </td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>b={formatCompactNumber(entry.data.totalLiquidity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Amount ($)</label>
          <input type="number" value={tradeAmount} onChange={e => setTradeAmount(e.target.value)} placeholder="0.01" style={{ ...inputStyle, width: '90px' }} min="0.000001" step="any" />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
              {preview ? `~${formatCompactNumber(previewShares('lower'))} shares → ${formatCompactNumber(previewConsensus('lower'))}` : '\u00a0'}
            </div>
            <button className="btn-small" disabled={trading || !tradeAmount} onClick={() => handleBetDirection('lower')}
              style={{ background: '#ef4444', color: '#fff', padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}>
              {trading ? '…' : '▼ Lower'}
            </button>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
              {preview ? `~${formatCompactNumber(previewShares('higher'))} shares → ${formatCompactNumber(previewConsensus('higher'))}` : '\u00a0'}
            </div>
            <button className="btn-small" disabled={trading || !tradeAmount} onClick={() => handleBetDirection('higher')}
              style={{ background: '#22c55e', color: '#fff', padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}>
              {trading ? '…' : '▲ Higher'}
            </button>
          </div>
        </div>
        {lastResult && (
          <div style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', background: 'var(--bg-secondary, #f0f4ff)', borderRadius: '0.375rem', borderLeft: `3px solid ${lastResult.direction === 'higher' ? '#22c55e' : '#ef4444'}` }}>
            <strong>{lastResult.direction === 'higher' ? '▲' : '▼'} {formatCompactNumber(lastResult.shares)} shares</strong>
            {' '}{lastResult.cost < 0 ? `sold for $${formatCompactNumber(-lastResult.cost)}` : `for $${formatCompactNumber(lastResult.cost)}`} → consensus <strong>{formatCompactNumber(lastResult.consensus)}</strong>
          </div>
        )}
        {showLiquidityControls && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem', alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>Add liquidity (b={market.liquidity})</label>
              <input type="number" value={liqAmount} onChange={e => setLiqAmount(e.target.value)} placeholder="+" style={{ ...inputStyle, width: '60px' }} min="0.000001" step="any" />
            </div>
            <button className="btn-small" onClick={handleLiquidity} style={{ padding: '0.4rem 0.6rem' }}>Inject</button>
          </div>
        )}
      </div>

      {positions.length > 0 && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', alignSelf: 'center' }}>Sell position:</span>
          {positions.map(pos => (
            <div key={pos.direction} style={{ display: 'flex', gap: '0.25rem', alignItems: 'flex-end' }}>
              <div>
                <label style={labelStyle}>{pos.direction === 'higher' ? '▲' : '▼'} {formatCompactNumber(pos.shares)} shares</label>
                <input type="number" value={sellInputs[pos.direction] || ''} onChange={e => setSellInputs(prev => ({ ...prev, [pos.direction]: e.target.value }))}
                  placeholder="shares" style={{ ...inputStyle, width: '70px' }} min="0.000001" max={pos.shares} step="any" />
              </div>
              <button className="btn-small" disabled={trading || !sellInputs[pos.direction]} onClick={() => handleSell(pos.direction)}
                style={{ padding: '0.5rem 0.75rem', background: 'var(--text-secondary)', color: '#fff' }}>
                {trading ? '…' : 'Sell'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
