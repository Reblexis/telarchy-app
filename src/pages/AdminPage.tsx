import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { api, type FeedbackItem } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

/**
 * /admin: the launch cockpit (owner direction 2026-08-11). Who showed up
 * (human traffic, bot-filtered), where they came from (referer by domain,
 * the channel that is working), who signed up, the waitlist with the door
 * each signup came through, and what people reported (owner ask
 * 2026-08-15). The old console surfaces (treasury, telemetry, activity) are
 * gone; their components stay in the tree for a future console.
 *
 * Everything here is something the owner acts on by hand, so nothing is
 * summarised away: the waitlist is people waiting for a reply, and a report
 * is someone who hit a wall and took the trouble to say so.
 */

interface FloorStats {
  visits24h: number;
  uniques24h: number;
  botVisits: number;
  visitsByDay: Array<{ day: string; visits: number; uniques: number }>;
  topReferers: Array<{ source: string; visits: number }>;
  topPaths: Array<{ path: string; visits: number }>;
  topCountries: Array<{ country: string; visits: number; uniques: number }>;
  recentVisitors: Array<{ ip: string; country: string; visits: number; lastSeen: string; kind: 'person' | 'server' | 'proxy' | 'unknown'; org: string }>;
  visitorSummary: { people: number; servers: number; proxies: number };
  signupsByDay: Array<{ day: string; signups: number }>;
  recentSignups: Array<{ email: string; name: string; createdAt: string }>;
  totalUsers: number;
  /** Every signup, newest first. `source` is the door they came through:
   *  'marketplace' for the listing tile, a workspace slug for that floor's
   *  own email box, null for rows written before it was recorded. */
  waitlist: Array<{ email: string; createdAt: string; source: string | null }>;
}

const label = { fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: '0.5rem' } as const;
const mono = { fontFamily: 'monospace', fontSize: '0.8rem', borderCollapse: 'collapse' } as const;
const cell = { padding: '0.18rem 1rem 0.18rem 0', verticalAlign: 'top', whiteSpace: 'nowrap' } as const;
const num = { ...cell, textAlign: 'right', color: 'var(--text-secondary)' } as const;

// ISO alpha-2 -> "flag + English name" for the traffic-by-country view.
// '??' is the unknown/private-IP bucket from the backend.
function countryLabel(code: string): string {
  if (!code || code === '??') return 'unknown';
  const flag = code.toUpperCase().replace(/[A-Z]/g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
  let name = code;
  try { name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { /* older runtime */ }
  return `${flag} ${name}`;
}

// person vs server/bot label for the visitor-IP table, by IP type.
function kindTag(kind: 'person' | 'server' | 'proxy' | 'unknown') {
  const map = {
    person: { t: 'person', c: 'var(--success, #16a34a)' },
    server: { t: 'server/bot', c: 'var(--danger, #dc2626)' },
    proxy: { t: 'proxy/VPN', c: 'var(--warning, #d97706)' },
    unknown: { t: '?', c: 'var(--text-tertiary)' },
  } as const;
  const { t, c } = map[kind];
  return <span style={{ color: c, fontWeight: 600 }}>{t}</span>;
}

function Big({ v, l }: { v: number | string; l: string }) {
  return (
    <div>
      <div style={{ fontSize: '1.9rem', fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.1 }}>{v}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
    </div>
  );
}

const KIND_COLOR: Record<string, string> = {
  bug: 'var(--danger, #dc2626)',
  help: 'var(--warning, #d97706)',
  feedback: 'var(--text-secondary)',
};

export function AdminPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<FloorStats | null>(null);
  const [reports, setReports] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    api.getFloorStats()
      .then(s => setStats(s as FloorStats))
      .catch(e => setError((e as Error).message || 'Could not load stats'));
    // Reports come from the documented admin endpoint rather than being
    // bolted onto floor-stats: one capability, one route, and the console
    // and this page read the same thing.
    api.getFeedback({ limit: 100 })
      .then(r => setReports(r.items))
      .catch(e => { console.error('feedback fetch failed:', e); setReports([]); });
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

              <div className="section">
                <div style={label}>Countries (14d) · visits / unique</div>
                <table style={mono}><tbody>
                  {stats.topCountries.map(c => (
                    <tr key={c.country}><td style={cell}>{countryLabel(c.country)}</td><td style={num}>{c.visits}</td><td style={num}>{c.uniques} uniq</td></tr>
                  ))}
                  {stats.topCountries.length === 0 && <tr><td style={cell}>no human visits yet</td></tr>}
                </tbody></table>
              </div>
            </div>

            <h2 style={{ margin: '2rem 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Visitor IPs (14d)</h2>
            <div style={{ ...label, marginTop: '-0.6rem', marginBottom: '0.8rem' }}>
              {stats.visitorSummary.people} likely people ·{' '}
              {stats.visitorSummary.servers} server/bot ·{' '}
              {stats.visitorSummary.proxies} proxy/VPN (by IP type)
            </div>
            <div className="section">
              <table style={mono}><tbody>
                {stats.recentVisitors.map(v => (
                  <tr key={v.ip}>
                    <td style={cell}>{v.ip}</td>
                    <td style={cell}>{kindTag(v.kind)}</td>
                    <td style={cell}>{countryLabel(v.country)}</td>
                    <td style={{ ...cell, color: 'var(--text-tertiary)', maxWidth: '18rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.org}</td>
                    <td style={num}>{v.visits}x</td>
                    <td style={{ ...num, color: 'var(--text-tertiary)' }}>{new Date(v.lastSeen).toLocaleString()}</td>
                  </tr>
                ))}
                {stats.recentVisitors.length === 0 && <tr><td style={cell}>no human visits yet</td></tr>}
              </tbody></table>
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
                      {/* Which door: the marketplace tile, or a floor's own
                          box. Both post to the same endpoint, so without it
                          every signup reads the same and there is no way to
                          tell which surface converts. */}
                      <td style={{ ...cell, color: 'var(--text-tertiary)' }}>{w.source ?? '—'}</td>
                    </tr>
                  ))}
                  {stats.waitlist.length === 0 && <tr><td style={cell}>empty</td></tr>}
                </tbody></table>
              </div>
            </div>

            {/* What people reported (owner ask 2026-08-15). Open items first,
                because this is a queue the owner works, not an archive: a
                resolved report is history, an open one is someone still
                stuck. Full body inline, since a report is usually three
                sentences and clicking through to read them is friction on
                the person who has to answer. */}
            <h2 style={{ margin: '2.5rem 0 1rem', fontSize: '1rem', fontWeight: 600 }}>
              Reports{reports ? ` (${reports.filter(r => r.status === 'open').length} open of ${reports.length})` : ''}
            </h2>
            {reports === null ? (
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>…</p>
            ) : reports.length === 0 ? (
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                Nothing reported yet. The floor's Report a bug button and POST /api/feedback both land here.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {[...reports]
                  .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1)
                    || b.createdAt.localeCompare(a.createdAt))
                  .map(r => (
                    <div
                      key={r.id}
                      style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: 8,
                        padding: '0.7rem 0.9rem',
                        opacity: r.status === 'open' ? 1 : 0.55,
                      }}
                    >
                      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700, color: KIND_COLOR[r.kind] ?? 'var(--text-secondary)' }}>
                          {r.kind}
                        </span>
                        <strong style={{ fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{r.subject}</strong>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                          {r.createdAt.slice(0, 16).replace('T', ' ')}
                          {r.status !== 'open' ? ` · ${r.status}` : ''}
                        </span>
                      </div>
                      {/* pre-wrap keeps the reporter's line breaks;
                          overflowWrap handles the rest, since a body can be
                          one unbroken 500-character string (a pasted token,
                          a URL, or a fuzz test) and would otherwise run off
                          the card. The height clamp stops a single huge
                          report pushing every other one off the screen. */}
                      <p style={{
                        margin: '0.4rem 0 0', fontSize: '0.85rem', lineHeight: 1.5,
                        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                        maxHeight: '14rem', overflowY: 'auto',
                      }}>{r.body}</p>
                      {/* Who to answer and where they were: without these a
                          report is a complaint nobody can act on. */}
                      <div style={{ marginTop: '0.4rem', fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>
                        {[r.email, r.agentId, r.url].filter(Boolean).join(' · ') || 'anonymous, no page recorded'}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
