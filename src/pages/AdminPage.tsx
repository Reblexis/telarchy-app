import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

/**
 * /admin, cut to what the launch needs (owner direction 2026-08-11:
 * "just the signups and the waitlist, that's it"). The old console
 * surfaces (treasury, agent telemetry, feedback inbox, activity feed)
 * were pre-launch noise and are gone from this page; the components
 * remain in the tree for the day a real console returns.
 */

interface FloorStats {
  signupsByDay: Array<{ day: string; signups: number }>;
  recentSignups: Array<{ email: string; name: string; createdAt: string }>;
  totalUsers: number;
  waitlist: Array<{ email: string; createdAt: string }>;
}

const label = { fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' } as const;
const mono = { fontFamily: 'monospace', fontSize: '0.8rem' } as const;
const cell = { padding: '0.18rem 1rem 0.18rem 0', verticalAlign: 'top' } as const;

export function AdminPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<FloorStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    api.getFloorStats()
      .then(s => setStats(s as FloorStats))
      .catch(e => setError((e as Error).message || 'Could not load stats'));
  }, [user]);

  return (
    <>
      <Header navMode="platform" />
      <div className="container">
        <h1 style={{ marginBottom: '1.5rem', fontSize: '1.3rem', fontWeight: 700 }}>
          Signups
          {stats && (
            <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '0.6rem' }}>
              {stats.totalUsers} accounts total
            </span>
          )}
        </h1>

        {error && <div className="error show" style={{ marginBottom: '1rem' }}>{error}</div>}
        {!stats && !error && <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>}

        {stats && (
          <div style={{ display: 'flex', gap: '3rem', flexWrap: 'wrap' }}>
            <div className="section">
              <div style={label}>By day (14d)</div>
              <table style={mono}><tbody>
                {stats.signupsByDay.map(v => (
                  <tr key={v.day}><td style={cell}>{v.day}</td><td style={cell}>{v.signups}</td></tr>
                ))}
                {stats.signupsByDay.length === 0 && <tr><td style={cell}>none yet</td></tr>}
              </tbody></table>
            </div>

            <div className="section">
              <div style={label}>Recent signups</div>
              <table style={mono}><tbody>
                {stats.recentSignups.map(s => (
                  <tr key={s.email}>
                    <td style={cell}>{s.createdAt?.slice(0, 10)}</td>
                    <td style={cell}>{s.email}</td>
                    <td style={cell}>{s.name}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>

            <div className="section">
              <div style={label}>Waitlist ({stats.waitlist.length})</div>
              <table style={mono}><tbody>
                {stats.waitlist.map(w => (
                  <tr key={w.email}>
                    <td style={cell}>{w.createdAt?.slice(0, 10)}</td>
                    <td style={cell}>{w.email}</td>
                  </tr>
                ))}
                {stats.waitlist.length === 0 && <tr><td style={cell}>empty</td></tr>}
              </tbody></table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
