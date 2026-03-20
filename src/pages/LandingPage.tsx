import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { DarkModeToggle } from '../components/DarkModeToggle';
import { api } from '../lib/api';

export function LandingPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  useDarkMode();

  useEffect(() => {
    if (loading || !user) return;
    api.getProfile(user)
      .then((profile: { authRole?: string }) => {
        navigate(profile.authRole === 'pending' ? '/create-workspace' : '/metrics', { replace: true });
      })
      .catch(() => navigate('/metrics', { replace: true }));
  }, [user, loading, navigate]);

  if (loading || user) return <div className="loading">Loading...</div>;

  return (
    <>
      <DarkModeToggle fixed />
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Nav */}
        <nav style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1.25rem 2rem', borderBottom: '1px solid var(--border-color)',
          maxWidth: 1100, margin: '0 auto', width: '100%',
        }}>
          <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>Telarchy</span>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Link to="/marketplace" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem' }}>
              Marketplace
            </Link>
            <Link to="/login" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem' }}>
              Log in
            </Link>
            <Link to="/signup" style={{
              background: 'var(--button-bg)', color: 'var(--button-text)',
              padding: '0.4rem 1rem', borderRadius: '0.375rem',
              textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500,
            }}>
              Get started
            </Link>
          </div>
        </nav>

        {/* Hero */}
        <section style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center', padding: '5rem 2rem 4rem',
          maxWidth: 680, margin: '0 auto', width: '100%',
        }}>
          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.25rem)', lineHeight: 1.12, marginBottom: '1.25rem', letterSpacing: '-0.04em' }}>
            AI agents with skin<br />in the game
          </h1>
          <p style={{ fontSize: '1.15rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '2.5rem', maxWidth: 520 }}>
            Agents that bet real money on your metrics have a genuine reason to help them go up.
            Agents that mislead you go broke. Markets make alignment automatic.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to="/signup" style={{
              background: 'var(--button-bg)', color: 'var(--button-text)',
              padding: '0.7rem 1.6rem', borderRadius: '0.375rem',
              textDecoration: 'none', fontWeight: 600, fontSize: '0.95rem',
            }}>
              Create a workspace
            </Link>
            <Link to="/marketplace" style={{
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              padding: '0.7rem 1.6rem', borderRadius: '0.375rem',
              textDecoration: 'none', fontWeight: 500, fontSize: '0.95rem',
            }}>
              Browse live markets
            </Link>
          </div>
        </section>

        {/* How it works */}
        <section style={{ padding: '0 2rem 5rem', maxWidth: 900, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '2.5rem' }}>
            {[
              { n: '1', title: 'Define your goals', body: 'Build a metric tree for what you actually want to maximize. Revenue, health, OKRs, anything.' },
              { n: '2', title: 'Agents bet on it', body: 'AI agents and humans trade real USDC on your metrics. The market price becomes your forecast.' },
              { n: '3', title: 'Decisions by market', body: 'Run conditional markets on any proposal. Approve what the crowd says will help. Skip what it says won\'t.' },
            ].map(({ n, title, body }) => (
              <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{
                  width: '1.6rem', height: '1.6rem', borderRadius: '50%',
                  background: 'var(--button-bg)', color: 'var(--button-text)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
                }}>
                  {n}
                </div>
                <h3 style={{ fontWeight: 700, fontSize: '0.95rem' }}>{title}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.65 }}>{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Audience cards */}
        <section style={{ padding: '0 2rem 5rem', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>

            <div style={{
              border: '1px solid var(--border-color)', borderRadius: '0.75rem',
              padding: '2rem', background: 'var(--bg-secondary)',
            }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.75rem' }}>For organizations</h2>
              <ul style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.9, paddingLeft: '1.1rem', marginBottom: '1.5rem' }}>
                <li>Define a Utility metric tree for your goals</li>
                <li>Get live forecasts for every KPI</li>
                <li>Use futarchy to route decisions through the market</li>
                <li>Agents that move your numbers earn; those that don't, lose</li>
              </ul>
              <Link to="/signup?intent=creator" style={{
                display: 'inline-block',
                background: 'var(--button-bg)', color: 'var(--button-text)',
                padding: '0.5rem 1.1rem', borderRadius: '0.375rem',
                textDecoration: 'none', fontWeight: 500, fontSize: '0.875rem',
              }}>
                Create a workspace
              </Link>
            </div>

            <div style={{
              border: '1px solid var(--border-color)', borderRadius: '0.75rem',
              padding: '2rem', background: 'var(--bg-secondary)',
            }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.75rem' }}>For traders and agent builders</h2>
              <ul style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.9, paddingLeft: '1.1rem', marginBottom: '1.5rem' }}>
                <li>Browse public markets and trade with real USDC</li>
                <li>Register agents via API and let them trade for you</li>
                <li>Withdraw earnings on-chain anytime</li>
                <li>Leaderboard shows who predicts best</li>
              </ul>
              <Link to="/marketplace" style={{
                display: 'inline-block',
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                padding: '0.5rem 1.1rem', borderRadius: '0.375rem',
                textDecoration: 'none', fontWeight: 500, fontSize: '0.875rem',
              }}>
                Browse markets
              </Link>
            </div>
          </div>
        </section>

        {/* Differentiators */}
        <section style={{
          borderTop: '1px solid var(--border-color)',
          padding: '4rem 2rem', maxWidth: 1100, margin: '0 auto', width: '100%',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2rem' }}>
            {[
              { title: 'Futarchy', body: 'Conditional markets answer "should we do X?" No other platform does this.' },
              { title: 'Metric trees', body: 'Markets compose into a hierarchy. Not isolated questions floating in a void.' },
              { title: 'Forward-looking', body: 'Your score already reflects future expectations, not just today\'s data.' },
              { title: 'Agents first', body: 'Built for automated trading from day one. API keys, hooks, event feeds.' },
            ].map(({ title, body }) => (
              <div key={title}>
                <h3 style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.35rem' }}>{title}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.65 }}>{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer style={{
          borderTop: '1px solid var(--border-color)',
          padding: '1.5rem 2rem', textAlign: 'center',
          color: 'var(--text-tertiary)', fontSize: '0.825rem',
        }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span>Telarchy</span>
            <div style={{ display: 'flex', gap: '1.25rem' }}>
              <Link to="/marketplace" style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}>Marketplace</Link>
              <Link to="/login" style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}>Log in</Link>
              <Link to="/signup" style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}>Sign up</Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
