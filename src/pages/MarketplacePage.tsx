import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type MarketplaceListing } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { DarkModeToggle } from '../components/DarkModeToggle';


function JoinButton({ workspaceId }: { workspaceId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'joining' | 'joined' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const handleJoin = async () => {
    if (!user) { navigate('/signup'); return; }
    setState('joining');
    try {
      await api.joinWorkspace(user, workspaceId);
      setState('joined');
    } catch (e: unknown) {
      setErrMsg((e as Error).message || 'Failed to join');
      setState('error');
    }
  };

  if (state === 'joined') return <span style={{ color: 'var(--success-text)', fontSize: '0.875rem' }}>✓ Joined</span>;
  if (state === 'error') return <span style={{ color: 'var(--error-text)', fontSize: '0.8rem' }}>{errMsg}</span>;

  return (
    <button
      onClick={handleJoin}
      disabled={state === 'joining'}
      style={{ padding: '0.35rem 0.85rem', fontSize: '0.875rem' }}
    >
      {state === 'joining' ? 'Joining...' : 'Join workspace'}
    </button>
  );
}

function ProbabilityBar({ probability }: { probability: number }) {
  const pct = Math.round(probability * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
      <div style={{
        flex: 1, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: pct > 50 ? 'var(--success-text)' : 'var(--error-text)',
          borderRadius: 3, transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: 32, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  );
}

function MarketCard({ market }: { market: MarketplaceListing }) {
  const consensusDisplay = market.consensus !== null
    ? `${market.consensus.toFixed(2)} (of ${market.rangeMin}–${market.rangeMax})`
    : '—';

  return (
    <div className="metric-card" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.15rem' }}>
            {market.metricName}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {market.workspaceName} · {market.targetDate}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Consensus</div>
          <div style={{ fontWeight: 600 }}>{consensusDisplay}</div>
        </div>
      </div>
      <ProbabilityBar probability={market.probability} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
        <span>Liquidity: {market.liquidity.toFixed(0)}</span>
        <JoinButton workspaceId={market.workspaceId} />
      </div>
    </div>
  );
}

export function MarketplacePage() {
  useDarkMode();
  const { user } = useAuth();

  const [markets, setMarkets] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.getMarketplace()
      .then(setMarkets)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? markets.filter(m =>
        m.metricName.toLowerCase().includes(search.toLowerCase()) ||
        m.workspaceName.toLowerCase().includes(search.toLowerCase()),
      )
    : markets;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <DarkModeToggle fixed />

      {!user && (
        <nav style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingBottom: '1.25rem', borderBottom: '1px solid var(--border-color)',
          marginBottom: '2rem',
        }}>
          <Link to="/" style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.02em', textDecoration: 'none', color: 'var(--text-primary)' }}>
            Telarchy
          </Link>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Link to="/login" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem' }}>Log in</Link>
            <Link to="/signup" style={{
              background: 'var(--button-bg)', color: 'var(--button-text)',
              padding: '0.4rem 1rem', borderRadius: '0.375rem',
              textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500,
            }}>
              Sign up
            </Link>
          </div>
        </nav>
      )}

      <div style={{ maxWidth: 720, margin: '0 auto', width: '100%', flex: 1 }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginBottom: '0.25rem' }}>Public markets</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Browse prediction markets from public workspaces. Join a workspace to place trades.
          </p>
        </div>

        <div className="form-group" style={{ marginBottom: '1rem' }}>
          <input
            type="search"
            placeholder="Search metrics or workspaces..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading && <div className="loading" style={{ padding: '2rem 0' }}>Loading markets...</div>}
        {error && <div className="error show">{error}</div>}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '3rem 0' }}>
            {search ? 'No markets match your search.' : 'No public markets yet.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtered.map(m => (
            <MarketCard key={`${m.workspaceId}:${m.marketId}`} market={m} />
          ))}
        </div>

        {!user && filtered.length > 0 && (
          <div style={{
            marginTop: '2rem', padding: '1.25rem',
            background: 'var(--focus-bg)', border: '1px solid var(--focus-border)',
            borderRadius: '0.5rem', textAlign: 'center',
          }}>
            <p style={{ marginBottom: '0.75rem' }}>
              <strong>Want to trade on these markets?</strong><br />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Create a free account or log in to join workspaces and place trades.
              </span>
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <Link to="/signup" style={{
                background: 'var(--button-bg)', color: 'var(--button-text)',
                padding: '0.5rem 1.1rem', borderRadius: '0.375rem',
                textDecoration: 'none', fontWeight: 500, fontSize: '0.875rem',
              }}>Create account</Link>
              <Link to="/login" style={{
                background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                padding: '0.5rem 1.1rem', borderRadius: '0.375rem',
                textDecoration: 'none', fontWeight: 500, fontSize: '0.875rem',
              }}>Log in</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
