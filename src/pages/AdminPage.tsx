import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

/**
 * /admin: the launch cockpit (owner direction 2026-08-11). Who showed up
 * (human traffic, bot-filtered), where they came from (referer by domain,
 * the channel that is working), who signed up, and the waitlist. The old
 * console surfaces (treasury, telemetry, feedback, activity) are gone;
 * their components stay in the tree for a future console.
 */

interface FloorStats {
  visits24h: number;
  uniques24h: number;
  botVisits: number;
  visitsByDay: Array<{ day: string; visits: number; uniques: number }>;
  topReferers: Array<{ source: string; visits: number }>;
  topPaths: Array<{ path: string; visits: number }>;
  signupsByDay: Array<{ day: string; signups: number }>;
  recentSignups: Array<{ email: string; name: string; createdAt: string }>;
  totalUsers: number;
  waitlist: Array<{ email: string; createdAt: string }>;
}

const label = { fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: '0.5rem' } as const;
const mono = { fontFamily: 'monospace', fontSize: '0.8rem', borderCollapse: 'collapse' } as const;
const cell = { padding: '0.18rem 1rem 0.18rem 0', verticalAlign: 'top', whiteSpace: 'nowrap' } as const;
const num = { ...cell, textAlign: 'right', color: 'var(--text-secondary)' } as const;

function Big({ v, l }: { v: number | string; l: string }) {
  return (
    <div>
      <div style={{ fontSize: '1.9rem', fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.1 }}>{v}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
    </div>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<FloorStats | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    api.getFloorStats()
      .then(s => setStats(s as FloorStats))
      .catch(e => setError((e as Error).message || 'Could not load stats'));
  };
  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);
  // Live-ish: refresh every 20s so the cockpit tracks a launch as it happens.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <>
      <Header navMode="platform" />
      <div className="container">
        <h1 style={{ marginBottom: '1.25rem', fontSize: '1.3rem', fontWeight: 700 }}>Floor</h1>

        {error && <div className="error show" style={{ marginBottom: '1rem' }}>{error}</div>}
        {!stats && !error && <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>}

        {stats && (
          <>
            {/* The glance: last 24h of human traffic, plus totals. */}
            <div className="section" style={{ marginBottom: '1.5rem', display: 'flex', gap: '2.5rem', flexWrap: 'wrap' }}>
              <Big v={stats.visits24h} l="visits · 24h" />
              <Big v={stats.uniques24h} l="unique visitors · 24h" />
              <Big v={stats.totalUsers} l="accounts total" />
              <Big v={stats.waitlist.length} l="waitlist" />
              <Big v={stats.botVisits} l="bot hits · 14d (filtered out)" />
            </div>

            <div style={{ display: 'flex', gap: '3rem', flexWrap: 'wrap' }}>
              <div className="section">
                <div style={label}>Where they came from (14d)</div>
                <table style={mono}><tbody>
                  {stats.topReferers.map(r => (
                    <tr key={r.source}><td style={cell}>{r.source}</td><td style={num}>{r.visits}</td></tr>
                  ))}
                  {stats.topReferers.length === 0 && <tr><td style={cell}>no human visits yet</td></tr>}
                </tbody></table>
              </div>

              <div className="section">
                <div style={label}>Visits by day (14d) · visits / unique</div>
                <table style={mono}><tbody>
                  {stats.visitsByDay.map(v => (
                    <tr key={v.day}><td style={cell}>{v.day}</td><td style={num}>{v.visits}</td><td style={num}>{v.uniques} uniq</td></tr>
                  ))}
                  {stats.visitsByDay.length === 0 && <tr><td style={cell}>none yet</td></tr>}
                </tbody></table>
              </div>

              <div className="section">
                <div style={label}>Top pages (14d)</div>
                <table style={mono}><tbody>
                  {stats.topPaths.map(p => (
                    <tr key={p.path}><td style={cell}>{p.path}</td><td style={num}>{p.visits}</td></tr>
                  ))}
                </tbody></table>
              </div>
            </div>

            <h2 style={{ margin: '2rem 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Signups &amp; waitlist</h2>
            <div style={{ display: 'flex', gap: '3rem', flexWrap: 'wrap' }}>
              <div className="section">
                <div style={label}>Signups by day (14d)</div>
                <table style={mono}><tbody>
                  {stats.signupsByDay.map(v => (
                    <tr key={v.day}><td style={cell}>{v.day}</td><td style={num}>{v.signups}</td></tr>
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
          </>
        )}
      </div>
    </>
  );
}
