import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ManifoldLogo } from '../components/ManifoldLogo';
import { PageTopBar } from '../components/PageTopBar';
import {
  api,
  type ProfileProposedJob,
  type PublicParticipantProfile,
  type PublicProfilePosition,
  type PublicProfileTrade,
} from '../lib/api';

/**
 * A participant's public profile, reworked to be a profile (owner
 * direction 2026-08-11): a picture, a handle, one profit number (the same
 * trading profit marked to current market prices the leaderboard ranks on,
 * so the two agree; owner direction 2026-08-14), and
 * the three things that matter about a trader here, their positions,
 * their recent trades, and the jobs they proposed. The calibration /
 * accuracy / resolved-markets / sub-agent / balance-chart clutter is
 * gone. Renders standalone (its own top bar), because a trader's name on
 * the floor links straight here with no app shell.
 */

function initials(handle: string): string {
  const parts = handle
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map(p => p[0])
    .join('');
  return (letters || handle[0] || '?').toUpperCase();
}

function fmtCr(v: number): string {
  const sign = v < 0 ? '-' : v > 0 ? '+' : '';
  const abs = Math.abs(v);
  return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
}

function fmtShares(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Strip the "$N: " convention so the title reads clean; show the ask separately. */
function splitAsk(title: string): { ask: number | null; rest: string } {
  const m = title.match(/^\$(\d+):\s*(.*)$/s);
  return m ? { ask: parseInt(m[1], 10), rest: m[2] } : { ask: null, rest: title };
}

function PositionRow({ p }: { p: PublicProfilePosition }) {
  return (
    <li className="prof-row">
      <span className={`prof-dir prof-dir--${p.direction}`}>{p.direction === 'higher' ? '▲' : '▼'}</span>
      <span className="prof-row-main">
        <span className="prof-row-title">{p.metricName ?? 'market'}</span>
        <span className="prof-row-sub">
          {fmtShares(p.shares)} {p.direction} · {p.workspaceName}
        </span>
      </span>
      <span className="prof-row-val">{fmtShares(p.shares)} sh</span>
    </li>
  );
}

function TradeRow({ t }: { t: PublicProfileTrade }) {
  // A redemption is not a direction and not a trade: the engine cashed the
  // matched pairs this participant was left holding, at the 1 credit a pair
  // is worth. Saying "sold" here would name an action they never took.
  const redeem = t.kind === 'redeem';
  return (
    <li className="prof-row">
      <span className={`prof-dir prof-dir--${redeem ? 'redeem' : t.direction}`}>
        {redeem ? '=' : t.direction === 'higher' ? '▲' : '▼'}
      </span>
      <span className="prof-row-main">
        <span className="prof-row-title">
          {redeem
            ? `Redeemed ${fmtShares(t.shares)} matched pairs`
            : `${t.kind === 'buy' ? 'Bought' : 'Sold'} ${fmtShares(t.shares)} ${t.direction}`}
        </span>
        <span className="prof-row-sub">
          {t.metricName ?? 'market'} · {t.workspaceName}
        </span>
      </span>
      <span className="prof-row-val">
        {t.kind === 'buy' ? '' : '+'}
        {fmtCr(Math.abs(t.cost)).replace(/^\+/, '')} cr
      </span>
      <span className="prof-row-time">{timeAgo(t.createdAt)}</span>
    </li>
  );
}

function JobRow({ j }: { j: ProfileProposedJob }) {
  const { ask, rest } = splitAsk(j.title);
  const askUsd = j.askUsd ?? ask;
  return (
    <li className="prof-row">
      <span className="prof-row-main">
        <span className="prof-row-title">{rest}</span>
        <span className="prof-row-sub">
          {askUsd ? `asks $${askUsd} · ` : ''}
          {j.status}
        </span>
      </span>
      <span className="prof-row-time">{timeAgo(j.createdAt)}</span>
    </li>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="prof-section">
      <h2 className="prof-h2">{title}</h2>
      {empty ? <p className="prof-empty">Nothing yet.</p> : <ul className="prof-list">{children}</ul>}
    </section>
  );
}

export function ParticipantProfilePage() {
  const { id } = useParams();
  const [profile, setProfile] = useState<PublicParticipantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api
      .getPublicProfile(id)
      .then(p => {
        setProfile(p);
        setLoading(false);
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [id]);

  // Show the handle; fall back to a readable id (a named bot) but never a
  // 32-char opaque key, which reads as noise.
  const readableId = (v: string) => (v.length <= 24 && /[a-z]/i.test(v) && v.includes('-')) || v.length <= 16;
  const handle = profile ? (profile.nickname ?? (readableId(profile.id) ? profile.id : 'anonymous')) : '';

  return (
    <div className="prof-page">
      <PageTopBar />

      <main className="prof-main">
        {loading && <p className="prof-empty">Loading…</p>}
        {error && <div className="message error show">{error}</div>}

        {profile && (
          <>
            <header className="prof-head">
              <div className="prof-avatar">
                {profile.image ? <img src={profile.image} alt="" /> : <span>{initials(handle)}</span>}
              </div>
              <div className="prof-id">
                <h1 className="prof-name">
                  {handle}
                  {profile.manifoldUsername && (
                    <a
                      className="prof-manifold"
                      href={`https://manifold.markets/${encodeURIComponent(profile.manifoldUsername)}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`Imported from Manifold: @${profile.manifoldUsername}`}
                    >
                      <ManifoldLogo size={14} /> @{profile.manifoldUsername}
                    </a>
                  )}
                </h1>
                <p className="prof-earned">
                  <span className={profile.stats.totalEarnings >= 0 ? 'is-up' : 'is-down'}>
                    {fmtCr(profile.stats.totalEarnings)} cr
                  </span>{' '}
                  profit
                  {/* The same split the board prints: what is final versus
                      what is still a mark (docs/seasons.md "The score"). */}
                  {profile.stats.settledEarnings !== undefined && (
                    <span
                      className="prof-split"
                      title="Settled: resolutions and refunds, final. Open: what open positions are worth right now."
                    >
                      {' '}
                      ({fmtCr(profile.stats.settledEarnings)} settled, {fmtCr(profile.stats.openEarnings)} open)
                    </span>
                  )}
                </p>
                {profile.bio && <p className="prof-bio">{profile.bio}</p>}
              </div>
            </header>

            <Section title="Positions" empty={profile.openPositions.length === 0}>
              {profile.openPositions.map(p => (
                <PositionRow key={`${p.workspaceId}:${p.marketId}:${p.direction}`} p={p} />
              ))}
            </Section>

            <Section title="Recent trades" empty={profile.recentTrades.length === 0}>
              {profile.recentTrades.map(t => (
                <TradeRow key={t.id} t={t} />
              ))}
            </Section>

            <Section title="Proposed jobs" empty={profile.proposedJobs.length === 0}>
              {profile.proposedJobs.map(j => (
                <JobRow key={j.id} j={j} />
              ))}
            </Section>
          </>
        )}
      </main>
    </div>
  );
}
