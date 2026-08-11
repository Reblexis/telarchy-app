import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * The launch dashboard on /admin (owner ask 2026-08-11): who visited the
 * public floor, who signed up, who left an email. Server-side visit log
 * (30-day window), auth accounts, and the waitlist, side by side.
 */

interface FloorStats {
  visitsByDay: Array<{ day: string; visits: number; uniques: number }>;
  topPaths: Array<{ path: string; visits: number }>;
  topReferers: Array<{ referer: string | null; visits: number }>;
  signupsByDay: Array<{ day: string; signups: number }>;
  recentSignups: Array<{ email: string; name: string; createdAt: string }>;
  totalUsers: number;
  waitlist: Array<{ email: string; createdAt: string }>;
}

const label = { fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' } as const;
const mono = { fontFamily: 'monospace', fontSize: '0.78rem' } as const;
const cell = { padding: '0.15rem 0.8rem 0.15rem 0', verticalAlign: 'top' } as const;

export function FloorStatsPanel() {
  const [stats, setStats] = useState<FloorStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getFloorStats()
      .then(s => setStats(s as FloorStats))
      .catch(e => setError((e as Error).message || 'Could not load floor stats'));
  }, []);

  if (error) return <div className="section" style={{ marginBottom: '1.5rem' }}><div className="error show">{error}</div></div>;
  if (!stats) return null;

  return (
    <div className="section" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
        Floor traffic &amp; signups
        <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--text-secondary)', marginLeft: '0.6rem' }}>
          {stats.totalUsers} accounts total
        </span>
      </h2>
      <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap' }}>
        <div>
          <div style={label}>Visits by day (14d, document loads / unique IPs)</div>
          <table style={mono}><tbody>
            {stats.visitsByDay.map(v => (
              <tr key={v.day}><td style={cell}>{v.day}</td><td style={cell}>{v.visits}</td><td style={cell}>{v.uniques} uniq</td></tr>
            ))}
            {stats.visitsByDay.length === 0 && <tr><td style={cell}>no visits logged yet</td></tr>}
          </tbody></table>
        </div>
        <div>
          <div style={label}>Signups by day (14d)</div>
          <table style={mono}><tbody>
            {stats.signupsByDay.map(v => (
              <tr key={v.day}><td style={cell}>{v.day}</td><td style={cell}>{v.signups}</td></tr>
            ))}
            {stats.signupsByDay.length === 0 && <tr><td style={cell}>none</td></tr>}
          </tbody></table>
        </div>
        <div>
          <div style={label}>Top referers (14d)</div>
          <table style={mono}><tbody>
            {stats.topReferers.map(r => (
              <tr key={r.referer ?? ''}><td style={{ ...cell, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.referer}</td><td style={cell}>{r.visits}</td></tr>
            ))}
            {stats.topReferers.length === 0 && <tr><td style={cell}>direct only so far</td></tr>}
          </tbody></table>
        </div>
        <div>
          <div style={label}>Top paths (14d)</div>
          <table style={mono}><tbody>
            {stats.topPaths.map(p => (
              <tr key={p.path}><td style={cell}>{p.path}</td><td style={cell}>{p.visits}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div>
          <div style={label}>Recent signups</div>
          <table style={mono}><tbody>
            {stats.recentSignups.map(s => (
              <tr key={s.email}><td style={cell}>{s.createdAt?.slice(0, 10)}</td><td style={cell}>{s.email}</td><td style={cell}>{s.name}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div>
          <div style={label}>Waitlist ({stats.waitlist.length})</div>
          <table style={mono}><tbody>
            {stats.waitlist.map(w => (
              <tr key={w.email}><td style={cell}>{w.createdAt?.slice(0, 10)}</td><td style={cell}>{w.email}</td></tr>
            ))}
            {stats.waitlist.length === 0 && <tr><td style={cell}>empty</td></tr>}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}
