import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ManifoldLogo } from '../components/ManifoldLogo';
import { PageTopBar } from '../components/PageTopBar';
import {
  api,
  type ProfileProposedJob,
  type PublicParticipantProfile,
  type PublicProfilePosition,
  type PublicProfileTrade,
} from '../lib/api';
import { floorHref } from '../lib/floor-hash';

/**
 * A participant's public record (docs/ui-conventions.md, "The participant
 * profile"): who they are, how they are doing, and every bet they made,
 * each one a door back to the market it was made on. Every number on the
 * strip is one the platform already reports elsewhere (the board's profit,
 * the live balance, the trade count), so this page never disagrees with
 * another. Renders standalone (its own top bar), because a trader's name on
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

/** Signed, whole credits: "+6,337", "-120", "0". */
function fmtCr(v: number): string {
  const sign = v < 0 ? '-' : v > 0 ? '+' : '';
  const abs = Math.abs(v);
  return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
}

/** Unsigned credits: whole once they are large, one decimal while small. */
function fmtNum(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return Math.round(abs).toLocaleString('en-US');
  return (Math.round(abs * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function fmtShares(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}

/** A market's call: whole once large, else as the market prints it (up to 2 decimals). */
function fmtCall(v: number): string {
  return Math.abs(v) >= 100
    ? Math.round(v).toLocaleString('en-US')
    : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09" reads "Sep 2026"; a full date reads "Sep 15, 2026". */
function fmtTarget(targetDate: string | null): string | null {
  if (!targetDate) return null;
  const m = targetDate.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return targetDate;
  const month = MONTHS[parseInt(m[2], 10) - 1] ?? m[2];
  return m[3] ? `${month} ${parseInt(m[3], 10)}, ${m[1]}` : `${month} ${m[1]}`;
}

function marketTitle(metricName: string | null, targetDate: string | null): string {
  const when = fmtTarget(targetDate);
  return `${metricName ?? 'market'}${when ? ` · ${when}` : ''}`;
}

/** Strip the "$N: " convention so the title reads clean; show the ask separately. */
function splitAsk(title: string): { ask: number | null; rest: string } {
  const m = title.match(/^\$(\d+):\s*(.*)$/s);
  return m ? { ask: parseInt(m[1], 10), rest: m[2] } : { ask: null, rest: title };
}

function Cond({ title }: { title: string | null | undefined }) {
  if (!title) return null;
  return <span className="prof-row-cond"> if "{splitAsk(title).rest}"</span>;
}

function Dir({ direction }: { direction: 'higher' | 'lower' | null }) {
  // A redemption is not a direction: both sides left the book together.
  const cls = direction ?? 'redeem';
  return (
    <span className={`prof-dir prof-dir--${cls}`} aria-hidden="true">
      {direction === 'higher' ? '▲' : direction === 'lower' ? '▼' : '='}
    </span>
  );
}

function PositionRow({ p }: { p: PublicProfilePosition }) {
  const stand =
    p.status === 'resolved' && p.actualValue !== null
      ? `resolved at ${fmtCall(p.actualValue)}`
      : p.consensus !== null
        ? `market at ${fmtCall(p.consensus)}${p.probabilityHigher !== null ? `, ${Math.round(p.probabilityHigher * 100)}% higher` : ''}`
        : null;
  return (
    <li>
      <Link
        className="prof-row prof-row-link"
        to={floorHref(p.workspaceSlug, { marketId: p.marketId, proposalId: p.proposalId })}
      >
        <Dir direction={p.direction} />
        <span className="prof-row-main">
          <span className="prof-row-title">
            {marketTitle(p.metricName, p.targetDate)}
            <Cond title={p.proposalTitle} />
          </span>
          <span className="prof-row-sub">
            {fmtShares(p.shares)} {p.direction} · {p.workspaceName}
            {stand ? ` · ${stand}` : ''}
          </span>
        </span>
        <span className="prof-row-right">
          {p.profit != null ? (
            <span className={`prof-row-val prof-row-profit ${p.profit >= 0 ? 'is-up' : 'is-down'}`}>
              {fmtCr(p.profit)} cr
            </span>
          ) : (
            <span className="prof-row-val">{fmtShares(p.shares)} sh</span>
          )}
          {p.worth != null && (
            <span className="prof-row-sub">
              worth {fmtNum(p.worth)} · spent {fmtNum(p.totalCost)}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function TradeRow({ t }: { t: PublicProfileTrade }) {
  // A redemption is not a direction and not a trade: the engine cashed the
  // matched pairs this participant was left holding, at the 1 credit a pair
  // is worth. Saying "sold" here would name an action they never took.
  const redeem = t.kind === 'redeem';
  const title = redeem
    ? `Redeemed ${fmtShares(t.shares)} matched pairs`
    : `${t.kind === 'buy' ? 'Bought' : 'Sold'} ${fmtShares(t.shares)} ${t.direction} on ${marketTitle(t.metricName, t.targetDate)}`;
  const sub: string[] = [];
  if (!redeem && t.price != null) sub.push(`${t.price.toFixed(3)} cr a share`);
  // Only when the trade recorded it: a null is "not recorded", never zero.
  if (!redeem && t.consensusBefore != null && t.consensusAfter != null)
    sub.push(`moved the market ${fmtCall(t.consensusBefore)} → ${fmtCall(t.consensusAfter)}`);
  sub.push(redeem ? `${marketTitle(t.metricName, t.targetDate)} · ${t.workspaceName}` : t.workspaceName);
  return (
    <li>
      <Link
        className="prof-row prof-row-link"
        to={floorHref(t.workspaceSlug, { marketId: t.marketId, proposalId: t.proposalId, tradeId: t.id })}
      >
        <Dir direction={redeem ? null : t.direction} />
        <span className="prof-row-main">
          <span className="prof-row-title">
            {title}
            {!redeem && <Cond title={t.proposalTitle} />}
          </span>
          <span className="prof-row-sub">{sub.join(' · ')}</span>
        </span>
        <span className="prof-row-val">
          {t.kind === 'buy' ? '' : '+'}
          {fmtNum(Math.abs(t.cost))} cr
        </span>
        <span className="prof-row-time">{timeAgo(t.createdAt)}</span>
      </Link>
    </li>
  );
}

function ProposalRow({ j }: { j: ProfileProposedJob }) {
  const { ask, rest } = splitAsk(j.title);
  const askUsd = j.askUsd ?? ask;
  return (
    <li>
      <Link className="prof-row prof-row-link" to={floorHref(j.workspaceSlug, { proposalId: j.id })}>
        <span className="prof-row-main">
          <span className="prof-row-title">{rest}</span>
          <span className="prof-row-sub">
            {askUsd ? `asks $${askUsd} · ` : ''}
            {j.status} · {j.workspaceName}
          </span>
        </span>
        <span className="prof-row-time">{timeAgo(j.createdAt)}</span>
      </Link>
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

type Range = '1W' | '1M' | 'All';
const RANGE_DAYS: Record<Range, number | null> = { '1W': 7, '1M': 30, All: null };
const RANGE_LABEL: Record<Range, string> = { '1W': 'the last week', '1M': 'the last month', All: 'all time' };

/**
 * The balance over time: one ink line on a hairline baseline, first and
 * last values as labels. It is the balance, not profit; the snapshots are of
 * the balance. Nothing is drawn with fewer than two points.
 */
function BalanceChart({ history }: { history: Array<{ at: string; balance: number }> }) {
  const [range, setRange] = useState<Range>('1M');
  const sorted = history.slice().sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  if (sorted.length < 2) return null;
  const end = new Date(sorted[sorted.length - 1].at).getTime();
  const days = RANGE_DAYS[range];
  let points = days === null ? sorted : sorted.filter(p => new Date(p.at).getTime() >= end - days * 86400_000);
  // A range with one point in it still draws the line up to that point.
  if (points.length < 2) points = sorted.slice(-2);
  const W = 600;
  const H = 120;
  const PAD = 16;
  const t0 = new Date(points[0].at).getTime();
  const span = Math.max(1, end - t0);
  const lo = Math.min(...points.map(p => p.balance));
  const hi = Math.max(...points.map(p => p.balance));
  const y = (v: number) => (hi === lo ? H / 2 : PAD + ((hi - v) / (hi - lo)) * (H - 2 * PAD));
  const x = (at: string) => ((new Date(at).getTime() - t0) / span) * W;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)} ${y(p.balance).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const first = points[0];
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <section className="prof-section prof-chart">
      <div className="prof-chart-head">
        <h2 className="prof-h2">Balance</h2>
        <div className="prof-chips" role="group" aria-label="Range">
          {(['1W', '1M', 'All'] as Range[]).map(r => (
            <button
              key={r}
              type="button"
              className={`prof-chip${r === range ? ' is-active' : ''}`}
              aria-pressed={r === range}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <svg
        className="prof-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Balance over ${RANGE_LABEL[range]}`}
      >
        <line className="prof-chart-base" x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} />
        <path className="prof-chart-line" d={d} vectorEffect="non-scaling-stroke" />
        <circle className="prof-chart-dot" cx={x(last.at)} cy={y(last.balance)} r="3" />
        <text className="prof-chart-label" x="0" y={y(first.balance) < H / 2 ? H - 6 : 12}>
          {Math.round(first.balance).toLocaleString('en-US')}
        </text>
        <text className="prof-chart-label" x={W} y={y(last.balance) < H / 2 ? H - 6 : 12} textAnchor="end">
          {Math.round(last.balance).toLocaleString('en-US')}
        </text>
      </svg>
      <div className="prof-chart-axis">
        <span>{fmtDay(first.at)}</span>
        <span>{fmtDay(last.at)}</span>
      </div>
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
  const inPositions = profile ? profile.openPositions.reduce((sum, p) => sum + (p.worth ?? 0), 0) : 0;
  // An older payload carries the balance only as the last history point.
  const balance = profile
    ? (profile.balance ?? profile.balanceHistory?.[profile.balanceHistory.length - 1]?.balance ?? 0)
    : 0;
  const since = profile
    ? new Date(profile.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

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
                      title={`Linked Manifold account: @${profile.manifoldUsername}`}
                    >
                      <ManifoldLogo size={14} /> @{profile.manifoldUsername}
                    </a>
                  )}
                </h1>
                <p className="prof-since">
                  Trading since {since}
                  {profile.stats.rank !== null && <>{` · #${profile.stats.rank} on the leaderboard`}</>}
                </p>
                {profile.bio && <p className="prof-bio">{profile.bio}</p>}
              </div>
            </header>

            {/* The strip: the board's profit, the live balance, the trades.
                Every number here is one another page already prints. */}
            <section className="prof-strip" aria-label="Standing">
              <div className="prof-stat" data-testid="prof-stat-profit">
                <span className="prof-h2">Profit</span>
                <span className={`prof-stat-val ${profile.stats.totalEarnings >= 0 ? 'is-up' : 'is-down'}`}>
                  {fmtCr(profile.stats.totalEarnings)}
                  <span className="prof-stat-unit"> cr</span>
                </span>
                <span
                  className="prof-stat-sub"
                  title="Settled: resolutions and refunds, final. Open: what open positions are worth right now."
                >
                  {fmtCr(profile.stats.settledEarnings)} settled · {fmtCr(profile.stats.openEarnings)} open
                </span>
              </div>
              <div className="prof-stat" data-testid="prof-stat-balance">
                <span className="prof-h2">Balance</span>
                <span className="prof-stat-val">
                  {fmtNum(balance)}
                  <span className="prof-stat-unit"> cr</span>
                </span>
                <span
                  className="prof-stat-sub"
                  title="What their open positions are worth at the current call, summed."
                >
                  {fmtNum(inPositions)} cr in positions
                </span>
              </div>
              <div className="prof-stat" data-testid="prof-stat-trades">
                <span className="prof-h2">Trades</span>
                <span className="prof-stat-val">{profile.stats.totalTrades.toLocaleString('en-US')}</span>
                <span className="prof-stat-sub">
                  {profile.stats.totalTrades > 0
                    ? `${fmtNum(profile.stats.tradedVolume ?? 0)} cr traded · ${timeAgo(profile.stats.lastTradeAt)}`
                    : 'none yet'}
                </span>
              </div>
            </section>

            <BalanceChart history={profile.balanceHistory ?? []} />

            <Section title="Positions" empty={profile.openPositions.length === 0}>
              {profile.openPositions.map(p => (
                <PositionRow key={`${p.workspaceId}:${p.marketId}:${p.direction}`} p={p} />
              ))}
            </Section>

            <Section title="Trades" empty={profile.recentTrades.length === 0}>
              {profile.recentTrades.map(t => (
                <TradeRow key={t.id} t={t} />
              ))}
            </Section>

            <Section title="Proposals" empty={profile.proposedJobs.length === 0}>
              {profile.proposedJobs.map(j => (
                <ProposalRow key={j.id} j={j} />
              ))}
            </Section>
          </>
        )}
      </main>
    </div>
  );
}
