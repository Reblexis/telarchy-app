import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { previewTrade, previewTargetBet } from '../lib/amm';
import { MarketActivityPanel } from './MarketActivityPanel';
import type { Market, Position, LiquidityEvent } from '../types';

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(4).replace(/\.?0+$/, '');
  if (abs >= 0.01) return value.toFixed(6).replace(/\.?0+$/, '');
  return value.toFixed(9).replace(/\.?0+$/, '');
}

export function TradingPanel({ market, workspaceId, showLiquidityControls = true, metricValue, onTrade, onError }: {
  market: Market; workspaceId?: string; showLiquidityControls?: boolean;
  metricValue?: number | null;
  onTrade: () => void; onError: (msg: string) => void;
}) {
  const [tradeAmount, setTradeAmount] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [targetBudget, setTargetBudget] = useState('');
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

  const targetVal = parseFloat(targetValue);
  const targetBud = parseFloat(targetBudget);
  const targetPreview = useMemo(() => {
    if (isNaN(targetVal) || isNaN(targetBud) || targetBud <= 0 || market.probability == null) return null;
    return previewTargetBet(market.probability, market.liquidity, market.rangeMin, market.rangeMax, targetVal, targetBud);
  }, [targetVal, targetBud, market.probability, market.liquidity, market.rangeMin, market.rangeMax]);

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

  const handleBetToward = async () => {
    if (isNaN(targetVal) || isNaN(targetBud) || targetBud <= 0) return;
    setTrading(true);
    const result = await api.trade({ marketId: market.id, targetValue: targetVal, maxBudget: targetBud }, workspaceId)
      .catch((e: Error) => { onError(e.message); return null; });
    setTrading(false);
    if (result) {
      setLastResult({ direction: result.direction, shares: result.shares, cost: result.cost, consensus: result.consensus });
      setTargetValue('');
      setTargetBudget('');
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
  const targetConsensus = targetPreview ? market.rangeMin + targetPreview.newProb * (market.rangeMax - market.rangeMin) : null;

  return (
    <div className="trade-panel">
      <MarketActivityPanel
        market={market}
        workspaceId={workspaceId}
        onError={onError}
        refreshToken={activityRefreshToken}
        metricValue={metricValue}
      />

      {market.status === 'closed' && (
        <div className="trade-note">
          This market is closed: trading is paused until it resolves at the target date. You can still sell positions you already hold below.
        </div>
      )}

      {market.status === 'resolved' && (
        <div className="trade-note">
          {`Resolved at ${market.actualValue?.toFixed(2) ?? 'N/A'}${market.resolvedAt ? ` on ${new Date(market.resolvedAt).toLocaleDateString()}` : ''}.`}
        </div>
      )}

      {market.status === 'voided' && (
        <div className="trade-note">
          This market was cancelled. All positions were refunded at cost.
        </div>
      )}

      {market.status === 'open' && (
        <div className="trade-form">
          <div className="trade-form-label">Place a trade</div>

          <div className="trade-buy">
            <div className="trade-field">
              <label>Amount to spend</label>
              <div className="trade-money">
                <span className="trade-money-sign">$</span>
                <input type="number" className="trade-money-input" value={tradeAmount}
                  onChange={e => setTradeAmount(e.target.value)} placeholder="0.00" min="0.000001" step="any" />
              </div>
            </div>

            <div className="trade-dirs">
              <button type="button" className="trade-dir trade-dir-lower" disabled={trading || !tradeAmount}
                onClick={() => handleBetDirection('lower')}>
                <span className="trade-dir-name">{trading ? '…' : '▼ Lower'}</span>
                <span className="trade-dir-sub">
                  {preview ? `${formatCompactNumber(previewShares('lower'))} sh → ${formatCompactNumber(previewConsensus('lower'))}` : 'value ends lower'}
                </span>
              </button>
              <button type="button" className="trade-dir trade-dir-higher" disabled={trading || !tradeAmount}
                onClick={() => handleBetDirection('higher')}>
                <span className="trade-dir-name">{trading ? '…' : '▲ Higher'}</span>
                <span className="trade-dir-sub">
                  {preview ? `${formatCompactNumber(previewShares('higher'))} sh → ${formatCompactNumber(previewConsensus('higher'))}` : 'value ends higher'}
                </span>
              </button>
            </div>
          </div>

          <div className="trade-toward">
            <div className="trade-toward-head">or aim for a value</div>
            <div className="trade-toward-controls">
              <div className="trade-field">
                <label>Target value</label>
                <input type="number" className="trade-input" value={targetValue}
                  onChange={e => setTargetValue(e.target.value)} placeholder={`${market.rangeMin} to ${market.rangeMax}`}
                  min={market.rangeMin} max={market.rangeMax} step="any" />
              </div>
              <div className="trade-field">
                <label>Max budget</label>
                <div className="trade-money">
                  <span className="trade-money-sign">$</span>
                  <input type="number" className="trade-money-input" value={targetBudget}
                    onChange={e => setTargetBudget(e.target.value)} placeholder="0.00" min="0.000001" step="any" />
                </div>
              </div>
              <button type="button" className="btn-small trade-toward-btn"
                disabled={trading || !targetValue || !targetBudget} onClick={handleBetToward}>
                {trading ? '…' : 'Bet toward'}
              </button>
            </div>
            <div className="trade-toward-preview">
              {targetPreview
                ? `${targetPreview.direction === 'higher' ? '▲' : '▼'} ${formatCompactNumber(targetPreview.shares)} sh → ${formatCompactNumber(targetConsensus)} · costs $${formatCompactNumber(targetPreview.cost)}`
                : ' '}
            </div>
          </div>

          {lastResult && (
            <div className={`trade-result ${lastResult.direction === 'higher' ? 'pos' : 'neg'}`}>
              <strong>{lastResult.direction === 'higher' ? '▲' : '▼'} {formatCompactNumber(lastResult.shares)} shares</strong>
              {' '}{lastResult.cost < 0 ? `sold for $${formatCompactNumber(-lastResult.cost)}` : `for $${formatCompactNumber(lastResult.cost)}`} → consensus <strong>{formatCompactNumber(lastResult.consensus)}</strong>
            </div>
          )}

          {showLiquidityControls && (
            <div className="trade-liquidity">
              <label>Add liquidity (b={market.liquidity})</label>
              <div className="trade-money">
                <span className="trade-money-sign">$</span>
                <input type="number" className="trade-money-input" value={liqAmount}
                  onChange={e => setLiqAmount(e.target.value)} placeholder="0.00" min="0.000001" step="any" />
              </div>
              <button type="button" className="btn-small" onClick={handleLiquidity}>Inject</button>
            </div>
          )}
        </div>
      )}

      {(market.status === 'open' || market.status === 'closed') && positions.length > 0 && (
        <div className="trade-sell">
          <div className="trade-sell-head">Your position</div>
          {positions.map(pos => (
            <div key={pos.direction} className="trade-sell-row">
              <span className="trade-sell-side">{pos.direction === 'higher' ? '▲' : '▼'} {formatCompactNumber(pos.shares)} shares</span>
              <input type="number" className="trade-input trade-input-sm" value={sellInputs[pos.direction] || ''}
                onChange={e => setSellInputs(prev => ({ ...prev, [pos.direction]: e.target.value }))}
                placeholder="shares to sell" min="0.000001" max={pos.shares} step="any" />
              <button type="button" className="btn-small trade-sell-btn" disabled={trading || !sellInputs[pos.direction]}
                onClick={() => handleSell(pos.direction)}>
                {trading ? '…' : 'Sell'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
