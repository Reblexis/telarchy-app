import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { previewTrade } from '../lib/amm';
import { MarketActivityPanel } from './MarketActivityPanel';
import type { Market, Position, LiquidityEvent } from '../types';

const inputStyle = { width: '80px', height: '30px', fontSize: '0.85rem' } as const;
const labelStyle = { display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' } as const;

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
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
  const [positions, setPositions] = useState<Position[]>([]);
  const [sellInputs, setSellInputs] = useState<Record<string, string>>({});
  const [activityRefreshToken, setActivityRefreshToken] = useState(0);

  useEffect(() => {
    const pKey = `positions:${market.id}:me`;
    const cachedPositions = cacheGet<Position[]>(pKey);

    if (cachedPositions) setPositions(cachedPositions);

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

  const refreshTrades = () => api.getMarketTrades(market.id, workspaceId).then(data => {
    cacheSet(`trades:${market.id}`, data);
    setActivityRefreshToken(token => token + 1);
  }).catch((e: Error) => onError(`Failed to refresh trades: ${e.message}`));

  const refreshLiquidityEvents = () => api.getMarketLiquidityEvents(market.id, workspaceId).then(data => {
    cacheSet(`liqEvents:${market.id}`, data);
    setActivityRefreshToken(token => token + 1);
  }).catch((e: Error) => onError(`Failed to refresh liquidity events: ${e.message}`));

  const handleBetDirection = async (direction: 'higher' | 'lower') => {
    if (isNaN(amount) || amount <= 0) return;
    setTrading(true);
    const result = await api.trade({ marketId: market.id, direction, amount }, workspaceId)
      .catch((e: Error) => { onError(e.message); return null; });
    setTrading(false);
    if (result) {
      setLastResult({ direction, shares: result.shares, cost: result.cost, consensus: result.consensus });
      setTradeAmount('');
      void refreshTrades();
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
      void refreshTrades();
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
      cacheSet(`liqEvents:${market.id}`, [...cacheGet<LiquidityEvent[]>(`liqEvents:${market.id}`) || [], optimistic]);
      void refreshLiquidityEvents();
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
      <MarketActivityPanel
        market={market}
        workspaceId={workspaceId}
        onError={onError}
        refreshToken={activityRefreshToken}
      />

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Amount ($)</label>
          <input type="number" value={tradeAmount} onChange={e => setTradeAmount(e.target.value)} placeholder="0.01" style={{ ...inputStyle, width: '90px' }} min="0.000001" step="any" />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
              {preview ? `~${formatCompactNumber(previewShares('lower'))} shares → ${formatCompactNumber(previewConsensus('lower'))}` : '\u00a0'}
            </div>
            <button className="btn-small" disabled={trading || !tradeAmount} onClick={() => handleBetDirection('lower')}
              style={{ background: 'var(--error-text)', color: '#fff', borderColor: 'var(--error-text)', height: '30px', padding: '0 0.85rem', fontSize: '0.8rem', fontWeight: 600 }}>
              {trading ? '…' : '▼ Lower'}
            </button>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
              {preview ? `~${formatCompactNumber(previewShares('higher'))} shares → ${formatCompactNumber(previewConsensus('higher'))}` : '\u00a0'}
            </div>
            <button className="btn-small" disabled={trading || !tradeAmount} onClick={() => handleBetDirection('higher')}
              style={{ background: 'var(--success-text)', color: '#fff', borderColor: 'var(--success-text)', height: '30px', padding: '0 0.85rem', fontSize: '0.8rem', fontWeight: 600 }}>
              {trading ? '…' : '▲ Higher'}
            </button>
          </div>
        </div>
        {lastResult && (
          <div style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', borderLeft: `3px solid ${lastResult.direction === 'higher' ? 'var(--success-text)' : 'var(--error-text)'}` }}>
            <strong>{lastResult.direction === 'higher' ? '▲' : '▼'} {formatCompactNumber(lastResult.shares)} shares</strong>
            {' '}{lastResult.cost < 0 ? `sold for $${formatCompactNumber(-lastResult.cost)}` : `for $${formatCompactNumber(lastResult.cost)}`} → consensus <strong>{formatCompactNumber(lastResult.consensus)}</strong>
          </div>
        )}
        {showLiquidityControls && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>Add liquidity (b={market.liquidity})</label>
              <input type="number" value={liqAmount} onChange={e => setLiqAmount(e.target.value)} placeholder="+" style={{ ...inputStyle, width: '60px' }} min="0.000001" step="any" />
            </div>
            <button className="btn-small" onClick={handleLiquidity}>Inject</button>
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
                style={{ background: 'var(--text-secondary)', color: '#fff', borderColor: 'var(--text-secondary)' }}>
                {trading ? '…' : 'Sell'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
