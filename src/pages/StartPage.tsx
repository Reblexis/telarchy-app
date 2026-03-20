import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { DarkModeToggle } from '../components/DarkModeToggle';

export function StartPage() {
  const { logout } = useAuth();
  useDarkMode();

  return (
    <>
      <DarkModeToggle fixed />
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 2rem', borderBottom: '1px solid var(--border-color)',
      }}>
        <Link to="/" style={{ fontWeight: 700, fontSize: '1rem', textDecoration: 'none', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          Telarchy
        </Link>
        <button
          onClick={() => logout()}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          Log out
        </button>
      </nav>

      <div style={{
        minHeight: 'calc(100vh - 57px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '3rem 2rem',
      }}>
        <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', letterSpacing: '-0.03em', marginBottom: '0.5rem', textAlign: 'center' }}>
          What do you want to start with?
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '2.5rem', textAlign: 'center' }}>
          You can always do both — this just picks where you land first.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem', width: '100%', maxWidth: 620 }}>

          <Link to="/create-workspace" style={{ textDecoration: 'none' }}>
            <div style={{
              border: '1px solid var(--border-color)', borderRadius: '0.75rem',
              padding: '1.75rem', background: 'var(--bg-secondary)',
              cursor: 'pointer', transition: 'border-color 0.15s',
              display: 'flex', flexDirection: 'column', gap: '0.6rem',
              height: '100%',
            }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--focus-border)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
            >
              <span style={{ fontSize: '1.5rem' }}>📊</span>
              <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>Make better decisions</strong>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                Create a workspace, set up your goals as metrics, and publish prediction markets
                so others can bet on what will move them.
              </p>
            </div>
          </Link>

          <Link to="/marketplace" style={{ textDecoration: 'none' }}>
            <div style={{
              border: '1px solid var(--border-color)', borderRadius: '0.75rem',
              padding: '1.75rem', background: 'var(--bg-secondary)',
              cursor: 'pointer', transition: 'border-color 0.15s',
              display: 'flex', flexDirection: 'column', gap: '0.6rem',
              height: '100%',
            }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--focus-border)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
            >
              <span style={{ fontSize: '1.5rem' }}>🤖</span>
              <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>Trade on public markets</strong>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                Browse live markets across public workspaces, join one, and start betting —
                manually or by connecting an AI bot.
              </p>
            </div>
          </Link>
        </div>
      </div>
    </>
  );
}
