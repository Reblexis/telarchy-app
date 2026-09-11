import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { AccountMenu } from '../components/AccountMenu';
import { AgentDoors } from '../components/AgentDoors';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { FloorAnnouncements } from '../components/FloorAnnouncements';
import { FloorChat } from '../components/FloorChat';
import { FloorChecklist } from '../components/FloorChecklist';
import { FloorComments } from '../components/FloorComments';
import { FloorLiveView } from '../components/FloorLiveView';
import { FloorStandings, type ProposalTraderRow, SeasonAdvert, useCurrentSeason } from '../components/FloorRails';
import { FloorStrip } from '../components/FloorStrip';
import { Ghost, GhostRows, LoadingStatus } from '../components/Ghosts';
import { ClockGlyph, CoinGlyph, DropGlyph, JobsBoard, PersonGlyph, poolOf, splitAsk } from '../components/JobsBoard';
import { Linkified } from '../components/Linkified';
import { Logo } from '../components/Logo';
import { LiveView } from '../components/live/LiveView';
import { ManifoldButton } from '../components/ManifoldButton';
import { MarketChart } from '../components/MarketChart';
import { MarketFacts, MarketMoney } from '../components/MarketFacts';
import { MetricsDialog } from '../components/MetricsDialog';
import { NotificationsBell } from '../components/NotificationsBell';
import { granularityOf, NumberChart } from '../components/NumberChart';
import { AddDateDialog, InjectLiquidityDialog, NewMetricDialog, ReportValueDialog } from '../components/OwnerDialogs';
import { PositionSummary } from '../components/PositionSummary';
import { SubjectAbout } from '../components/SubjectAbout';
import { TopBarShortcuts } from '../components/TopBarShortcuts';
import { type TicketPosition, TradeTicket } from '../components/TradeTicket';
import { useAuth } from '../hooks/useAuth';
import { useMyParticipantId } from '../hooks/useMyParticipantId';
import type { FloorRef } from '../lib/agent-prompt';
import type { LeaderboardEntry, LimitOrder, PublicProposal, SnakeState } from '../lib/api';
import { api, type PublicWorkspace, setActiveWorkspace } from '../lib/api';
import { withBase } from '../lib/base-path';
import { type FeedQuotes, overlayFeedQuotes } from '../lib/feed-overlay';
import { parseFloorHash } from '../lib/floor-hash';
import {
  buildHorizonViews,
  captionLabel,
  cellOf,
  dateQuestionOf,
  dateSegmentOf,
  datesOf,
  forecastDayOf,
  type HorizonView,
  horizonById,
  metricLabelOf,
  metricsOf,
  moveQuestionOf,
  type PriceSeries,
  possessiveOf,
  priceSeriesIsInline,
  priceSeriesOf,
  sentenceCase,
  settleInstant,
  settleNoteOf,
  timeAgoOf,
  timeLeftOf,
} from '../lib/floor-horizons';
import { dropInline, readInline } from '../lib/inline-data';
import { maxWinLabel } from '../lib/market-quote';
import { authPath } from '../lib/nextPath';
import { periodGapOf } from '../lib/period-gap';
import { clockSecondsOf, countdownTo, dayOf, instantOf, pollIntervalFor, tickIntervalFor } from '../lib/viewer-time';

/**
 * telarchy.com/<slug>: the market and one action, nothing else (owner
 * decision, 2026-08-09: the poster stays free of explanatory context).
 * Composition: headline (the metric name alone; owner direction 2026-08-18:
 * no "@ <settle date>" beside it, the name carries its own period and the
 * chart caption says when it lands), price, the
 * Manifold-style step chart, and exactly one action: a "Make your call"
 * pill into signup when anonymous, the trade ticket (TradeTicket: pick a
 * side, pick an amount, one confirm) when signed in. The workspace
 * description, settle fineprint, ballot, charter, decided list, pitch and
 * footer are NOT rendered; the API still ships them, so each returns as a
 * render change.
 *
 * /marketplace/:idOrSlug still resolves here and canonicalizes to /<slug>.
 * A signed-in visitor on an Open workspace is joined silently; membership is
 * bookkeeping, not a decision.
 */

// Hoisted so ReactMarkdown's props keep their identity across renders;
// inline literals re-ran the whole unified parse pipeline per page render.
const MARKDOWN_PLUGINS = [remarkGfm, remarkBreaks];
const MARKDOWN_COMPONENTS = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

function formatValue(v: number): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * How a deadline reads at any scale (docs/ui-conventions.md, "The deadline
 * is said ONCE"): a countdown under a day, because a date is no use when the
 * answer is due this afternoon, by the second under an hour, and the date
 * itself above that.
 */
function whenOf(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'now';
  if (ms < 24 * 3_600_000) return `in ${countdownTo(iso, now).label}`;
  return dayOf(iso);
}

function formatDelta(delta: number, unit = ''): string {
  const abs = Math.abs(delta);
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  const num = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${unit}${num}`;
}

/**
 * One cell of a proposal's grid: the pair it ships for (metric, date).
 * Resolved by BOTH, because two metrics read on one date are two pairs
 * (owner report 2026-08-26).
 */
function pairAt(job: PublicProposal, targetDate: string | undefined, metricId: string | undefined) {
  if (!targetDate) return null;
  return (
    job.markets.find(
      m =>
        m.targetDate === targetDate && (m.metricId === undefined || metricId === undefined || m.metricId === metricId),
    ) ?? null
  );
}

/**
 * Whether anything is staked on a pair. Nothing staked means no forecast to
 * print and nothing to trade on arrival, so the strip says "no liquidity"
 * and the tab is dead (owner ask 2026-09-09, replacing the "untraded" note
 * of the same day).
 */
function hasLiquidity(pair: { approvedLiquidity: number | null; declinedLiquidity: number | null } | null): boolean {
  if (!pair) return false;
  return (pair.approvedLiquidity ?? 0) > 0 || (pair.declinedLiquidity ?? 0) > 0;
}

/** What a proposal does to one cell, as a strip tab reads it. */
function impactLabel(
  pair: { approvedConsensus: number | null; declinedConsensus: number | null } | null,
  unit: string,
): string | null {
  if (!pair || pair.approvedConsensus === null || pair.declinedConsensus === null) return null;
  const d = pair.approvedConsensus - pair.declinedConsensus;
  return d === 0 ? `\u00b1${unit}0` : formatDelta(d, unit);
}

// Labels, ordering and per-horizon facts live in lib/floor-horizons: one
// home, so no surface can decide what a horizon is from its index.

/**
 * The rows of "Traders on this proposal": one per account holding a
 * position on either branch of the selected pair, scored by the marked
 * profit of what they hold (worth at the current price minus what they
 * paid, both branches added), best first. An unpriced position counts zero
 * rather than as a loss of its cost. The workspace board lends the row its
 * picture, Manifold badge and season chip, so a holder reads the same
 * here as in the standings.
 */
export function holdersOf(
  positions: Array<{
    id: string;
    handle: string;
    direction: 'higher' | 'lower';
    cost: number;
    worth: number | null;
    branch: 'approved' | 'declined';
  }>,
  board: LeaderboardEntry[],
): ProposalTraderRow[] {
  const byId = new Map<string, { handle: string; profit: number; lines: string[] }>();
  for (const p of positions) {
    const row = byId.get(p.id) ?? { handle: p.handle, profit: 0, lines: [] };
    row.profit += (p.worth ?? p.cost) - p.cost;
    row.lines.push(`bet ${p.direction} if ${p.branch}`);
    byId.set(p.id, row);
  }
  return [...byId.entries()]
    .map(([id, r]) => {
      const known = board.find(e => e.id === id);
      return {
        ...(known ?? { calibration: null, accuracy: null, resolvedMarkets: 0, lastTradeAt: null }),
        id,
        nickname: r.handle,
        rank: null,
        totalEarnings: r.profit,
        totalTrades: r.lines.length,
        positionLine: r.lines.length === 1 ? r.lines[0] : `${r.lines.length} positions`,
      } as ProposalTraderRow;
    })
    .sort((a, b) => b.totalEarnings - a.totalEarnings);
}

type ChartMode = 'value' | 'call' | 'decisions' | 'live';

export function TradePage() {
  const params = useParams();
  const idOrSlug = params.slug ?? params.workspaceId;
  const { user, loading: authLoading } = useAuth();
  // Which row on the board is this visitor's. Rows are keyed by participant
  // id and the session carries an auth user id, which is a different thing.
  const myParticipantId = useMyParticipantId(!!user);
  const navigate = useNavigate();
  const location = useLocation();
  const [wsRaw, setWs] = useState<PublicWorkspace | null>(null);
  // The open step's prices read from the feed (docs/ui-conventions.md, "The
  // feed drives the floor"): the payload with the feed's latest quotes laid
  // over the pending proposals it names. Everything below reads `ws`.
  const [feedQuotes, setFeedQuotes] = useState<FeedQuotes>({});
  const ws = useMemo(() => overlayFeedQuotes(wsRaw, feedQuotes), [wsRaw, feedQuotes]);
  // The name and one-liner the server planted in a share link's HTML
  // (#telarchy-floor), so the headline paints before the payload lands.
  // Only honoured for the floor this address names; read once and dropped.
  const [hint] = useState(() => {
    const h = readInline<{ id: string; slug: string | null; name: string; description: string | null }>(
      'telarchy-floor',
    );
    if (!h || !idOrSlug) return null;
    return h.id === idOrSlug || (h.slug ?? '').toLowerCase() === idOrSlug.toLowerCase() ? h : null;
  });
  useEffect(() => {
    dropInline('telarchy-floor');
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [positions, setPositions] = useState<TicketPosition[]>([]);
  const [orders, setOrders] = useState<LimitOrder[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  // The walled liquidity wallet beside it: what a market can be funded with,
  // and what the server counts first when it decides whether an owner can
  // open one (docs/liquidity-purchases.md, liquiditySpendableUnits).
  const [liquidityWallet, setLiquidityWallet] = useState(0);
  const [ticketPreview, setTicketPreview] = useState<{ direction: 'higher' | 'lower'; newProb: number } | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  // The prize season, once per page: the season advert prints it and an
  // entrant's row in the standings carries its chip.
  const season = useCurrentSeason();
  // The traders on the selected proposal; null while they load.
  const [pairHolders, setPairHolders] = useState<ProposalTraderRow[] | null>(null);
  const pairHoldersReq = useRef(0);
  // Selecting a job switches the ONE market view to that job's conditional
  // market (owner decision 2026-08-09: no second market underneath). null
  // means the baseline market is showing.
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  /** Otto's panel, owned here because two things open it: his own dock in the
   *  corner and the "Ask Otto" button beside "What is <name>?", which is where
   *  a visitor's question actually forms. */
  const [askingOtto, setAskingOtto] = useState(false);

  // A notification points AT something: #proposal=<id> opens the floor on
  // that proposal (the older #contract=<id> does the same, because it is
  // printed in emails already sent), and #comment=<id> says which line in its thread the
  // reader was told about. Landing them on the page and leaving them to find
  // it is most of the way to not having linked at all, so the comment id is
  // handed to FloorComments, which opens the thread, scrolls to that line and
  // flashes it once. The hash is consumed on arrival so it does not fight the
  // back button or the #account link that shares this bar.
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  // A trade a profile row points at (docs/ui-conventions.md, "A trade has an
  // address"): handed to FloorComments, which opens Activity and flashes it.
  const [focusTradeId, setFocusTradeId] = useState<string | null>(null);
  const [flashContract, setFlashContract] = useState(false);
  //
  // Driven by the ROUTER's hash, not by the hashchange event. A click on the
  // bell while already standing on this floor changes the hash through
  // pushState, and pushState does not fire hashchange, so a listener-only
  // version silently did nothing exactly where it was most likely to be used
  // (owner report 2026-08-19: "I click it and it still doesn't highlight").
  // location.hash sees both that and a pasted URL.
  useEffect(() => {
    setEditingJob(false);
    setJobErr('');
  }, [selectedJobId]);

  useEffect(() => {
    const parsed = parseFloorHash(location.hash);
    if (!parsed) return;
    const { proposal, comment, market, trade } = parsed;
    if (proposal) setSelectedJobId(proposal);
    // #market= steps the page to that market (a profile's link to a trade on
    // a baseline market); selection is by id, so a market that has since
    // resolved falls back to the primary rather than to nothing.
    if (market) setHorizonId(market);
    setFocusCommentId(comment);
    setFocusTradeId(trade);
    // With no comment or trade to point at, the proposal itself is the thing
    // the notification named, so that is what flashes.
    if (proposal && !comment && !trade) {
      setFlashContract(true);
      setTimeout(() => setFlashContract(false), 1800);
    }
    // Consumed once applied, so it does not fight the back button or re-fire
    // the flash on the next render. replaceState rather than navigate: this is
    // tidying the address bar, not a place in the history.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [location.hash]);
  // Selecting a proposal changes the page's address (docs/ui-conventions.md,
  // "A proposal has a number and an address"): the address bar reads
  // #proposal=<number> while one is open, so copying the address bar is
  // copying the proposal. Replaced, never pushed, so the back button still
  // leaves the floor. A number still waiting for its proposal (the effect
  // below) is left alone; so is any hash that is not a proposal's.
  useEffect(() => {
    if (!ws || !idOrSlug) return;
    /* Two spellings of the same path. The ROUTER's is basename-relative and
       says whether this is the floor's own address (the /marketplace/:id
       spelling canonicalises elsewhere and is not ours to write); the
       ADDRESS BAR's carries the base, or a /beta reader is walked back onto
       production by their own address bar (docs/ui-conventions.md, "Every
       internal link is base-aware"). */
    const routePath = `/${encodeURIComponent(idOrSlug)}`;
    const floorPath = withBase(routePath);
    const search = window.location.search;
    const onFloor = location.pathname === routePath || location.pathname.startsWith(`${routePath}/p/`);
    if (!onFloor) return;
    if (selectedJobId) {
      if (/^\d+$/.test(selectedJobId)) return;
      const p = ws.proposals?.find(x => x.id === selectedJobId);
      /* A proposal with a number gets the sendable address; one without (a
         payload older than the column) keeps the hash it always had. */
      const want = p?.number
        ? `${floorPath}/p/${p.number}${search}`
        : `${floorPath}${search}#proposal=${encodeURIComponent(selectedJobId)}`;
      if (window.location.pathname + search + window.location.hash !== want) {
        window.history.replaceState(null, '', want);
      }
    } else if (window.location.pathname !== floorPath || parseFloorHash(window.location.hash)?.proposal) {
      window.history.replaceState(null, '', floorPath + search);
    }
  }, [ws, selectedJobId, idOrSlug, location.pathname]);
  // A proposal address accepts the number too: #proposal=7 names proposal
  // #7 (docs/ui-conventions.md, "A proposal has a number and an address").
  /* A proposal's own address (docs/ui-conventions.md, "A proposal has an
     address and a card", 2026-09-09): /<slug>/p/<number> is the floor opened
     on that proposal. The number waits as the selection the same way a hash
     number does, until the payload arrives and one answers to it. */
  useEffect(() => {
    if (params.number && /^\d+$/.test(params.number)) setSelectedJobId(cur => cur ?? params.number!);
  }, [params.number]);
  // The hash lands before the payload does, so the number waits here as the
  // selection until the proposals arrive and one of them answers to it.
  /* A number nobody answers to (docs/ui-conventions.md, "An address that
     names no proposal says so", 2026-09-10): the selection clears so the
     plain floor renders, and one quiet line says which number was asked
     for. Only once the payload is here: before that, the number is still
     waiting. */
  const [missingNumber, setMissingNumber] = useState<number | null>(null);
  useEffect(() => {
    if (!ws || !selectedJobId || !/^\d+$/.test(selectedJobId)) return;
    if (ws.proposals === undefined) return;
    const wanted = Number(selectedJobId);
    const hit = ws.proposals.find(p => p.number === wanted);
    if (hit) {
      setSelectedJobId(hit.id);
      setMissingNumber(null);
    } else {
      setSelectedJobId(null);
      setMissingNumber(wanted);
    }
  }, [ws, selectedJobId]);
  // Picking anything real forgets the miss.
  useEffect(() => {
    if (selectedJobId && !/^\d+$/.test(selectedJobId)) setMissingNumber(null);
  }, [selectedJobId]);
  // Which world the one view is showing (owner decision 2026-08-10: both
  // branches are on the page; the toggle picks which one the ticket trades,
  // and the chart draws the other as a quiet second line).
  const [branch, setBranch] = useState<'approved' | 'declined'>('approved');
  // Which clock the page is showing and the ticket trades, held as a MARKET
  const [condHistory, setCondHistory] = useState<{
    approved: Array<{ at: string; consensus: number | null }>;
    declined: Array<{ at: string; consensus: number | null }>;
  } | null>(null);
  // Price replays for horizons other than the one the payload carries inline,
  // keyed by market id. The payload ships the primary market's series (so the
  // first paint needs no second request) and names it; a reader who switches
  // clocks pulls that market's own series here. Nothing ever borrows another
  // market's prices, which is what drew the year's $77k line under the week's
  // $213 call (owner report 2026-08-17).
  const [horizonPrices, setHorizonPrices] = useState<Record<string, PriceSeries>>({});
  // The price straight from a trade response, so the headline moves before
  // the reload lands. Keyed by market so it never leaks across a switch.
  const [livePrice, setLivePrice] = useState<{ marketId: string; value: number } | null>(null);
  // The bet ticket (owner ask 2026-08-28, replacing the 2026-08-10 modal):
  // the floor shows two verbs; composing the bet happens inline under them,
  // with the charts still on screen. null = closed,
  // 'manage' = opened from the position summary with no side preset.
  const [betModal, setBetModal] = useState<'higher' | 'lower' | 'manage' | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  /** The (i) beside the floor's name, for touch: hover and focus are CSS. */
  const [wsWhatOpen, setWsWhatOpen] = useState(false);
  /* The live feed's latest state, reported up by the LIVE segment so the
     stat row can name the attempt (docs/ui-conventions.md, "The stat row",
     2026-09-11). Null until the first poll, and on a floor with no feed. */
  const [liveState, setLiveState] = useState<SnakeState | null>(null);
  const joinTried = useRef(false);
  // The owner's decision controls (owner ask 2026-08-11: approve from the
  // floor). manage capability on this workspace reveals them on a selected
  // job; everyone else never sees the bar.
  const [canManage, setCanManage] = useState(false);

  // The owner's three dialogs (docs/owner-on-the-floor.md, "The v1 controls").
  // One slot: they never stack, and adding a metric flows straight into adding
  // its date, because a metric with no date has no market.
  const [publishBusy, setPublishBusy] = useState(false);
  const openNewMetric = useCallback(() => setOwnerDialog({ kind: 'new-metric' }), []);
  const [ownerDialog, setOwnerDialog] = useState<
    | null
    | { kind: 'metrics' }
    | { kind: 'new-metric' }
    | { kind: 'add-date'; metricId: string; metricName: string }
    | { kind: 'dates'; metricId: string; metricName: string }
    | {
        kind: 'inject';
        marketId: string;
        marketLabel: string;
        pool: number;
        traders: number;
        /** The metric a baseline market respawns on; a proposal branch has none. */
        metricId?: string;
        metricName?: string;
        /** The baseline market's date, to find its row among the metric's entries. */
        targetDate?: string;
      }
    | { kind: 'report'; metricId: string; metricName: string }
  >(null);
  // Who the viewer is as a participant, so the floor can tell "my proposal"
  // from someone else's. A proposer edits their own; a manager edits any.
  const [myAgentId, setMyAgentId] = useState<string | null>(null);
  // Editing the selected proposal in place (owner ask 2026-08-20). Same shape
  // as the metric definition editor above: words and price save in place; an
  // untraded pair re-anchors, a traded one keeps its markets and positions
  // and the revision row discloses the change (docs/market-integrity.md I1b).
  const [editingJob, setEditingJob] = useState(false);
  const [jobAsk, setJobAsk] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobDesc, setJobDesc] = useState('');
  const [jobSaving, setJobSaving] = useState(false);
  const [jobErr, setJobErr] = useState('');
  const [declineReason, setDeclineReason] = useState<string | null>(null); // null = decline not open
  const [decideBusy, setDecideBusy] = useState(false);
  const [decideErr, setDecideErr] = useState('');
  // Removing a job is not a decision and has no undo in the UI, so it arms
  // first and takes a second click to fire.
  const [removeArmed, setRemoveArmed] = useState(false);

  const reload = () => {
    if (!idOrSlug) return;
    api
      .getMarketplaceWorkspace(idOrSlug)
      .then(w => {
        setWs(w);
        // The optimistic price covers the gap between a trade landing and the
        // payload that includes it; once a payload is here, the server's
        // number is the answer. Nothing used to clear it, so after your own
        // trade the headline, both side ceilings and your position's "Worth
        // now" all froze at the price YOUR trade landed at, for as long as
        // you stayed on the market, while the chart and the pool beside them
        // moved (bug hunt 2026-08-31).
        setLivePrice(null);
      })
      .catch(e => {
        console.error('trade page fetch failed:', e);
        // A missing slug is usually a bookmark from the deleted console
        // (/overview, /metrics, ...), so say what the visitor can do rather
        // than quoting an HTTP status at them.
        const missing = e instanceof Error && /\b404\b/.test(e.message);
        setError(
          missing ? 'There is no market at this address.' : e instanceof Error ? e.message : 'Failed to load workspace',
        );
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [idOrSlug]);

  // Canonical URL is the root-level slug; shared /marketplace/<x> links
  // keep working and quietly become /<slug>. PUBLIC floors only: slug
  // resolution excludes a private floor, so canonicalizing one rewrote the
  // owner's own page into an address that 404'd it one render later (owner
  // report 2026-08-28, "trade page fetch failed: 404" in triplicate).
  useEffect(() => {
    if (!ws?.slug || ws.visibility !== 'public') return;
    if (location.pathname.startsWith('/marketplace/')) {
      navigate(`/${ws.slug}`, { replace: true });
    }
  }, [ws, location.pathname, navigate]);

  // THIS floor is the workspace context for every call the page makes, pinned
  // the moment the payload arrives. It used to be set only inside the silent
  // join's success path, so a viewer the join skipped (an owner already in, a
  // non-open floor, a failed join) kept whatever workspace localStorage held
  // from an earlier page, and every header-scoped call answered for the wrong
  // floor: "Proposal not found" on edit was the owner's report of 2026-08-22.
  useEffect(() => {
    if (ws) setActiveWorkspace(ws.workspaceId);
  }, [ws]);

  // Silent join on an Open workspace; idempotent server-side.
  useEffect(() => {
    if (!ws || !user || joinTried.current) return;
    if (ws.joinAs !== 'trader') return;
    joinTried.current = true;
    api
      .joinWorkspace(ws.workspaceId)
      .then(() => setJoined(true))
      .catch(e => console.error('silent join failed:', e));
  }, [ws, user]);

  // Scoped to THIS workspace (owner report 2026-08-15): the rail's other
  // half, top contractors, has always been this workspace's, and a floor
  // that ranks its traders globally is answering a question nobody asked
  // while standing here. The cross-workspace board still lives at
  // /leaderboard.
  const loadLeaders = () => {
    if (!idOrSlug) return;
    // The workspace rail shows THIS workspace's own board (owner decision
    // 2026-08-22: local by default; the season and global boards live behind
    // "Show full leaderboard"). Enough rows for the top ten after dropping
    // never-traded participants (owner direction 2026-08-17).
    api
      .getLeaderboard(30, idOrSlug)
      .then(r => setLeaders(r.participants ?? []))
      .catch(e => console.error('leaderboard fetch failed:', e));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadLeaders, [idOrSlug]);

  // Once the floor is loaded (the workspace header is pinned), ask who we
  // are HERE. The manage capability is what the server checks on every
  // manage endpoint (approve, decline, edit any proposal), so it is what
  // decides whether to draw those controls. Deliberately not gated on the
  // silent join: the owner of a floor that is not open-join never joins,
  // and they are exactly who these controls exist for.
  useEffect(() => {
    if (!user || !ws) return;
    api
      .getProfile()
      .then(p => setCanManage(((p as { capabilities?: string[] }).capabilities ?? []).includes('manage')))
      .catch(e => console.error('profile fetch failed:', e));
    // ws is a fresh object every poll tick; the answer only changes with
    // the login or the floor, so key on their identities, not the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, ws?.workspaceId]);

  // What a new market opens with, prefilled into the add-date dialog. Owner
  // only, and the member-gated workspace read is the row that carries it.
  const [defaultCredits, setDefaultCredits] = useState(1000);
  useEffect(() => {
    if (!canManage || !ws?.workspaceId) return;
    api
      .getWorkspace(ws.workspaceId)
      .then(w => {
        const c = (w as { newMarketLiquidityCredits?: number }).newMarketLiquidityCredits;
        if (typeof c === 'number' && c > 0) setDefaultCredits(c);
      })
      .catch(() => {});
  }, [canManage, ws?.workspaceId]);

  const decide = async (action: 'approve' | 'decline', refund = false, id?: string, reason?: string) => {
    /* The id is explicit so a ruling can come from the board's own row
       (docs/ui-conventions.md, "The proposals board", 2026-09-09) without
       selecting the proposal first; the bar on the proposal's page passes
       none and rules on the one it is under. */
    const jobId = id ?? selectedJobId;
    if (!jobId || !ws) return;
    setDecideErr('');
    setDecideBusy(true);
    try {
      if (action === 'approve') {
        await api.approveProposal(jobId);
      } else {
        await api.declineProposal(jobId, (reason ?? declineReason ?? '').trim(), refund);
      }
      setDeclineReason(null);
      setSelectedJobId(cur => (cur === jobId ? null : cur));
      reload();
    } catch (e) {
      setDecideErr((e as Error).message || 'Could not record the decision');
    } finally {
      setDecideBusy(false);
    }
  };

  const removeJob = async () => {
    if (!selectedJobId || !ws) return;
    setDecideErr('');
    setDecideBusy(true);
    try {
      await api.removeProposal(selectedJobId);
      setRemoveArmed(false);
      setSelectedJobId(null);
      reload();
    } catch (e) {
      setDecideErr((e as Error).message || 'Could not remove the proposal');
    } finally {
      setDecideBusy(false);
    }
  };

  // Switching jobs must not leave the remove button armed on the next one.
  // Everything else that is "about the job on screen" resets here too, and
  // ONLY here: the branch toggle, the expanded description, the branch
  // histories. This used to live in the history-fetch effect below, which
  // re-runs on every poll, so five seconds after the owner opened the
  // decline branch the page yanked them back to approved and the chart
  // remounted (owner report 2026-08-13).
  useEffect(() => {
    setRemoveArmed(false);
    setDeclineReason(null);
    setDecideErr('');
    setBranch('approved');
    setDescExpanded(false);
    setCondHistory(null);
  }, [selectedJobId]);

  // The floor OPENS on the furthest-resolving market and the arrows beside the
  // metric's name step to the others (owner ask 2026-08-20, reversing the
  // 2026-08-17 "one clock" direction: what was confusing was two clocks shown
  // at once, and one market is a floor a trader has nothing left to do on).
  // Selection is held as a market id, never an index: buildHorizonViews owns
  // the order and horizonById answers which one is on screen, so a resolved
  // market or a reordered payload cannot silently re-point the page.
  const horizons: HorizonView[] = useMemo(() => buildHorizonViews(ws), [ws]);
  const [horizonId, setHorizonId] = useState<string | null>(null);
  const hero = horizonById(horizons, horizonId);
  // Two cycle words in one question line (owner ask 2026-08-28): the metric
  // word steps the METRIC, the date word steps the DATE of that metric. The
  // selected cell is a market id. See docs/ui-conventions.md "The question
  // line".
  const metricHeads = metricsOf(horizons);
  // Soonest first in the cycle: today, this week, this month, then anything absolute.
  // The cells the selected proposal is priced on stay on the strip while it
  // is open on the page (docs/ui-conventions.md, "The date strip").
  const keptCells = useMemo(() => {
    const p = ws?.proposals?.find(x => x.id === selectedJobId);
    return p ? p.markets.map(m => m.targetDate) : [];
  }, [ws, selectedJobId]);
  const heroDates = hero ? [...datesOf(horizons, hero.metricId, keptCells)].reverse() : [];
  // One clock for the page, so the countdown and every settle tooltip agree.
  const [now, setNow] = useState(() => new Date());
  /* DECISIONS (docs/ui-conventions.md, the DECISIONS segment): every decided
     proposal priced on the market on screen, at the pair recorded at the
     decision (the payload overwrites a decided proposal's pair with it). */
  const decisionForks = useMemo(() => {
    if (!hero) return [];
    return (ws?.proposals ?? []).flatMap(p => {
      if (!p.status || p.status === 'pending' || !p.resolvedAt) return [];
      const pr = p.markets?.find(
        m => m.targetDate === hero.targetDate && (m.metricId === undefined || m.metricId === hero.metricId),
      );
      if (!pr || pr.approvedConsensus == null || pr.declinedConsensus == null) return [];
      // The payload's status type lags the statuses the API writes, so read it as text.
      const status: string = p.status;
      const verdict =
        status === 'approved'
          ? 'approved'
          : status === 'withdrawn'
            ? 'withdrawn'
            : p.lapsedAt || status === 'lapsed'
              ? 'lapsed'
              : 'declined';
      return [
        {
          id: p.id,
          at: p.resolvedAt,
          approved: pr.approvedConsensus,
          declined: pr.declinedConsensus,
          taken: (p.status === 'approved' ? 'approved' : 'declined') as 'approved' | 'declined',
          label: p.number != null ? `#${p.number}` : p.title,
          number: p.number ?? null,
          title: p.title,
          verdict,
        },
      ];
    });
  }, [ws, hero]);
  const [pickedForkId, setPickedForkId] = useState<string | null>(null);
  // The most recent decision is the open one until the reader presses another.
  const openFork =
    decisionForks.find(f => f.id === pickedForkId) ??
    decisionForks.reduce<(typeof decisionForks)[number] | null>(
      (a, f) => (!a || new Date(f.at).getTime() > new Date(a.at).getTime() ? f : a),
      null,
    );
  /* ONE chart, and how the call moved is a mode of it (docs/ui-conventions.md,
     "The price and the chart", 2026-09-09). Two stacked charts cost 340px of
     the first screen and put the bet verbs below the fold. The mode is
     remembered for the session, not the page load. */
  const [chartMode, setChartMode] = useState<ChartMode>(() => {
    try {
      const m = sessionStorage.getItem('floorChartMode');
      return m === 'call' || m === 'live' || m === 'decisions' ? m : 'value';
    } catch {
      return 'value';
    }
  });
  const pickChartMode = useCallback((m: ChartMode) => {
    setChartMode(m);
    try {
      sessionStorage.setItem('floorChartMode', m);
    } catch {
      // A browser that refuses storage still gets the toggle, just not the memory.
    }
  }, []);
  // Every minute, and every second while the selected proposal decides
  // within the hour (docs/ui-conventions.md, "The deadline is said ONCE").
  const tickMs = tickIntervalFor(ws?.proposals ?? [], now.getTime());
  /* The live view is a segment of the chart slot (docs/ui-conventions.md,
     2026-09-11): a floor with a feed opens on LIVE unless the session
     remembers a mode; a remembered LIVE on a floor without a feed is VALUE. */
  const liveFeed = ws?.liveFeed ?? null;
  useEffect(() => {
    if (!liveFeed) return;
    try {
      if (sessionStorage.getItem('floorChartMode') === null) setChartMode('live');
    } catch {
      setChartMode('live');
    }
  }, [liveFeed]);
  const chartView: ChartMode = chartMode === 'live' && !liveFeed ? 'value' : chartMode;
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  // How long until the market on screen settles: beside the price in the
  // market chart's row (owner ask 2026-08-28), so the clock never leaves
  // the page.
  const settleLeft = hero ? timeLeftOf(hero, now) : null;
  /* A game floor asks in the game's unit (docs/ui-conventions.md, "The
     question line", 2026-09-11): on a snake floor a minute cell reads "in
     60 moves", never "at 15:53". Every other floor reads as before. */
  const askDateOf = (v: HorizonView | null) =>
    liveFeed?.kind === 'snake' ? moveQuestionOf(v, now) : dateQuestionOf(v);
  /* The attempt the reading belongs to, `deaths + 1`, once the feed has
     been read (docs/ui-conventions.md, "The stat row"); null otherwise. */
  const attempt =
    liveFeed?.kind === 'snake' && typeof liveState?.game?.deaths === 'number' ? liveState.game.deaths + 1 : null;
  /* The owner's two entries: the last tab of a strip that is drawn, or a
     button in the owner row when that strip has one option. */
  const manageMetrics = { label: 'Manage metrics', open: () => setOwnerDialog({ kind: 'metrics' }) };
  const manageDates = {
    label: 'Manage dates',
    open: () => {
      if (hero) setOwnerDialog({ kind: 'dates', metricId: hero.metricId, metricName: metricLabel });
    },
  };
  // What an operator's own agent is told about this market
  // (docs/owner-on-the-floor.md, "Handing it to your own agent"). Built from
  // the payload the page already holds, so the prompt names real ids and
  // cannot invent a workspace.
  const ownerState = ws
    ? {
        workspaceId: ws.workspaceId,
        name: ws.name,
        idOrSlug: ws.slug || ws.workspaceId,
        visibility: ws.visibility ?? 'unlisted',
        metrics: metricsOf(horizons).map(m => {
          const dates = horizons.filter(h => h.metricId === m.metricId);
          const reading = dates[0]?.metricHistory?.slice(-1)[0]?.value ?? null;
          return {
            name: m.metricLabel,
            value: reading,
            markets: dates.map(d => ({ targetDate: d.targetDate, pool: d.pool })),
          };
        }),
      }
    : null;
  // Whether the metric's machinery can still move: true while no market on it
  // has a trade, which is the condition docs/market-integrity.md puts on a
  // machinery edit (untraded markets void and respawn, nobody's money moves).
  // The report dialog offers the range on this, not on "no reading yet".
  const metricUntraded =
    hero !== null &&
    horizons
      .filter(h => h.metricId === hero.metricId)
      .every(h => (h.traderCount ?? 0) === 0 && (h.tradedVolume ?? 0) === 0);
  // The metric's value in force (its latest reading), said in the centre
  // beside the countdown, so the number the market is guessing at sits one
  // glance from its own chart (owner ask 2026-08-27). Absent while the
  // period has no reading yet, which is also when the number chart has
  // nothing to hold a dashed rule to.
  const lastReading = hero && hero.metricHistory.length > 0 ? hero.metricHistory[hero.metricHistory.length - 1] : null;
  const nowReading = lastReading?.value ?? null;
  // Beside the price, where the since-open chip used to be (owner ask
  // 2026-08-28, "the settles should be above the market graph next to the
  // market number"). The countdown and nothing else: the exact instant is
  // the hover (owner, 2026-09-01, on the second line of type this carried
  // for a day: "there should not be the date here? maybe upon hover but
  // thats it"). Said in the floor's own settle-instant words rather than a
  // raw UTC string, since a reader who reaches for it is reading it.
  const settleNote = hero ? (
    <span className="pubws-settle-in" title={hero.resolvesOn ? `settles ${settleInstant(hero.resolvesOn)}` : undefined}>
      {forecastDayOf(hero.resolvesOn) ? `for ${forecastDayOf(hero.resolvesOn)} · ` : ''}
      {settleLeft === 'settling' ? 'settling' : `settles in ${settleLeft ?? '…'}`}
    </span>
  ) : null;
  // The number chart renders even with no readings: it draws its own
  // "no reading yet" state with the market's marker (owner report
  // 2026-08-28, implied valuation: hiding it read as the graph
  // collapsing).
  // The arithmetic under the price: booked, missing, per day. Null for any
  // metric that does not accumulate inside its period, which is most of them.
  const gap = periodGapOf(hero);
  const unit = hero?.unit ?? '';
  const metricLabel = hero?.metricLabel ?? '';

  // The age of the reading in force, from the same `lastReading` the centre
  // already shows. A market settles on the last reading before its instant,
  // so the age IS the nudge to report again (docs/owner-on-the-floor.md);
  // three days is where it starts reading as stale rather than as fact.
  const readingAge = (() => {
    if (!lastReading?.at) return null;
    const days = Math.floor((now.getTime() - new Date(lastReading.at).getTime()) / 86400000);
    if (days <= 0) return 'reported today';
    if (days === 1) return 'reported yesterday';
    return `${days} days old`;
  })();
  /**
   * The same age, worded to follow "last read" rather than to stand alone:
   * the proposal view's cell says "last read · 4 days ago", where
   * `readingAge`'s own words ("4 days old", "reported today") read as a
   * second sentence (preview, 2026-09-10).
   */
  const readingWhen = (() => {
    if (!lastReading?.at) return null;
    const days = Math.floor((now.getTime() - new Date(lastReading.at).getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  })();
  // Stale means "taken before the period this market settles for", not "more
  // than three days old" (owner decision 2026-08-31). Three days was
  // meaningless twice over: an hourly market is stale within the hour, and a
  // market on next year's revenue is not stale after a week.
  const readingIsStale = (() => {
    if (!hero) return false;
    const start = hero.periodStart ? new Date(hero.periodStart).getTime() : null;
    // A period that has not started yet cannot have a stale reading in it.
    if (start !== null && now.getTime() < start) return false;
    if (!lastReading?.at) return true;
    return start !== null && new Date(lastReading.at).getTime() < start;
  })();
  // The distinct numbers this floor prices, in the same label shape the rest
  // of the page uses (metricLabelOf owns that; see floor-horizons.ts). Feeds
  // the propose form's placeholder, so a proposer is told what their proposal
  // is supposed to move.
  const metricNames = useMemo(
    () =>
      Array.from(
        new Set(
          // captionLabel drops a leading copy of the company's name, the same way
          // the number's caption does (owner decision 2026-08-18). Without it the
          // pitch placeholder on a floor whose metrics are named after the company
          // read "This will affect LookPilot weekly net revenue and LookPilot
          // monthly net revenue", three LookPilots in one sentence.
          (ws?.markets ?? []).map(m => captionLabel(metricLabelOf(m.metricName), ws?.name)),
        ),
      ).slice(0, 3),
    [ws?.markets, ws?.name],
  );
  const selectedJob = ws?.proposals?.find(p => p.id === selectedJobId) ?? null;
  // A proposal is editable by whoever posted it (and by a manager) while it is
  // still on the ballot. The server decides the same thing again; this only
  // decides whether to draw the button.
  const canEditJob =
    !!selectedJob &&
    (selectedJob.status ?? 'pending') === 'pending' &&
    (canManage || (!!myAgentId && selectedJob.proposedByHandle === myAgentId));

  /* What the ticket says it trades, in the card (docs/ui-conventions.md,
     "The rails, and the standings under the verbs", revised 2026-09-09):
     a quiet line of context over the bold subject. */
  const ticketSubject = (() => {
    if (selectedJob) {
      const bits = [`#${selectedJob.number}`, `if ${branch}`];
      if (selectedJob.decideBy) bits.push(`decides ${dayOf(selectedJob.decideBy)}`);
      return { context: bits.join(' · '), title: selectedJob.title };
    }
    if (!hero) return undefined;
    const clock = /^(today|this week|this month)$/.test(hero.label) ? hero.label : '';
    const subject = captionLabel(metricLabel, ws?.name);
    const title = `${subject.charAt(0).toUpperCase()}${subject.slice(1)}${clock ? `, ${clock}` : ''}`;
    /* The floor and nothing else: the clock is in the title already, and a
       settle day beside it said the same date twice (owner report
       2026-09-09, "ther eis twice the date"). */
    return { context: ws?.name ?? '', title };
  })();

  const saveJobEdit = async () => {
    if (!selectedJob || !ws) return;
    setJobSaving(true);
    setJobErr('');
    try {
      const askNum = jobAsk.trim() === '' ? 0 : Math.max(0, Math.round(Number(jobAsk)));
      if (!Number.isFinite(askNum)) throw new Error('The price has to be a number');
      // Same composition as posting one: the price rides in the title for
      // everything that reads prose, and separately as the number anything
      // financial reads. The server refuses the two disagreeing.
      const task = jobTitle.trim();
      if (!task) throw new Error('A proposal needs a title');
      const fullTitle = askNum > 0 ? `$${askNum}: ${task}` : task;
      await api.editProposal(selectedJob.id, {
        title: fullTitle,
        description: jobDesc.trim(),
        askUsd: askNum,
      });
      setEditingJob(false);
      reload();
    } catch (e) {
      setJobErr(e instanceof Error ? e.message : 'Could not save the proposal');
    } finally {
      setJobSaving(false);
    }
  };

  // The proposal's pair for the horizon on screen, not whichever pair the
  // payload happened to list first.
  // By (metric, date): with several metrics read on one date, the date alone
  // would pick another metric's pair.
  const pair =
    (hero &&
      selectedJob?.markets.find(
        m => m.targetDate === hero.targetDate && (m.metricId === undefined || m.metricId === hero.metricId),
      )) ??
    selectedJob?.markets[0] ??
    null;
  // A decided job is history: its markets are resolved, so trading is paused;
  // the page still shows the impact that was priced for it.
  const selectedJobDecided = !!selectedJob?.status && selectedJob.status !== 'pending';
  // Trading on both branches closes at the decision or the deadline
  // (docs/guides/proposals.md, "The deadline, and the close"): no verbs, no
  // ticket, no Sell; the position card says when it settles.
  const selectedJobClosed = selectedJobDecided || !!selectedJob?.closedAt;
  // Past its deadline and still pending: closed before the ruling lands
  // (docs/ui-conventions.md, "A proposal past its deadline reads as closed
  // before the ruling lands"). The verbs are dead and one line says so.
  const selectedJobPastDeadline =
    !!selectedJob &&
    !selectedJobClosed &&
    !!selectedJob.decideBy &&
    new Date(selectedJob.decideBy).getTime() <= now.getTime();
  // The ruling's word for the head: approved, declined, or lapsed.
  const selectedJobRuling: 'approved' | 'declined' | 'lapsed' | null = !selectedJob
    ? null
    : selectedJob.lapsedAt
      ? 'lapsed'
      : selectedJob.status === 'approved' || selectedJob.status === 'declined'
        ? selectedJob.status
        : selectedJobClosed
          ? 'lapsed'
          : null;
  // Opening a proposal, by a row, a chevron or its address, scrolls its head
  // into view (docs/ui-conventions.md, "The feed drives the floor").
  const scrolledToRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedJob?.id ?? null;
    if (!id || scrolledToRef.current === id) return;
    scrolledToRef.current = id;
    const el = document.querySelector('.pubws-proposal-head');
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedJob?.id]);
  // How the deadline reads, and whether it is close enough to shout about.
  const deadlineUrgent =
    !!selectedJob?.decideBy &&
    !selectedJobClosed &&
    new Date(selectedJob.decideBy).getTime() - now.getTime() < 60 * 60 * 1000;
  // The selected branch's market id/price shape, and the other branch's for
  // the chart's second line. A branch market can exist without any liquidity
  // (nobody funded the subsidy and the workspace owner could not cover the
  // auto-fund fallback either), in which case it has no price at all: its
  // honest prior for DRAWING is the baseline call, not a vanished chart.
  //
  // `funded` is carried separately from that borrowed number, because the
  // two questions are different and conflating them shipped a real bug
  // (owner report 2026-08-15: betting on a job returned "Market has no
  // liquidity. Admin must inject liquidity before trading"). Borrowing the
  // baseline's liquidity made an unfunded branch look tradeable, so the
  // floor offered a bet the server had to refuse at submit time.
  const branchShape = (b: 'approved' | 'declined') => {
    if (!pair) return null;
    const marketId = b === 'approved' ? pair.approvedMarketId : pair.declinedMarketId;
    if (!marketId) return null;
    const ownLiquidity = (b === 'approved' ? pair.approvedLiquidity : pair.declinedLiquidity) ?? 0;
    return {
      marketId,
      consensus: (b === 'approved' ? pair.approvedConsensus : pair.declinedConsensus) ?? hero?.consensus ?? null,
      probability: (b === 'approved' ? pair.approvedProbability : pair.declinedProbability) ?? hero?.probability ?? 0.5,
      liquidity: ownLiquidity > 0 ? ownLiquidity : (hero?.liquidity ?? 1),
      funded: ownLiquidity > 0,
      // The branch's own three facts, never borrowed from the baseline the way
      // the price shape above is: a conditional market is a market like any
      // other and says what IT holds (docs/ui-conventions.md, "What a market
      // says about itself"). An unspawned branch has no numbers, a spawned
      // one nobody has touched has zeroes.
      pool: (b === 'approved' ? pair.approvedPool : pair.declinedPool) ?? 0,
      traders: (b === 'approved' ? pair.approvedTraders : pair.declinedTraders) ?? 0,
      volume: (b === 'approved' ? pair.approvedVolume : pair.declinedVolume) ?? 0,
      rangeMin: pair.rangeMin,
      rangeMax: pair.rangeMax,
      history: condHistory?.[b] ?? [],
    };
  };
  // The one market the page is showing and the ticket is trading: the
  // baseline, or the selected branch of the selected job.
  const active =
    branchShape(branch) ??
    (hero
      ? {
          marketId: hero.marketId,
          consensus: hero.consensus,
          probability: hero.probability,
          liquidity: hero.liquidity,
          funded: hero.liquidity > 0,
          pool: hero.pool,
          traders: hero.traderCount ?? 0,
          volume: hero.tradedVolume ?? 0,
          rangeMin: hero.rangeMin,
          rangeMax: hero.rangeMax,
          history: priceSeriesOf(hero.marketId, ws, horizonPrices),
        }
      : null);
  const otherBranch = pair ? branchShape(branch === 'approved' ? 'declined' : 'approved') : null;
  const activeMarketId = active?.marketId ?? null;

  // Both branches' own histories, so the main chart keeps meaning something
  // after a branch switch. Overwrites in place (never blanks first), so a
  // refresh redraws the same lines instead of collapsing the chart to a
  // single point for a frame.
  const condHistoryRef = useRef<() => void>(() => {});
  // Every pull carries a token; only the newest one may write. Polling and a
  // job switch can be in flight together, and a slow earlier response landing
  // last would otherwise paint the previous job's lines.
  const condReqRef = useRef(0);
  condHistoryRef.current = () => {
    const aid = pair?.approvedMarketId;
    const did = pair?.declinedMarketId;
    const token = ++condReqRef.current;
    if (!aid || !ws) return;
    const slug = ws.slug || ws.workspaceId;
    Promise.all([
      api.getPublicMarketHistory(slug, aid),
      did ? api.getPublicMarketHistory(slug, did) : Promise.resolve([]),
    ])
      .then(([a, d]) => {
        if (token === condReqRef.current) setCondHistory({ approved: a, declined: d });
      })
      .catch(e => console.error('conditional history fetch failed:', e));
  };
  // The workspace's stable identity for URLs. Deliberately NOT the `ws`
  // object: that is a fresh object on every five-second poll, and effects
  // keyed on it re-ran (and re-reset) on every tick.
  const wsKey = ws ? ws.slug || ws.workspaceId : null;

  // The selected horizon's own price replay, when it is not the one the
  // payload carries inline. Cached per market id, so switching back and forth
  // costs one request each, and never cleared: a stale-by-five-seconds series
  // is redrawn by the next poll, whereas blanking it flickers the chart.
  const priceReqRef = useRef(0);
  const heroMarketId = hero?.marketId ?? null;
  const heroPricesInline = priceSeriesIsInline(heroMarketId, ws);
  // Pulled on every poll, like the branch histories beside it. Fetched once
  // and left alone, the series froze at the instant the reader arrived: they
  // would watch an hour of trades move the headline while the chart kept a
  // snapshot. The payload's inline series is refreshed by the reload, so this
  // only matters for a market it does not carry (a proposal's branch).
  const horizonPricesRef = useRef<() => void>(() => {});
  horizonPricesRef.current = () => {
    if (!heroMarketId || !wsKey || heroPricesInline) return;
    const token = ++priceReqRef.current;
    api
      .getPublicMarketHistory(wsKey, heroMarketId)
      .then(points => {
        if (token !== priceReqRef.current) return;
        setHorizonPrices(prev => ({ ...prev, [heroMarketId]: points }));
      })
      .catch(e => console.error('horizon price history fetch failed:', e));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    horizonPricesRef.current();
  }, [heroMarketId, heroPricesInline, wsKey]);

  // The initial pull for a newly selected job. Keyed on the market ids and
  // the workspace's stable slug, NOT on the `ws` object: `ws` is a fresh
  // object on every five-second poll, and depending on it re-ran this whole
  // effect (and its resets) on every tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    condHistoryRef.current();
  }, [pair?.approvedMarketId, pair?.declinedMarketId, wsKey]);

  // The traders on the selected proposal (docs/ui-conventions.md, "The
  // rails, and the standings under the verbs"): every account holding a
  // position on either branch of the pair, scored by that position's marked
  // profit, read off the same public activity endpoint the Positions tab
  // uses. A branch whose read fails contributes nothing rather than sinking
  // the other's rows; only the newest pull may write, so a slow answer for
  // the previous proposal never paints the wrong holders.
  const pairHoldersRef = useRef<() => void>(() => {});
  pairHoldersRef.current = () => {
    const branches = [
      { marketId: pair?.approvedMarketId, branch: 'approved' as const },
      { marketId: pair?.declinedMarketId, branch: 'declined' as const },
    ].filter((b): b is { marketId: string; branch: 'approved' | 'declined' } => !!b.marketId);
    const token = ++pairHoldersReq.current;
    if (!idOrSlug || branches.length === 0) {
      // A proposal with no books yet has nobody on it.
      setPairHolders(selectedJob ? [] : null);
      return;
    }
    Promise.all(
      branches.map(b =>
        api
          .getMarketActivity(idOrSlug, b.marketId)
          .then(a => (a.positions ?? []).map(p => ({ ...p, branch: b.branch })))
          .catch(e => {
            console.error('pair positions fetch failed:', e);
            return [];
          }),
      ),
    ).then(parts => {
      if (token !== pairHoldersReq.current) return;
      setPairHolders(holdersOf(parts.flat(), leaders));
    });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPairHolders(null);
    pairHoldersRef.current();
  }, [pair?.approvedMarketId, pair?.declinedMarketId, selectedJobId, wsKey]);

  const refreshMoney = () => {
    if (activeMarketId && ws) {
      api
        .getPositions(activeMarketId, undefined, ws.workspaceId)
        .then((rows: Array<{ direction: 'higher' | 'lower'; shares: number; totalCost: number }>) =>
          setPositions((rows ?? []).filter(r => r.shares > 1e-9)),
        )
        .catch(e => console.error('positions fetch failed:', e));
      api
        .getLimitOrders(activeMarketId, ws.workspaceId)
        .then(rows => setOrders(rows ?? []))
        .catch(e => console.error('limit orders fetch failed:', e));
    }
    api
      .getParticipant()
      .then(pt => {
        const row = pt as { balance?: number; liquidityBalance?: number; id?: string };
        setBalance(row.balance ?? null);
        setLiquidityWallet(row.liquidityBalance ?? 0);
        setMyAgentId(row.id ?? null);
      })
      .catch(e => console.error('participant fetch failed:', e));
  };
  // Positions belong to the market on screen, so they refetch on a switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPositions([]);
    setOrders([]);
    if (joined) refreshMoney();
  }, [joined, activeMarketId]);

  // Live updates (owner ask 2026-08-11: the market updates in real time
  // for viewers and traders). The floor polls so a price move, a filled
  // limit order, or a new job appears without a reload. A ref holds the
  // latest closures so the interval never runs a stale one. Paused while
  // the tab is hidden; a fresh pull the instant it comes back, so
  // returning to the tab is never stale. 15s, not the original 5s
  // (2026-08-20): each tick is ~5 endpoints, so one open tab was 60
  // requests a minute against the database that ran out of connections
  // that evening; a trader's own actions refresh instantly regardless,
  // and markets here trade minutes apart.
  const pollRef = useRef<() => void>(() => {});
  pollRef.current = () => {
    reload();
    loadLeaders();
    condHistoryRef.current();
    horizonPricesRef.current();
    pairHoldersRef.current();
    if (joined) refreshMoney();
  };
  // Every five seconds instead while a pending proposal decides within five
  // minutes (docs/ui-conventions.md, "The board is at most five seconds
  // behind the trades"): a one-minute window is watched at the rate it moves.
  const pollMs = pollIntervalFor(ws?.proposals ?? [], now.getTime(), { fed: !!ws?.liveFeed });
  useEffect(() => {
    const tick = () => {
      if (typeof document === 'undefined' || !document.hidden) pollRef.current();
    };
    const interval = setInterval(tick, pollMs);
    const onVisible = () => {
      if (!document.hidden) pollRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMs]);

  // The stale-tab guard is app-wide now (src/components/BuildWatch.tsx): it
  // was here alone, on a five-minute timer a phone freezes while the tab is
  // in the background, so the floor never caught up on the one device where
  // tabs live longest.

  // The ticket owns busy/error/flash UI state; the page owns the money
  // plumbing. Errors propagate by throwing so the ticket can show them
  // where the finger is.
  const doTrade = async (body: Record<string, unknown>) => {
    if (!ws) return;
    const r = (await api.trade(body, ws.workspaceId)) as {
      consensus?: number | null;
      settledConsensus?: number | null;
    };
    // If resting limit orders filled against this trade, the market settled
    // at settledConsensus, not at the trade's own post-price; show where the
    // market actually is, not where it briefly was.
    const landed = typeof r.settledConsensus === 'number' ? r.settledConsensus : r.consensus;
    if (typeof landed === 'number' && typeof body.marketId === 'string') {
      setLivePrice({ marketId: body.marketId, value: landed });
    }
    refreshMoney();
    reload();
    // The rail must show this trade too: the server drops its board cache
    // the moment a trade commits, so this read is guaranteed to include it
    // (owner report 2026-08-21: "not always showing the latest state").
    loadLeaders();
    condHistoryRef.current();
  };
  const placeTrade = async (direction: 'higher' | 'lower', amount: number) => {
    if (!activeMarketId) return;
    await doTrade({ marketId: activeMarketId, direction, amount });
  };
  // The ticket's typed "New value" places the server's targetValue mode: the
  // market lands ON the typed value (netting included), so the number the
  // ticket showed is the number the floor prints next.
  const placeTargetTrade = async (targetValue: number, maxBudget: number) => {
    if (!activeMarketId) return;
    await doTrade({ marketId: activeMarketId, targetValue, maxBudget });
  };
  const sellPosition = async (p: TicketPosition, shares: number) => {
    if (!activeMarketId) return;
    await doTrade({ marketId: activeMarketId, direction: p.direction, sellShares: Math.min(p.shares, shares) });
  };
  // A resting order changes no price today, so it refreshes the money but
  // does not touch the chart's history.
  const placeLimit = async (direction: 'higher' | 'lower', limitValue: number, budgetCredits: number) => {
    if (!activeMarketId || !ws) return;
    await api.placeLimitOrder({ marketId: activeMarketId, direction, limitValue, budgetCredits }, ws.workspaceId);
    refreshMoney();
  };
  const cancelLimit = async (id: string) => {
    if (!ws) return;
    await api.cancelLimitOrder(id, ws.workspaceId);
    refreshMoney();
  };

  // The prediction's own movement: for the baseline, the call vs the call
  // after its first trade. For a job, the chip shows the impact itself,
  // stated from the world on screen (owner ask 2026-08-26): approved minus
  // declined on the approved branch, declined minus approved on the
  // declined one, so "if declined" reads -7.8 where "if approved" read +7.8.
  // Impact is the delta on the floor's one horizon, which is also the only
  // market on screen, so `pair` already IS that pair. Kept as its own name
  // because the ballot passes the same target date and the two must agree.
  /* The proposal's own two facts, derived once: what it asks for (the stored
     number, or the title convention for proposals older than the column) and
     what is behind its pairs. */
  const jobAskUsd = selectedJob ? (selectedJob.askUsd ?? splitAsk(selectedJob.title).ask) : null;
  const jobPool = selectedJob ? poolOf(selectedJob) : null;
  const jobImpact =
    pair && pair.approvedConsensus !== null && pair.declinedConsensus !== null
      ? branch === 'declined'
        ? pair.declinedConsensus - pair.approvedConsensus
        : pair.approvedConsensus - pair.declinedConsensus
      : null;
  const impactUnit = unit;
  // The probability the position panel values a position at: the live one
  // when the socket has spoken for this market, else the payload's.
  const livePriceProb =
    livePrice && livePrice.marketId === activeMarketId && active && active.rangeMax > active.rangeMin
      ? Math.max(0, Math.min(1, (livePrice.value - active.rangeMin) / (active.rangeMax - active.rangeMin)))
      : null;
  /* What each side has on the table: the verbs quote it in the same words
     as the ticket's pills, from the same function, so the two untouched
     states of a market cannot drift apart. */
  // ONE probability for every surface that prices this market: the ticket,
  // the ceilings and the position card all used to derive it separately, so
  // the ticket could say a position was worth one thing and the card
  // directly under it another (AGENTS.md: two surfaces that show the same
  // fact must derive it from the same place).
  const shownProbability = active ? (livePriceProb ?? active.probability) : 0;
  const higherCeiling = active ? maxWinLabel(shownProbability, active.liquidity) : null;
  const lowerCeiling = active ? maxWinLabel(1 - shownProbability, active.liquidity) : null;
  const consensus =
    (livePrice && livePrice.marketId === activeMarketId ? livePrice.value : null) ?? active?.consensus ?? null;
  // The headline number rolls to its new value (trade, branch switch, job
  // select) instead of teleporting, via the AnimatedNumber leaf at the
  // headline itself: the tween's per-frame state lives there, not here, so
  // an animation frame repaints one span, not this whole page.

  // "What is this?" reveal: the concept beats draw themselves in when the
  // section scrolls into view (a one-shot IntersectionObserver), so the
  // explanation lands as a small orchestrated moment instead of sitting
  // static at the bottom. Dep on `ws` so the observer attaches once the
  // section actually renders.
  // "What can you do?" sends the reader to the control it names: the bet
  // buttons, or the proposals board. Scrolling beats opening a modal here,
  // because the point is to show WHERE the thing lives on a page they will
  // come back to, not to start the action for them.
  const scrollToAction = (what: 'trade' | 'contract') => {
    const sel = what === 'trade' ? '.pubws-bet, .pubws-unfunded' : '.pubws-rail--right';
    const el = document.querySelector(sel);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const aboutRef = useRef<HTMLElement | null>(null);
  const [aboutIn, setAboutIn] = useState(false);
  useEffect(() => {
    const el = aboutRef.current;
    if (!el || aboutIn) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setAboutIn(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.workspaceId, aboutIn]);

  // The composed bet's impact, projected from probability space onto the
  // metric's range so the chart can draw where the call would move.
  const chartPreview =
    active && ticketPreview
      ? {
          direction: ticketPreview.direction,
          value: active.rangeMin + ticketPreview.newProb * (active.rangeMax - active.rangeMin),
        }
      : null;

  // Chart inputs memoized for identity: fresh literals here defeated
  // MarketChart's memo, so every page render re-sorted the series and
  // rebuilt the SVG paths even when nothing about the chart changed.
  const chartSeries = useMemo(
    () => (active && active.history.length > 0 ? active.history : [{ at: now.toISOString(), consensus }]),
    [active, consensus, now],
  );
  /* The chart's one control: VALUE draws the number's own trajectory, CALL
     draws how the market's call moved. It rides the chart's left cell, which
     the stat row emptied when it moved above the plot. */
  const chartModeToggle = (
    <span className="pubws-seg pubws-seg--chart" role="group" aria-label="Chart">
      <button
        type="button"
        className={`pubws-seg-btn${chartView === 'value' ? ' is-active' : ''}`}
        aria-pressed={chartView === 'value'}
        onClick={() => pickChartMode('value')}
      >
        Value
      </button>
      <button
        type="button"
        className={`pubws-seg-btn${chartView === 'call' ? ' is-active' : ''}`}
        aria-pressed={chartView === 'call'}
        onClick={() => pickChartMode('call')}
      >
        Call
      </button>
      <button
        type="button"
        className={`pubws-seg-btn${chartView === 'decisions' ? ' is-active' : ''}`}
        aria-pressed={chartView === 'decisions'}
        onClick={() => pickChartMode('decisions')}
      >
        Decisions
      </button>
      {liveFeed && (
        <button
          type="button"
          className={`pubws-seg-btn${chartView === 'live' ? ' is-active' : ''}`}
          aria-pressed={chartView === 'live'}
          onClick={() => pickChartMode('live')}
        >
          Live
        </button>
      )}
    </span>
  );
  const chartOrders = useMemo(
    () => orders.map(o => ({ id: o.id, direction: o.direction, limitValue: o.limitValue })),
    [orders],
  );
  /* The call's own move since yesterday (docs/ui-conventions.md, "The stat
     row"): the change against the last point at least 24 hours old in this
     market's own price replay. A returning trader's first question is what
     moved while they were away, and a bare consensus cannot answer it. No
     point that old, or no move, prints nothing: a grey zero is noise, and a
     selected proposal's impact owns the slot instead. */
  const callMove = useMemo(() => {
    if (selectedJob || typeof consensus !== 'number') return null;
    const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
    let prior: number | null = null;
    for (const point of chartSeries) {
      const at = new Date(point.at).getTime();
      if (Number.isFinite(at) && at <= cutoff) prior = point.consensus;
    }
    if (prior === null) return null;
    const move = consensus - prior;
    return Math.abs(move) < 1e-9 ? null : move;
  }, [chartSeries, consensus, now, selectedJob]);
  /* Only ever the other BRANCH: same metric, same window, two worlds, so
     the gap is the priced impact. The other horizon measures a different
     window and shares no scale with this one (2026-08-15), so it gets its
     own chart below rather than a line on this axis. */
  const chartSecondary = useMemo(
    () =>
      selectedJob && otherBranch && otherBranch.consensus !== null
        ? {
            series: otherBranch.history,
            consensus: otherBranch.consensus,
            label: branch === 'approved' ? 'if declined' : 'if approved',
            tone: branch === 'approved' ? ('lower' as const) : ('higher' as const),
          }
        : null,
    [selectedJob, otherBranch, branch],
  );

  // Year chart: the hero metric's REAL value over the calendar year (solid),
  // continued to where the market sees it settling (dashed, to the resolve
  // date). The x-axis is the year, not the trading timeline, so this is its
  // own chart below the market poster, drawn in the same visual family.
  const _heroActualHistory = useMemo(() => {
    return (ws?.heroHistory ?? [])
      .filter(p => p.at && Number.isFinite(p.value))
      .slice()
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [ws?.heroHistory]);

  // The chart model for the one horizon the floor shows, from ITS metric's
  // logged history against ITS settle date.
  // The definition editor (owner ask 2026-08-18). Saving is destructive to
  // the open market by design (definition-change invariant server-side), so
  // the UI states that and the button says "reopen".
  const [editingDef, setEditingDef] = useState(false);
  const [defDraft, setDefDraft] = useState('');
  const [defSaving, setDefSaving] = useState(false);
  const [defErr, setDefErr] = useState('');
  const saveDefinition = async () => {
    // The edit targets the metric of the market ON SCREEN, never the
    // workspace's hero metric: with two clocks up, saving through
    // ws.heroMetricId rewrote the other market's settlement text
    // (owner report 2026-08-21).
    if (!hero?.metricId || !ws) return;
    setDefSaving(true);
    setDefErr('');
    try {
      await api.updateMetricDescription(hero.metricId, defDraft, ws.workspaceId);
      setEditingDef(false);
      reload();
    } catch (e) {
      setDefErr((e as Error).message);
    } finally {
      setDefSaving(false);
    }
  };

  // The definition belongs to the market on screen. The workspace-level
  // heroMetricDescription is only a fallback when the on-screen market IS the
  // hero metric; borrowed under any other clock it would caption one market
  // with another's settlement text.
  const horizonDescription =
    hero?.description ?? (hero && hero.metricId === ws?.heroMetricId ? (ws?.heroMetricDescription ?? null) : null);

  if (error) {
    return (
      <div className="pubws pubws--center">
        <TopBar user={!!user} ready={!authLoading} />
        <main className="pubws-main">
          <section className="pubws-status">
            <p className="pubws-pitch">{error}</p>
            <p className="pubws-pitch">
              <Link to="/marketplace">See the open markets</Link>
            </p>
          </section>
        </main>
      </div>
    );
  }

  if (!ws) {
    // While the floor loads (docs/ui-conventions.md, "While a page loads"):
    // the three columns as ghosts in the real geometry, the name from the
    // share hint painted at once in the headline slot, never a dot.
    return (
      <div className="pubws pubws--center">
        <TopBar user={!!user} ready={!authLoading} busy />
        <main className="pubws-main pubws-main--floor pubws-main--ghost">
          <div className="pubws-center">
            <header className="pubws-ident">
              {hint ? (
                <>
                  <h1 className="pubws-ws-name">{hint.name}</h1>
                  {hint.description && (
                    <span className="pubws-ws-info">
                      <span className="pubws-ws-info-btn" aria-hidden="true">
                        i
                      </span>
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Ghost w={180} h={34} style={{ margin: '4px auto 0' }} />
                  <Ghost w={220} h={12} style={{ margin: '12px auto 0' }} />
                </>
              )}
            </header>
            <div className="pubws-ghost-instrument" aria-hidden="true">
              <Ghost w={300} h={30} r={8} style={{ margin: '24px auto 0' }} />
              <Ghost w={320} h={30} r={8} style={{ margin: '8px auto 0' }} />
              <Ghost w="60%" h={20} style={{ margin: '24px auto 0' }} />
              <Ghost w="46%" h={20} style={{ margin: '8px auto 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
                <Ghost w={90} h={34} />
                <Ghost w={90} h={34} />
              </div>
              <Ghost w="100%" h={200} r={6} style={{ marginTop: 20 }} />
              <div style={{ display: 'flex', gap: 14, marginTop: 22 }}>
                <Ghost w="50%" h={58} r={10} />
                <Ghost w="50%" h={58} r={10} />
              </div>
              {/* The two standings footers under the verbs, in the market
                  column where they land. */}
              <div className="pubws-ghost-standings" aria-hidden="true">
                <div>
                  <Ghost w={90} h={9} style={{ marginBottom: 8 }} />
                  <GhostRows n={3} />
                </div>
                <div>
                  <Ghost w={110} h={9} style={{ marginBottom: 8 }} />
                  <GhostRows n={3} />
                </div>
              </div>
            </div>
            <LoadingStatus />
          </div>
          {/* The left column: the definition, the season advert, the
              announcements, in the geometry they land in. */}
          <aside className="pubws-rail pubws-rail--left" aria-hidden="true">
            <Ghost w={120} h={9} style={{ marginBottom: 12 }} />
            <Ghost w="100%" h={12} style={{ marginBottom: 8 }} />
            <Ghost w="92%" h={12} style={{ marginBottom: 8 }} />
            <Ghost w="70%" h={12} style={{ marginBottom: 28 }} />
            <Ghost w={150} h={26} style={{ marginBottom: 10 }} />
            <Ghost w="80%" h={12} style={{ marginBottom: 10 }} />
            <Ghost w={110} h={28} r={8} style={{ marginBottom: 28 }} />
            <Ghost w={100} h={9} style={{ marginBottom: 12 }} />
            <Ghost w="100%" h={12} />
          </aside>
          <aside className="pubws-rail pubws-rail--right" aria-hidden="true">
            <Ghost w={90} h={9} style={{ marginBottom: 8 }} />
            <GhostRows n={7} />
          </aside>
        </main>
      </div>
    );
  }

  const canTrade = ws.joinAs === 'trader';
  const trading = !!user && joined && canTrade;

  return (
    <div className="pubws pubws--center">
      <TopBar
        user={!!user}
        ready={!authLoading}
        floor={idOrSlug ? { idOrSlug, name: ws.name } : null}
        canFund={canManage}
      />
      {/* Otto, in the corner rather than in the column (owner direction
          2026-08-20): a reader needs him at whatever point of the page their
          question arrives, and the page's job is the market. */}
      {idOrSlug && (
        <FloorChat
          idOrSlug={idOrSlug}
          workspaceName={ws.name}
          metricLabel={selectedJob ? null : metricLabel}
          signedIn={!!user}
          dockLabel={
            !user
              ? `Ask Otto about ${ws.name}`
              : canManage
                ? `Have Otto run ${ws.name} with you`
                : `Have Otto trade ${ws.name} with you`
          }
          handoff={
            <AgentDoors
              floor={{ idOrSlug: idOrSlug ?? ws.workspaceId, name: ws.name }}
              workspaceId={ws.workspaceId}
              state={ownerState}
              canManage={canManage}
              signedIn={!!user}
              className="doors--in-otto"
            />
          }
          open={askingOtto}
          onOpenChange={setAskingOtto}
        />
      )}
      {/* `pubws-main--context` marks the plain view, where the left column
          carries "What is this market?": the stylesheet uses it to hide the
          summary line under the question once the three-column layout puts
          the definition beside the market (docs/ui-conventions.md, "The
          rails, and the standings under the verbs": the definition is on
          screen once, never twice). */}
      <main className={`pubws-main pubws-main--floor${selectedJob ? '' : ' pubws-main--context'}`}>
        <div className="pubws-center">
          {/* The company IS the page (owner direction 2026-08-18): a cold
            visitor arrives from a link about this business, not about
            Telarchy, and cannot parse "What is LookPilot net 2026" as a
            first impression. So the identity block leads (name, then the
            workspace description as the one line of what it sells) and the
            market below it reads as a number about something named. The
            name was already here as a grey eyebrow, which read as a
            breadcrumb rather than as a real business. Fixed across job
            selection: only the instrument below it swaps. */}
          {ws.name && (
            <header className="pubws-ident pubws-enter">
              <div className="pubws-ident-line">
                <h1 className="pubws-ws-name">{ws.name}</h1>
                {/* What the company sells, behind an (i) rather than as a line
                  of prose under the name (owner ask 2026-09-10). Since
                  2026-09-11 the press opens it INLINE under the name, in
                  normal flow, so the headline never paints over it (the
                  popup it replaced, design critic finding 1). Closed by
                  default, never on hover. Outside the h1, so the heading's
                  accessible name stays the company's name. */}
                {ws.description && (
                  <span className="pubws-ws-info">
                    <button
                      type="button"
                      className="pubws-ws-info-btn"
                      aria-label={`What ${ws.name} is`}
                      aria-expanded={wsWhatOpen}
                      aria-controls="pubws-ws-what"
                      onClick={() => setWsWhatOpen(v => !v)}
                    >
                      i
                    </button>
                  </span>
                )}
              </div>
              {ws.description && (
                <div id="pubws-ws-what" className="pubws-ws-what" hidden={!wsWhatOpen}>
                  <Linkified text={ws.description} />
                </div>
              )}
            </header>
          )}
          {/* The publish band (owner asks 2026-08-28: a real, visible
            button, and nothing publishes without a metric). Only the owner
            sees it, only on a not-yet-public floor, and it says the one
            precondition honestly instead of offering a button that the
            server would refuse. */}
          {canManage && ws.visibility && ws.visibility !== 'public' && (
            <section className="pubws-publish pubws-enter" aria-label="Publish this market">
              <p className="pubws-publish-title">Only people with the link can see this market</p>
              {(ws.metricCount ?? 0) > 0 ? (
                <>
                  <p className="pubws-publish-sub">
                    Publish it and it joins the telarchy.com list, open for anyone to trade.
                  </p>
                  <button
                    type="button"
                    className="pubws-cta pubws-publish-go"
                    disabled={publishBusy}
                    onClick={() => {
                      setPublishBusy(true);
                      api
                        .updateWorkspaceSettings(ws.workspaceId, { visibility: 'public' })
                        .then(reload)
                        .catch(e => console.error('publish failed:', e))
                        .finally(() => setPublishBusy(false));
                    }}
                  >
                    {publishBusy ? 'Publishing…' : 'Publish this market'}
                  </button>
                </>
              ) : (
                <p className="pubws-publish-sub">
                  Add a number first: a market with no metric has nothing to trade. The publish button appears the
                  moment one exists.
                </p>
              )}
            </section>
          )}
          {/* A floor with no market yet. For its owner this is the moment
            after "Create your own" (docs/owner-on-the-floor.md): the first
            metric is one dialog away, and it chains straight into its date,
            because a metric with no date has no market. Everyone else sees
            the honest state, not a broken page. */}
          {!hero && (
            <section className="pubws-instrument pubws-enter" aria-label="No market yet">
              {canManage ? (
                <>
                  <p className="pubws-na-note">No number here yet. The market starts the moment you add one.</p>
                  <div className="pubws-act">
                    <button type="button" className="pubws-cta" onClick={() => setOwnerDialog({ kind: 'new-metric' })}>
                      Add your first metric
                    </button>
                  </div>
                  {/* The other way to do the same work: hand it to the agent
                    they already talk to (docs/owner-on-the-floor.md,
                    "Handing it to your own agent"). Under the button rather
                    than beside it, because clicking it yourself is still the
                    shorter path for one metric. */}
                  <AgentDoors
                    floor={{ idOrSlug: idOrSlug ?? ws.workspaceId, name: ws.name }}
                    workspaceId={ws.workspaceId}
                    state={ownerState}
                    canManage={canManage}
                    signedIn={!!user}
                    onAskOtto={() => setAskingOtto(true)}
                    setupWords
                    className="doors--empty"
                  />
                </>
              ) : (
                <p className="pubws-na-note">Nothing is priced here yet. The owner has not added a number.</p>
              )}
            </section>
          )}
          {hero && active && (
            <section className="pubws-instrument" aria-label="The market">
              {/* Selecting a job re-points this one view at its conditional
                market; the condition is stated above the same headline so
                the page never grows a second market. */}
              {/* The whole title: what is being predicted, as of when. The
                metric's parenthetical unit tail is trimmed for display only
                (the full name stays in the API); renaming the metric itself
                would void the live market by the definition-change invariant.
                With a job selected the title becomes the actual question the
                conditional market prices, naming who gets paid and how much,
                because that is the whole bet. */}
              {/* Above the clock line, not between it and the world line:
                the caption and the condition under it are one statement, and
                a control wedged between them splits it. Says where it goes
                rather than repeating the metric the caption already names. */}
              {selectedJob && (
                <button className="pubws-back" onClick={() => setSelectedJobId(null)}>
                  ← Back to the market
                </button>
              )}
              {/* The clock line renders in BOTH states (owner design
                2026-08-20). Opening a proposal used to replace it, which took
                the arrows away and pinned the page to markets[0], so a
                proposal's number depended on the horizon the reader happened
                to be on before they clicked in. Rendered once here, never
                copied into the branch below, because a second copy is how the
                two drift. */}
              {/* Two strips, metrics then dates (docs/ui-conventions.md, "The
               question line", revised 2026-09-09, replacing the two dropdown
               chips of 2026-09-04): each tab is its name over that market's
               current call, so a reader learns how many books this floor
               prices and what every one of them says without pressing
               anything. A (metric, date) pair is a market, so selection is
               still one market id, and the owner's way into the metrics and
               the dates is the last tab of its strip. */}
              {/* A picker with one option is not rendered, for the owner
                either (docs/ui-conventions.md, "The question line",
                2026-09-11); the entries whose strip is gone sit in the
                owner row under the strips, so the rule hides a picker and
                never an owner action. */}
              <FloorStrip
                ariaLabel="Metrics"
                kind="metric"
                /* With a proposal open the strip stops showing levels and
                   shows what THIS proposal does to each number
                   (docs/ui-conventions.md, "A proposal is a decision with a
                   price", 2026-09-09): a proposal ships a pair for every cell
                   of the grid, and that grid was never on screen before. */
                tabs={metricHeads.map(m => {
                  const cellPair = selectedJob ? pairAt(selectedJob, hero?.targetDate, m.metricId) : null;
                  const dry = !!selectedJob && !hasLiquidity(cellPair);
                  return {
                    id: m.metricId,
                    label: captionLabel(m.metricLabel, ws.name),
                    /* A metric is an AXIS, not a market, so its tab is a name
                       and nothing else in every view (owner ask 2026-09-10,
                       of the proposal view: "but again donet show any numbers
                       here"). Whatever number stood here was really about the
                       date selected below. */
                    value: undefined,
                    disabled: dry,
                    title: dry ? 'no liquidity' : undefined,
                    selected: hero?.metricId === m.metricId,
                  };
                })}
                onPick={id => {
                  const cell = cellOf(horizons, id, hero?.targetDate, keptCells);
                  if (cell) setHorizonId(cell.marketId);
                }}
                manage={canManage && metricHeads.length >= 2 ? manageMetrics : null}
              />
              {hero && (
                <FloorStrip
                  ariaLabel="Dates"
                  kind="date"
                  tabs={heroDates.map(d => {
                    const datePair = selectedJob ? pairAt(selectedJob, d.targetDate, d.metricId) : null;
                    const dry = !!selectedJob && !hasLiquidity(datePair);
                    return {
                      id: d.marketId,
                      label: d.label,
                      value: selectedJob
                        ? dry
                          ? 'no liquidity'
                          : impactLabel(datePair, d.unit)
                        : d.consensus !== null
                          ? `${d.unit}${formatValue(d.consensus)}`
                          : null,
                      disabled: dry,
                      selected: d.marketId === hero.marketId,
                      title: d.resolvesOn ? `settles ${settleInstant(d.resolvesOn)}` : undefined,
                    };
                  })}
                  onPick={id => setHorizonId(id)}
                  manage={canManage && hero.metricId && heroDates.length >= 2 ? manageDates : null}
                />
              )}
              {canManage && hero && (metricHeads.length < 2 || heroDates.length < 2) && (
                <div className="pubws-strip-owner" role="group" aria-label="Manage this floor">
                  {metricHeads.length < 2 && (
                    <button
                      type="button"
                      className="pubws-strip-tab pubws-strip-tab--manage"
                      onClick={manageMetrics.open}
                    >
                      <span className="pubws-strip-name">{manageMetrics.label}</span>
                    </button>
                  )}
                  {heroDates.length < 2 && hero.metricId && (
                    <button
                      type="button"
                      className="pubws-strip-tab pubws-strip-tab--manage"
                      onClick={manageDates.open}
                    >
                      <span className="pubws-strip-name">{manageDates.label}</span>
                    </button>
                  )}
                </div>
              )}
              {/* The question line (owner ask 2026-08-28): under the pickers,
               the selected cell stated as the market's own sentence, "What
               will be {company}'s {metric} {date}?", so a newcomer is not
               left assembling the question from an uppercase caption and a
               row of tabs. The pickers STAY above it (owner ask 2026-08-28,
               "they both should be there"): the rows are where every option
               is visible, the sentence is what the selection means. Its
               metric and date are cycle words too: clicking one steps to the
               next option and LOOPS (the 2026-08-20 arrow rule); with one
               option the word is plain text. With a proposal selected the
               SAME sentence carries the condition ("...if Ada is paid $80
               to do: rewrite the store page?", owner ask 2026-08-28: modify
               the question, do not add a second line under it), which is
               why the "?" moves to the true end. Doc: docs/ui-conventions.md,
               "The question line". */}
              {/* A proposal is a decision, not a variant of the metric's
                question (docs/ui-conventions.md, "A proposal is a decision
                with a price", 2026-09-09): its title is the headline and its
                four facts are one icon row under it. The conditional sentence
                it replaces made a reader parse a number, a proposer, a price
                and a task as one clause before anything was on screen. */}
              {selectedJob && (
                <div className="pubws-proposal-head pubws-enter pubws-enter--1">
                  <h2 className="pubws-proposal-title">
                    {selectedJobRuling && (
                      <span className={`pubws-ballot-status is-${selectedJobRuling}`}>{selectedJobRuling}</span>
                    )}
                    {selectedJob.number ? <span className="pubws-ballot-num">#{selectedJob.number}</span> : null}
                    {splitAsk(selectedJob.title).rest}
                  </h2>
                  <div className="pubws-prow-meta">
                    {selectedJob.proposedByName && (
                      <span title={`Proposed by ${selectedJob.proposedByName}`}>
                        <PersonGlyph />
                        {selectedJob.proposedByName}
                      </span>
                    )}
                    <span title={!jobAskUsd ? 'No payment asked' : `$${jobAskUsd} to them if you approve it`}>
                      <CoinGlyph />
                      {!jobAskUsd ? 'no payment asked' : `$${jobAskUsd} if approved`}
                    </span>
                    {selectedJobClosed ? (
                      <span
                        aria-label="Decision deadline"
                        title={instantOf(
                          selectedJob.resolvedAt ?? selectedJob.lapsedAt ?? selectedJob.closedAt ?? null,
                        )}
                      >
                        <ClockGlyph />
                        {/* The ruling's word and its instant to the second
                            (docs/ui-conventions.md, "A proposal past its
                            deadline reads as closed before the ruling lands"). */}
                        {selectedJobRuling ?? 'decided'}{' '}
                        {clockSecondsOf(
                          selectedJob.resolvedAt ?? selectedJob.lapsedAt ?? selectedJob.closedAt ?? null,
                        ) || dayOf(selectedJob.resolvedAt ?? selectedJob.closedAt ?? null)}
                      </span>
                    ) : (
                      selectedJob.decideBy && (
                        <span
                          className={`pubws-chip--deadline${deadlineUrgent ? ' is-urgent' : ''}`}
                          aria-label="Decision deadline"
                          title={`The owner decides by ${instantOf(selectedJob.decideBy)}, or it declines itself`}
                        >
                          <ClockGlyph />
                          {/* A date is no use when the answer is due this
                            afternoon: under a day this counts down, red
                            inside the last hour (whenOf). */}
                          decides {whenOf(selectedJob.decideBy)}
                        </span>
                      )
                    )}
                    {jobPool !== null && (
                      <span title={`${Math.round(jobPool).toLocaleString()} credits behind this proposal`}>
                        <DropGlyph />
                        {Math.round(jobPool).toLocaleString()} behind it
                      </span>
                    )}
                  </div>
                </div>
              )}
              {/* The address named a proposal that is not here (docs/ui-
                conventions.md, "An address that names no proposal says so",
                2026-09-10): one quiet line, and the plain floor under it. */}
              {!selectedJob && missingNumber !== null && (
                <p className="pubws-proposal-missing" role="status">
                  No proposal #{missingNumber} on this floor.
                </p>
              )}
              {!selectedJob && (
                <h2 className={`pubws-instrument-ask pubws-enter pubws-enter--1${flashContract ? ' is-flashed' : ''}`}>
                  What will be {ws.name ? `${possessiveOf(ws.name)} ` : ''}
                  <CycleWord
                    what="Metric"
                    options={metricHeads.map(m => ({
                      key: m.metricId,
                      label: sentenceCase(captionLabel(m.metricLabel, ws.name)),
                    }))}
                    activeKey={hero.metricId}
                    onStep={metricId => {
                      const cell = cellOf(horizons, metricId, hero?.targetDate, keptCells);
                      if (cell) setHorizonId(cell.marketId);
                    }}
                  />
                  {/* The tail never breaks inside: "on 30 Sep?" wrapping after
                 the preposition read broken on the desktop column, and an
                 inline-block child ignores a no-break space before it, so
                 the group is held together by nowrap instead. */}{' '}
                  <span className="pubws-ask-tail">
                    {askDateOf(hero).lead}
                    <CycleWord
                      what="Date"
                      options={heroDates.map(d => ({
                        key: d.marketId,
                        label: askDateOf(d).word,
                        title: d.resolvesOn ? `settles ${settleInstant(d.resolvesOn)}` : undefined,
                      }))}
                      activeKey={hero.marketId}
                      onStep={marketId => setHorizonId(marketId)}
                    />
                    ?
                  </span>
                </h2>
              )}
              {/* The live price rides the market chart's control row (owner
                ask 2026-08-28, Manifold scale); only a market with no price
                yet keeps the centred line, where the charts would be. */}
              {consensus === null && (
                <div className="pubws-headline pubws-enter pubws-enter--2">
                  <span className="pubws-price">no price yet</span>
                  {/* The settle day is said once, and since 2026-09-09 that
                    once is the stat row's caption. A market with no price
                    prints no stat row, so it carries the day here instead:
                    the day never leaves the page (owner rule 2026-08-25). */}
                  {settleNote && <span className="pubws-stat-what">{settleNote}</span>}
                </div>
              )}
              {/* A market nobody has traded yet has no replayed history, which
                used to mean no chart at all: selecting a fresh job showed a
                price and blank space. A market always has a call, so fall
                back to that single point and let the chart hold it. */}
              {hero?.settlesNaForNow && (
                <p className="pubws-na-note pubws-enter pubws-enter--2">{settleNoteOf(hero)}</p>
              )}
              {consensus !== null && hero && (
                <div className="pubws-enter pubws-enter--3">
                  {/* One chart is the hero (docs/ui-conventions.md, "The price
                    and the chart", 2026-09-03): the two numbers named side by
                    side, the number's own chart with the market's call on it,
                    and how the call moved as a strip below. The N/A caveat is
                    the only settle note left under the stat row. */}
                  {/* A proposal is priced on its IMPACT, so the impact is the hero
                                      and the two worlds are the control under it
                                      (docs/ui-conventions.md, "A proposal is a decision with a
                                      price", 2026-09-09). The baseline stays as the first cell,
                                      because a pair can only be read against it. */}
                  {selectedJob ? (
                    <>
                      <div className="pubws-impact">
                        {/* What the number is a comparison OF: "+$614" alone
                          was read as growth from today, or as profit after
                          the ask was paid (review 2026-09-10). */}
                        <span className="pubws-impact-what">
                          {sentenceCase(captionLabel(metricLabel, ws.name))} {dateQuestionOf(hero).lead}
                          {dateQuestionOf(hero).word}, approved versus declined
                        </span>
                        <p
                          className={`pubws-impact-hero${
                            jobImpact === null || jobImpact === 0 ? '' : jobImpact > 0 ? ' is-up' : ' is-down'
                          }`}
                        >
                          {jobImpact === null
                            ? 'not yet priced'
                            : jobImpact === 0
                              ? `\u00b1${impactUnit}0`
                              : formatDelta(jobImpact, impactUnit)}
                        </p>
                      </div>
                      <div className="pubws-worlds" role="group" aria-label="Which world">
                        <div className="pubws-world-cell pubws-world-cell--now">
                          {/* The last logged READING. It said "now" until
                            2026-09-10, when the chart's baseline said "now"
                            too, 8% away from it. */}
                          <span className="pubws-stat-what">
                            {readingWhen ? `last read \u00b7 ${readingWhen}` : 'last read'}
                          </span>
                          <span className="pubws-price">
                            {nowReading !== null ? `${unit}${formatValue(nowReading)}` : 'no reading yet'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={`pubws-world-cell pubws-world-cell--approved${branch === 'approved' ? ' is-active' : ''}`}
                          /* The cell's own words carry the settle note and the
                             price; the branch is what the control IS, so it is
                             what a screen reader and a test are told. */
                          aria-label="if approved"
                          aria-pressed={branch === 'approved'}
                          onClick={() => setBranch('approved')}
                        >
                          <span className="pubws-stat-what">
                            if approved
                            {selectedJobClosed
                              ? ' \u00b7 at the decision'
                              : hero?.resolvesOn
                                ? ` \u00b7 ${forecastDayOf(hero.resolvesOn)}`
                                : null}
                          </span>
                          <span className="pubws-price">
                            {pair?.approvedConsensus !== null && pair?.approvedConsensus !== undefined
                              ? `${unit}${formatValue(pair.approvedConsensus)}`
                              : 'no price yet'}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`pubws-world-cell pubws-world-cell--declined${branch === 'declined' ? ' is-active' : ''}`}
                          aria-label="if declined"
                          aria-pressed={branch === 'declined'}
                          disabled={!pair?.declinedMarketId}
                          onClick={() => setBranch('declined')}
                        >
                          <span className="pubws-stat-what">
                            if declined
                            {selectedJobClosed
                              ? ' \u00b7 at the decision'
                              : hero?.resolvesOn
                                ? ` \u00b7 ${forecastDayOf(hero.resolvesOn)}`
                                : null}
                          </span>
                          <span className="pubws-price">
                            {pair?.declinedConsensus !== null && pair?.declinedConsensus !== undefined
                              ? `${unit}${formatValue(pair.declinedConsensus)}`
                              : 'no price yet'}
                          </span>
                        </button>
                      </div>
                      {/* The question the two markets answer, UNDER the worlds
                        and above the chart (docs/ui-conventions.md, "A
                        proposal is a decision with a price", revised
                        2026-09-10). It names neither the proposer nor the
                        task: the title carries both a few lines up, and the
                        conditional sentence this restores was removed for
                        putting all of it in one clause ahead of any number. */}
                      <p className="pubws-proposal-q">
                        If {branch}, what will {ws.name}'s {sentenceCase(captionLabel(metricLabel, ws.name))} be{' '}
                        {dateQuestionOf(hero).lead}
                        {dateQuestionOf(hero).word}?
                      </p>
                    </>
                  ) : (
                    <div className="pubws-stats">
                      {/* The reading, ink: the value in force with its age,
                      because a reading is only trustworthy with its age on it. */}
                      <div className="pubws-stat-block pubws-stat--now">
                        {/* The caption line FIRST (revised 2026-09-04, the home
                        board's cell shape): what the number is and its age,
                        then the value under it. */}
                        <span className="pubws-stat-what">
                          now
                          {attempt !== null && ` · attempt ${attempt}`}
                          {lastReading?.at && (
                            <>
                              {' · '}
                              <span className="pubws-updated" title={instantOf(lastReading.at)}>
                                read {timeAgoOf(lastReading.at, now) ?? ''}
                              </span>
                            </>
                          )}
                        </span>
                        <span className="pubws-price">
                          {nowReading !== null ? `${unit}${formatValue(nowReading)}` : 'no reading yet'}
                        </span>
                      </div>
                      {/* The market's call, amber: the consensus, its name, the
                      day it is for and the countdown. A proposal's impact chip
                      rides beside the value: the impact is the proposal's one
                      number, and silence read as a broken page. Bare arrow +
                      delta (owner ask 2026-08-28). */}
                      <div
                        className="pubws-stat-block pubws-stat--call"
                        aria-label={selectedJob ? `Market's call if ${branch}` : undefined}
                      >
                        <span className="pubws-stat-what">
                          market's call
                          {selectedJob ? ` if ${branch}` : ''}
                          {selectedJobClosed ? ' at the decision' : ''}
                          {settleNote && <>{' · '}</>}
                          {settleNote}
                        </span>
                        <span className="pubws-stat-value">
                          <span className="pubws-price">
                            <AnimatedNumber value={consensus} render={v => `${unit}${formatValue(v)}`} />
                          </span>
                          {!selectedJob && callMove !== null && (
                            <span
                              key={`mv-${Math.round(callMove * 100)}`}
                              className={`pubws-delta-chip ${callMove >= 0 ? 'is-up' : 'is-down'}`}
                              title="since yesterday"
                            >
                              {callMove >= 0 ? '▲' : '▼'} {formatDelta(callMove, unit)}
                            </span>
                          )}
                          {selectedJob &&
                            (jobImpact === null ? (
                              <span className="pubws-delta-chip">not yet priced</span>
                            ) : jobImpact === 0 ? (
                              <span className="pubws-delta-chip">±{impactUnit}0</span>
                            ) : (
                              <span
                                key={`imp-${Math.round(jobImpact)}`}
                                className={`pubws-delta-chip ${jobImpact >= 0 ? 'is-up' : 'is-down'}`}
                              >
                                {jobImpact >= 0 ? '▲' : '▼'} {formatDelta(jobImpact, impactUnit)}
                              </span>
                            ))}
                        </span>
                      </div>
                    </div>
                  )}
                  {/* The number chart, the hero: titled by the metric itself
                    (caption-shaped), its left cell empty because the stats
                    are above, a legend naming the marks below. */}
                  <div className="pubws-numchart">
                    {chartView === 'live' && liveFeed ? (
                      <LiveView
                        kind={liveFeed.kind}
                        slug={ws.slug ?? idOrSlug ?? ws.workspaceId}
                        onState={setLiveState}
                        corner={chartModeToggle}
                        center={<span className="pubws-chart-cap">{captionLabel(metricLabel, ws.name)}</span>}
                        /* The feed drives the floor (docs/ui-conventions.md): a
                           step or a ruling on the feed reloads the payload at
                           once; a chevron selects its proposal like a row. */
                        onStep={() => reload()}
                        onPickProposal={n => setSelectedJobId(String(n))}
                        onQuotes={q => setFeedQuotes(q)}
                      />
                    ) : chartView === 'decisions' ? (
                      <>
                        <NumberChart
                          points={hero.metricHistory}
                          markers={datesOf(horizons, hero.metricId, keptCells).flatMap(d =>
                            d.resolvesOn
                              ? [
                                  {
                                    marketId: d.marketId,
                                    resolvesOn: d.resolvesOn,
                                    consensus: d.consensus,
                                    selected: d.marketId === hero.marketId,
                                  },
                                ]
                              : [],
                          )}
                          forks={decisionForks}
                          openForkId={openFork?.id ?? null}
                          onPickFork={setPickedForkId}
                          selectedResolvesOn={hero.resolvesOn ?? new Date().toISOString()}
                          granularity={granularityOf(hero.targetDate)}
                          unit={unit}
                          now={now}
                          center={<span className="pubws-chart-cap">{captionLabel(metricLabel, ws.name)}</span>}
                          corner={chartModeToggle}
                          onPickDate={setHorizonId}
                        />
                        {openFork && (
                          <p className="nchart-fork-caption">
                            {openFork.label !== openFork.title && <span className="hist-num">{openFork.label}</span>}
                            {openFork.title} · {openFork.verdict} {dayOf(openFork.at)}
                            {openFork.number != null && (
                              <>
                                {' · '}
                                <Link to={`/${ws.slug ?? idOrSlug}/p/${openFork.number}`}>open the proposal</Link>
                              </>
                            )}
                          </p>
                        )}
                      </>
                    ) : chartView === 'value' ? (
                      <NumberChart
                        points={hero.metricHistory}
                        markers={datesOf(horizons, hero.metricId, keptCells).flatMap(d => {
                          if (!d.resolvesOn) return [];
                          // The open proposal's pair on this date, by (metric, date).
                          const pr = selectedJob?.markets.find(
                            m =>
                              m.targetDate === d.targetDate && (m.metricId === undefined || m.metricId === d.metricId),
                          );
                          return [
                            {
                              marketId: d.marketId,
                              resolvesOn: d.resolvesOn,
                              consensus: d.consensus,
                              selected: d.marketId === hero.marketId,
                              pair: pr ? { approved: pr.approvedConsensus, declined: pr.declinedConsensus } : null,
                            },
                          ];
                        })}
                        impactFrom={branch}
                        marksLegend
                        legend={
                          selectedJob
                            ? {
                                approved: `if ${selectedJob.proposedByName ?? 'someone'} is paid $${selectedJob.askUsd ?? splitAsk(selectedJob.title).ask ?? 0}`,
                                declined: 'if not',
                              }
                            : null
                        }
                        selectedResolvesOn={hero.resolvesOn ?? new Date().toISOString()}
                        granularity={granularityOf(hero.targetDate)}
                        unit={unit}
                        now={now}
                        preview={chartPreview}
                        center={<span className="pubws-chart-cap">{captionLabel(metricLabel, ws.name)}</span>}
                        corner={chartModeToggle}
                        onPickDate={setHorizonId}
                      />
                    ) : (
                      <MarketChart
                        key={active.marketId}
                        series={chartSeries}
                        consensus={consensus}
                        unit={unit}
                        ranges={['1D', '1W']}
                        center={<span className="pubws-chart-cap">{captionLabel(metricLabel, ws.name)}</span>}
                        corner={chartModeToggle}
                        preview={chartPreview}
                        orders={chartOrders}
                        secondary={chartSecondary}
                      />
                    )}
                  </div>
                  {/* The chart's footer: the market's money under the plot it
                    describes (docs/ui-conventions.md, "The price and the
                    chart", 2026-09-09). Two of the three take one word;
                    the traders keep their icon. */}
                  <div className="pubws-chartfoot">
                    <MarketMoney traders={active.traders} pool={active.pool} volume={active.volume} />
                  </div>
                </div>
              )}
              {/* What is left to reach the price, in the reader's own arithmetic
                (codex, 2026-08-20). A base rate stated as a multiplier asks
                someone to compute a ratio before they are allowed to have a
                feeling; "about $173 a day for four days" asks nothing, and
                whether that sounds greedy IS the trade. Hidden while a job is
                selected, because then the number on screen is that job's
                impact and not the market's level. */}
              {!selectedJob && gap && (
                <p className="pubws-gap pubws-enter pubws-enter--2">
                  {gap.alreadyThere ? (
                    <>
                      <b>
                        {unit}
                        {formatValue(gap.booked)}
                      </b>{' '}
                      booked already, past the market's {unit}
                      {formatValue(gap.target)} with {gap.daysLeft === 1 ? 'a day' : `${gap.daysLeft} days`} to go.
                    </>
                  ) : (
                    <>
                      <b>
                        {unit}
                        {formatValue(gap.booked)}
                      </b>{' '}
                      booked so far. Another{' '}
                      <b>
                        {unit}
                        {formatValue(gap.needed)}
                      </b>{' '}
                      reaches the market's {unit}
                      {formatValue(gap.target)}, which is about{' '}
                      <b>
                        {unit}
                        {formatValue(gap.perDay)} a day
                      </b>{' '}
                      for the {gap.daysLeft === 1 ? 'day' : `${gap.daysLeft} days`} left.
                    </>
                  )}
                </p>
              )}

              {/* The owner's own reading, under the market's number, as its
                counterpart: two numbers about the same thing, one from the
                crowd and one from the house (docs/owner-on-the-floor.md).
                Markets settle on this one, so its AGE is the whole nudge and
                it is only ever true text: no badge, no blink, no email. */}
              {canManage && !selectedJob && hero?.metricId && (
                <p className="pubws-yours pubws-enter pubws-enter--2">
                  Yours:{' '}
                  <span className="pubws-yours-val">
                    {nowReading !== null ? `${unit}${formatValue(nowReading)}` : 'not reported yet'}
                  </span>
                  <button
                    type="button"
                    className="pubws-yours-go"
                    onClick={() =>
                      setOwnerDialog({
                        kind: 'report',
                        metricId: hero.metricId,
                        metricName: metricLabel,
                      })
                    }
                  >
                    Report
                  </button>
                  <span className={`pubws-yours-age${readingIsStale ? ' is-stale' : ''}`}>
                    {readingAge
                      ? `${readingAge}${
                          readingIsStale ? ', taken before the period this market settles for' : ''
                        }${settleLeft ? ` · settles on it in ${settleLeft}` : ''}`
                      : 'this market settles on whatever you report before it closes'}
                  </span>
                </p>
              )}
            </section>
          )}

          {/* A decision pauses trading, not the conversation (owner ask
            2026-08-20, docs/vision.md "the conversation outlives the
            decision"): a decided proposal drops the bet verbs and keeps
            its thread, readable and open to new comments. */}
          {active && (trading || (canTrade && !user && !authLoading)) ? (
            <section
              className="pubws-act pubws-enter pubws-enter--3"
              aria-label={selectedJobDecided ? 'Conversation' : 'Place a trade'}
            >
              {/* Prominent, Manifold-style (owner direction 2026-08-10):
                the two filled verbs ARE the floor's call to action, green
                up first like the reference. The inline ticket they open
                keeps its own side pills for switching.

                Unless the market has no liquidity, in which case there is
                nothing to trade against and the server refuses the bet. Say
                so here rather than letting someone compose a bet and meet
                "Market has no liquidity" at submit (owner report
                2026-08-15). The number above is the baseline's prior, drawn
                so the chart is not blank; it is not a price anyone made. */}
              {!selectedJobClosed &&
                (active.funded ? (
                  /* Each verb carries the price of a share of its side, and
                     one line under the pair says what a share pays
                     (docs/ui-conventions.md, "An untouched ticket still
                     quotes both sides"). On this page the untouched state is
                     the verbs, not the ticket: the ticket only exists once a
                     verb has been pressed, and it opens with a side already
                     chosen, so quoting only inside it would still make a
                     visitor commit to a direction to learn a price. The line
                     leaves when the ticket opens, because from there the
                     fact rows say the same thing about the actual bet. */
                  <div className="pubws-bet" role="group" aria-label="Bet">
                    {/* The world rides the verb (docs/ui-conventions.md,
                        2026-09-09): a trader who has scrolled past the world
                        cells cannot tell which of the two a button belongs
                        to, and a toggle further up the page is not an
                        answer. */}
                    <button
                      className="pubws-bet-btn pubws-bet-btn--higher"
                      disabled={selectedJobPastDeadline}
                      onClick={() => setBetModal('higher')}
                    >
                      Bet Higher ↑
                      <span className="pubws-bet-max">
                        {selectedJob
                          ? `if ${branch}${higherCeiling !== null ? ` · up to ${higherCeiling}` : ''}`
                          : higherCeiling !== null
                            ? `up to ${higherCeiling}`
                            : ''}
                      </span>
                    </button>
                    <button
                      className="pubws-bet-btn pubws-bet-btn--lower"
                      disabled={selectedJobPastDeadline}
                      onClick={() => setBetModal('lower')}
                    >
                      Bet Lower ↓
                      <span className="pubws-bet-max">
                        {selectedJob
                          ? `if ${branch}${lowerCeiling !== null ? ` · up to ${lowerCeiling}` : ''}`
                          : lowerCeiling !== null
                            ? `up to ${lowerCeiling}`
                            : ''}
                      </span>
                    </button>
                  </div>
                ) : (
                  <p className="pubws-unfunded" role="status">
                    {selectedJob
                      ? canManage
                        ? 'This proposal has no price yet. Nobody has put credits behind it: the proposer can, or you can, with Inject.'
                        : 'This proposal has no market yet. The owner funds one, or the proposer can back it themselves.'
                      : 'This market has no liquidity yet, so there is nothing to trade against.'}
                  </p>
                ))}
            </section>
          ) : null}
        </div>
        {/* The right rail: the ticket, and nothing else. */}
        <aside className="pubws-rail pubws-rail--right" aria-label="Your trade">
          {/* The rail IS the ticket (docs/ui-conventions.md, "The rails,
            and the standings under the verbs", revised 2026-09-09): what
            a trader does is on screen from the moment the page opens
            instead of waiting below the fold for a press, and the two
            verbs above seed its side rather than summoning it. Below
            1120px this same element stacks straight under the verbs, so
            the reading order is unchanged. */}
          {/* Keyed by the side so a verb re-seeds the ticket instead of being
              a dead click, exactly as the inline ticket was. */}
          {selectedJobPastDeadline && (
            /* Closed before the ruling lands (docs/ui-conventions.md, "A
               proposal past its deadline reads as closed before the ruling
               lands"): one mono line where the ticket was. */
            <p className="pubws-closed-line" role="status">
              Trading closed at the deadline. The ruling lands in a moment; this page updates on its own.
            </p>
          )}
          {active && !selectedJobClosed && !selectedJobPastDeadline && (
            <div className="pubws-ticket-inline" key={betModal ?? 'open'}>
              <TradeTicket
                probability={shownProbability}
                liquidity={active.liquidity}
                /* The ticket ALWAYS gets the held position, in both
                 modes: it is what the "New value" preview nets against
                 (buying the opposite side closes it on the server
                 first, so the buy prices against the post-close book).
                 Withholding it to hide the sell rows made the preview
                 quote a landing the trade never reached (owner report
                 2026-08-30). Hiding the rows is manageMode's job. */
                positions={trading ? positions : []}
                onTrade={placeTrade}
                onTradeTarget={placeTargetTrade}
                onSell={sellPosition}
                balance={balance}
                onPreview={setTicketPreview}
                unit={unit}
                consensus={consensus}
                rangeMin={active.rangeMin}
                rangeMax={active.rangeMax}
                orders={trading && betModal === 'manage' ? orders : []}
                onPlaceLimit={trading ? placeLimit : async () => {}}
                onCancelLimit={trading ? cancelLimit : undefined}
                onRequireSignup={trading ? undefined : () => navigate(authPath('signup', location))}
                initialDir={betModal === 'manage' || betModal === null ? undefined : betModal}
                manageMode={betModal === 'manage'}
                subject={ticketSubject}
              />
            </div>
          )}
        </aside>
        {/* Everything under the trade, in one grid item so the DOM order
            IS the phone order (docs/ui-conventions.md, "The order under
            the trade is the same at every width", 2026-09-09): the
            proposals, the propose band, how this settles, the market's
            own activity, then the standings.
         */}
        <div className="pubws-tail">
          {/* The proposal's own words and the owner's ruling, UNDER the
            trade (docs/ui-conventions.md, "A proposal is a decision with
            a price", 2026-09-09): nothing that is prose or a control
            stands between the title and the number, which is the rule the
            metric definition got the same day. */}
          {selectedJob && (
            <section
              className="pubws-proposal-words pubws-know pubws-enter pubws-enter--3"
              aria-label="What the proposer would do"
            >
              <h2 className="pubws-know-head">
                What {selectedJob.proposedByName ?? 'the proposer'} would do
                {/* Correcting a listing is a small, rare act, so it gets a
                  small, rare control (owner ask 2026-09-09): a pencil where
                  the metric definition's edit already sits, not a
                  full-width button under the prose. */}
                {canEditJob && !editingJob && (
                  <button
                    type="button"
                    className="pubws-icon-edit"
                    aria-label="Edit proposal"
                    title="Edit proposal"
                    onClick={() => {
                      const split = splitAsk(selectedJob.title);
                      setJobAsk(split.ask !== null ? String(split.ask) : '');
                      setJobTitle(split.rest);
                      setJobDesc(selectedJob.description ?? '');
                      setJobErr('');
                      setEditingJob(true);
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                )}
              </h2>
              {selectedJob && (
                <>
                  {editingJob ? (
                    /* Editing a proposal in place (owner ask 2026-08-20). The
                 words save without touching the market; the price only
                 moves while nobody has traded the pair, and the server
                 says so plainly when it will not (docs/market-integrity.md
                 I1b). Same three fields as posting one, same order. */
                    <div className="pubws-know-edit pubws-enter pubws-enter--1">
                      <label className="jobform-field">
                        <span className="ticket-label">Price (USD)</span>
                        <input
                          className="jobform-line"
                          inputMode="numeric"
                          value={jobAsk}
                          onChange={e => setJobAsk(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="0"
                          aria-label="Price in USD"
                        />
                      </label>
                      <label className="jobform-field">
                        <span className="ticket-label">What you will do</span>
                        <input
                          className="jobform-line"
                          value={jobTitle}
                          maxLength={80}
                          onChange={e => setJobTitle(e.target.value)}
                          aria-label="Proposal title"
                        />
                      </label>
                      <label className="jobform-field">
                        <span className="ticket-label">Details</span>
                        <textarea
                          className="pubws-know-edit-text"
                          rows={4}
                          value={jobDesc}
                          onChange={e => setJobDesc(e.target.value)}
                          aria-label="Proposal details"
                        />
                      </label>
                      <p className="pubws-settle">
                        Editing the words keeps the market and every position, and publishes that it changed. The price
                        can only move while nobody has traded this proposal yet.
                      </p>
                      <div>
                        <button
                          className="pubws-decide"
                          disabled={jobSaving}
                          onClick={() => {
                            void saveJobEdit();
                          }}
                        >
                          {jobSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className="pubws-decide"
                          style={{ marginLeft: '0.5rem' }}
                          disabled={jobSaving}
                          onClick={() => {
                            setEditingJob(false);
                            setJobErr('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                      {jobErr && <p className="ticket-err">{jobErr}</p>}
                    </div>
                  ) : (
                    selectedJob.description && (
                      <>
                        <p className={`pubws-details pubws-enter pubws-enter--1${descExpanded ? '' : ' is-clamped'}`}>
                          <Linkified text={selectedJob.description} />
                        </p>
                        {selectedJob.description.length > 220 && (
                          <button className="pubws-details-more" onClick={() => setDescExpanded(v => !v)}>
                            {descExpanded ? 'less' : 'more'}
                          </button>
                        )}
                      </>
                    )
                  )}
                  {/* Edited, and when: a trader who priced this proposal before
                the wording moved is entitled to know that it moved. */}
                  {!editingJob && selectedJob.editedAt && (
                    <p className="pubws-proposal-meta">edited {dayOf(selectedJob.editedAt)}</p>
                  )}
                  {/* How this decides: the mechanism, and the only place it
                is explained (Viktor, 2026-09-10, of a sentence above the
                trade: "shouldnt this just be in the market rules or
                something? seems like too much of a detail"). Generic to
                every proposal, and true to the engine: approving voids the
                declined branch and refunds it at cost, declining voids the
                approved one, and an undecided proposal lapses as a decline
                (functions/src/services/proposals.ts). */}
                  {!editingJob && (
                    <div className="pubws-decides">
                      <h3 className="pubws-know-head">How this decides</h3>
                      <p className="pubws-decides-p">
                        {!jobAskUsd
                          ? `Approving commits ${ws.name} to the work.`
                          : `Approving pays ${selectedJob.proposedByName ?? 'the proposer'} $${jobAskUsd} and commits ${ws.name} to the work.`}{' '}
                        Every number this floor prices gets two markets for this proposal, one as if it is approved and
                        one as if it is declined; the gap between them is what the market says the work is worth.
                      </p>
                      <p className="pubws-decides-p">
                        When the owner rules, the world that did not happen is voided and every credit in it is refunded
                        at what it cost, while the other keeps trading until the number itself settles.
                        {selectedJob.decideBy && !selectedJobDecided
                          ? ` Undecided by ${dayOf(selectedJob.decideBy)}, the proposal lapses and counts as declined.`
                          : ' A proposal nobody rules on by its deadline lapses and counts as declined.'}
                      </p>
                    </div>
                  )}
                  {/* The owner's press, on the floor itself (owner ask
                2026-08-11). Approve is the money verb, green; decline
                asks for the reason the charter promises to publish. */}
                  {canManage && (
                    <div className="pubws-ownerbar pubws-enter pubws-enter--1">
                      {declineReason === null ? (
                        <>
                          {/* Approve and decline are decisions, so they only
                        apply while the job is still on the ballot. */}
                          {!selectedJobDecided && (
                            <>
                              <button
                                className="pubws-decide pubws-decide--approve"
                                disabled={decideBusy}
                                onClick={() => void decide('approve')}
                              >
                                {decideBusy
                                  ? 'Deciding…'
                                  : splitAsk(selectedJob.title).ask !== null
                                    ? `Approve, pay $${splitAsk(selectedJob.title).ask}`
                                    : 'Approve'}
                              </button>
                              <button
                                className="pubws-decide pubws-decide--decline"
                                disabled={decideBusy}
                                onClick={() => setDeclineReason('')}
                              >
                                Decline
                              </button>
                              {/* What happens if the owner does nothing, and
                            nothing to press: a deadline does not move
                            (docs/market-integrity.md I1b). */}
                              {selectedJob.decideBy && (
                                <span
                                  className={`pubws-ownerbar-note${deadlineUrgent ? ' is-urgent' : ''}`}
                                  title={`Deadline ${instantOf(selectedJob.decideBy)}`}
                                >
                                  declines itself {whenOf(selectedJob.decideBy)}
                                </span>
                              )}
                            </>
                          )}
                          {/* Take it off the board entirely: spam, a duplicate, a
                        test row. Two-step, because it is not a decision and
                        cannot be undone from the UI. Every stake is
                        refunded server-side first. */}
                          {removeArmed ? (
                            <>
                              <button
                                className="pubws-decide pubws-decide--decline"
                                disabled={decideBusy}
                                onClick={() => void removeJob()}
                              >
                                {decideBusy ? 'Removing…' : 'Confirm remove'}
                              </button>
                              <button
                                className="pubws-decide"
                                onClick={() => {
                                  setRemoveArmed(false);
                                  setDecideErr('');
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="pubws-decide"
                              disabled={decideBusy}
                              onClick={() => {
                                setRemoveArmed(true);
                                setDecideErr('');
                              }}
                              title="Take this proposal off the board. Stakes are refunded."
                            >
                              Remove
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <input
                            className="pubws-decide-reason"
                            value={declineReason}
                            onChange={e => setDeclineReason(e.target.value)}
                            placeholder="Why not, published on the proposal"
                            aria-label="Decline reason"
                            autoFocus
                          />
                          <button
                            className="pubws-decide pubws-decide--decline"
                            disabled={decideBusy || declineReason.trim().length === 0}
                            onClick={() => void decide('decline')}
                          >
                            {decideBusy ? 'Deciding…' : 'Confirm decline'}
                          </button>
                          {/* Genuine idea, just not taking it: decline but refund
                        the proposer's whole stake (owner ask 2026-08-12). */}
                          <button
                            className="pubws-decide"
                            disabled={decideBusy || declineReason.trim().length === 0}
                            onClick={() => void decide('decline', true)}
                            title="Decline but refund the proposer's stake in full"
                          >
                            Decline + refund
                          </button>
                          <button
                            className="pubws-decide"
                            onClick={() => {
                              setDeclineReason(null);
                              setDecideErr('');
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {decideErr && <p className="ticket-err">{decideErr}</p>}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          {/* The proposals board sits UNDER the trade, at the column's full
              width (docs/ui-conventions.md, "The proposals board", revised
              2026-09-09, moving it out of the right rail, which the ticket
              now holds). What it gives up is the always-on-screen slot; what
              it buys is a row wide enough to be acted on. */}
          {ws.proposals !== undefined && hero ? (
            <div className="pubws-board" aria-label="Proposals">
              <JobsBoard
                historyHref={`/${ws.slug ?? idOrSlug}/history`}
                proposals={ws.proposals}
                unit={unit}
                horizonDate={hero.targetDate}
                horizonMetricId={hero.metricId}
                selectedId={selectedJobId}
                onSelect={id => setSelectedJobId(cur => (cur === id ? null : id))}
                /* Trade a proposal from the row it is read on: select it and
                   open the ticket on that side, exactly as pressing the row
                   and then a verb would (docs/ui-conventions.md, "The
                   proposals board", 2026-09-09). */
                onTrade={(id, direction) => {
                  setSelectedJobId(id);
                  setBetModal(direction);
                }}
                /* A manager rules from the row, with the confirm and the
                   published reason in place (docs/ui-conventions.md, "The
                   proposals board", 2026-09-09). The same call the bar on
                   the proposal's own page makes. */
                canManage={canManage}
                onRule={canManage ? (id, action, reason) => decide(action, false, id, reason) : undefined}
                viewerId={user?.id ?? null}
                signedIn={!!user}
                onRequireSignup={() => navigate(authPath('signup', location))}
                workspaceName={ws.name}
                proposalReward={ws.proposalReward}
                metricNames={metricNames}
                decisionMinutes={ws.decisionMinutes ?? 1440}
                onPropose={async (title, description, askUsd, decideBy) => {
                  // Anonymous proposers go through the signup door; the board
                  // itself is public information (Open workspace ballot).
                  // Payment details come from the account (owner decision
                  // 2026-08-10): the server reads and snapshots them.
                  if (!user) {
                    navigate(authPath('signup', location));
                    return;
                  }
                  // No proposer stake (owner call 2026-08-14): the workspace
                  // auto-funds the branch markets instead. Charging the empty
                  // side of the marketplace half a newcomer's starting balance
                  // to make an offer is spam defence aimed the wrong way; add
                  // it back if someone actually spams.
                  const created = (await api.createProposal({ title, description, askUsd, decideBy })) as {
                    id?: string;
                  };
                  reload();
                  // The new proposal is selected the moment it lands (docs/
                  // ui-conventions.md, "The proposer sees their own
                  // proposal"): unfunded, it sits last on the ballot, and
                  // its author otherwise reloads the floor and cannot find it.
                  if (created?.id) setSelectedJobId(created.id);
                }}
              />
            </div>
          ) : null}
          {/* "How this settles" is the metric's stored definition, verbatim,
          because it is the settlement text (owner direction 2026-08-10). It
          sits UNDER the trade since 2026-09-09 (docs/ui-conventions.md, "The
          price and the chart"): a reader meets the question, the numbers,
          the chart and the two verbs first and reads the rule when they want
          to check it. One place at every width, which is also what stopped
          it printing twice on a phone.

          Editing the definition no longer voids the market (owner
          direction 2026-08-18, docs/market-integrity.md). Every edit is
          logged instead, and the log is rendered below the definition so
          a trader can see whether the wording moved after they took
          their position. */}
          <section className="pubws-know pubws-settles pubws-enter pubws-enter--3" aria-label="How this settles">
            <h2 className="pubws-know-head">
              How this settles
              {/* Managers edit the definition in place (owner ask 2026-08-18).
              Saving keeps the market: the price, the pool and every
              position survive. What it does instead is publish the change
              here, which is the honest trade when no code can tell a
              clarification from a redefinition. */}
              {canManage && hero?.metricId && !editingDef && (
                <button
                  className="pubws-decide"
                  style={{ marginLeft: '0.6rem' }}
                  onClick={() => {
                    setDefDraft(horizonDescription ?? '');
                    setDefErr('');
                    setEditingDef(true);
                  }}
                >
                  Edit
                </button>
              )}
            </h2>
            {/* The metric's stored definition, verbatim: it is the settlement
            text (see the section comment above). This paragraph was
            hardcoded LookPilot prose from the one-workspace era; a second
            floor (telarchy, 2026-08-14) made that a lie on every other
            workspace. No fallback: a workspace whose owner wrote no
            definition shows no definition rather than someone else's. */}
            {editingDef ? (
              <div className="pubws-know-edit">
                <textarea
                  className="pubws-know-edit-text"
                  value={defDraft}
                  rows={14}
                  onChange={e => setDefDraft(e.target.value)}
                />
                <p className="pubws-settle">
                  This text is what the market settles on. Saving keeps every position and publishes the change below,
                  old wording and new.
                </p>
                <div>
                  <button
                    className="pubws-decide"
                    disabled={defSaving}
                    onClick={() => {
                      void saveDefinition();
                    }}
                  >
                    {defSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    className="pubws-decide"
                    style={{ marginLeft: '0.5rem' }}
                    disabled={defSaving}
                    onClick={() => setEditingDef(false)}
                  >
                    Cancel
                  </button>
                </div>
                {defErr && <p className="ticket-err">{defErr}</p>}
              </div>
            ) : (
              horizonDescription && (
                /* The settlement text renders as markdown (owner ask
               2026-08-21), same stack as the announcements body, plus
               remark-breaks so a plain newline is a line break: owners
               write this text over the API and a collapsed paragraph
               misquotes what the market settles on. */
                <div className="pubws-know-what">
                  <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} components={MARKDOWN_COMPONENTS}>
                    {horizonDescription}
                  </ReactMarkdown>
                </div>
              )
            )}
            {/* The actual-trajectory chart that used to sit here was removed
            on owner direction 2026-08-18: the floor no longer plots the
            metric's measured values, only the market. The history fields
            stay in the API. */}
          </section>
          {/* The market's own activity under the trade: what the reader
              holds, and the conversation. */}
          <section
            className="pubws-act pubws-act--panels"
            aria-label={selectedJobDecided ? 'Conversation' : 'Activity'}
          >
            {/* The held position stays visible on the floor; managing it
              (selling, cancelling orders) happens in the same inline
              ticket. */}
            {(positions.length > 0 || (!selectedJobClosed && orders.length > 0)) && active && (
              <PositionSummary
                positions={positions}
                orders={orders.length}
                probability={shownProbability}
                liquidity={active.liquidity}
                onManage={() => setBetModal('manage')}
                closed={selectedJobClosed ? { settlesOn: hero?.resolvesOn ?? null } : null}
              />
            )}
            {/* The conversation under whatever the one view shows: the
              baseline market's thread, or the selected job's (owner ask
              2026-08-11). */}
            {idOrSlug && (
              <FloorComments
                idOrSlug={idOrSlug}
                trailing={
                  hero && active ? (
                    /* The market ON SCREEN says what it holds, proposal
                       branches included (owner report 2026-08-31: "the
                       conditional markets should be just the same as any
                       other"). This used to be gated on `!selectedJob`, so
                       a funded branch showed no pool at all and the owner's
                       Inject vanished exactly where a thin book needed it. */
                    <MarketFacts
                      traders={active.traders}
                      pool={active.pool}
                      volume={active.volume}
                      /* The counts live in the chart's footer since
                         2026-09-09; what is left here is the owner's
                         controls beside the number they change. */
                      counts={false}
                      canManage={canManage}
                      canTrade={trading}
                      fundingHref={`/${idOrSlug ?? ''}/funding`}
                      onInject={() =>
                        setOwnerDialog({
                          kind: 'inject',
                          marketId: active.marketId,
                          /* Naming the branch matters here: the credits go
                             into one of the two worlds, and injecting into
                             the wrong one is invisible until someone trades
                             it. */
                          marketLabel: `${metricLabel} · ${dateSegmentOf(hero)}${selectedJob ? ` · if ${branch}` : ''}`,
                          pool: active.pool,
                          traders: active.traders,
                          /* A branch never respawns, so only a baseline
                             market carries the metric the second number
                             (what new markets open with) belongs to. */
                          metricId: selectedJob ? undefined : hero.metricId,
                          metricName: selectedJob ? undefined : metricLabel,
                          targetDate: selectedJob ? undefined : hero.targetDate,
                        })
                      }
                    />
                  ) : null
                }
                /* A proposal passes its proposal AND both branch markets
                 (owner reports 2026-08-15 "if there is a trade why don't I
                 see it down here", 2026-08-21 "why dont i see any trades
                 made on the conditional markets"). The conversation
                 belongs to the PROPOSAL and survives switching branch;
                 positions and trades cover BOTH branches, labeled, because
                 scoping them to the branch on screen made a proposal whose
                 trades sat on the other branch answer "Trades (0)". */
                focusCommentId={focusCommentId}
                focusTradeId={focusTradeId}
                onFocusHandled={() => {
                  setFocusCommentId(null);
                  setFocusTradeId(null);
                }}
                subject={
                  selectedJob
                    ? {
                        proposalId: selectedJob.id,
                        markets: [
                          ...(pair?.approvedMarketId
                            ? [{ marketId: pair.approvedMarketId, branch: 'approved' as const }]
                            : []),
                          ...(pair?.declinedMarketId
                            ? [{ marketId: pair.declinedMarketId, branch: 'declined' as const }]
                            : []),
                        ],
                      }
                    : hero
                      ? { marketId: hero.marketId }
                      : {}
                }
                canPost={!!user && joined}
                onRequireSignup={() => navigate(authPath('signup', location))}
              />
            )}
          </section>
          {/* Under the verbs and the facts row (docs/ui-conventions.md,
            "The rails, and the standings under the verbs", revised
            2026-09-06): the two standings footers. Footers, not rails:
            nothing about other people sits above the fold, and the counts
            appear in the facts row alone; there is no count strip. */}
          {hero && active && (
            <FloorStandings
              entries={leaders}
              contractors={ws.topContractors}
              unit={unit}
              meId={myParticipantId}
              season={season}
              proposalTraders={selectedJob ? pairHolders : undefined}
            />
          )}
          {/* Placement C (owner pick, 2026-08-31): a manager's two doors sit
            under the market and its verbs, which is where "someone should
            keep this true" is thought. A trader's pair stays further down,
            at the end of the market's own words, where researching the
            company is the job. Never both: one reader, one stack. */}
          {hero && canManage && ws && (
            <AgentDoors
              floor={{ idOrSlug: idOrSlug ?? ws.workspaceId, name: ws.name }}
              workspaceId={ws.workspaceId}
              state={ownerState}
              canManage={canManage}
              signedIn={!!user}
              onAskOtto={() => setAskingOtto(true)}
              className="doors--instrument"
            />
          )}
        </div>
        {/* The left column (docs/ui-conventions.md, "The rails, and the
            standings under the verbs", revised 2026-09-06): about THIS
            market and never about other people. From the top: the
            definition the market settles on, the season advert, the
            announcements. Its own grid item, so that on a phone the DOM
            order (market, this column, proposals, know) is the stacking
            order. Only in the plain market view: with a proposal selected
            the floor is two columns at every width and none of this is on
            the page, because a proposal's page is about the proposal and
            its two branches, not about the metric's definition (Viktor,
            2026-09-06). */}
        {!selectedJob && (
          <aside className="pubws-rail pubws-rail--left" aria-label="About this market">
            {/* The season, advertised rather than narrated: three lines, the
            money first. */}
            <SeasonAdvert season={season} signedIn={!!user} />
            {/* The owner's disclosures, under the season advert in the column
            about this market. A charter that promises
            to announce material news needs the announcements on the page the
            promise is read on, not in a thread under one market. Present only
            when the Public group grants read, the same disclosure rule as the
            ballot: `announcementCount` is absent on a counts-only floor. */}
            {ws.announcementCount !== undefined && (
              <FloorAnnouncements
                idOrSlug={idOrSlug ?? ws.workspaceId}
                latest={ws.latestAnnouncement}
                total={ws.announcementCount}
                canManage={canManage}
              />
            )}
          </aside>
        )}
        {/* What is left of the know block (docs/ui-conventions.md, "The
            rails, and the standings under the verbs", revised 2026-09-06):
            the checklist for a manager, then the subject block with the
            doors. Its own grid item under the market column: on a phone the
            left column and the proposals stack under the market BEFORE it,
            the action before the explanation, and the grid puts it back
            under the market on a wide screen. */}
        <div className="pubws-know-col">
          {/* What the floor has not settled yet, for its owner and nobody
            else (docs/owner-on-the-floor.md). Below the market and the
            owner's own prose on purpose: the floor leads with its price, and
            the checklist is what the owner reads after seeing it. */}
          <FloorChecklist workspaceId={ws.workspaceId} canManage={canManage} />
          {/* The owner's live view, directly above their own words about the
            company (docs/ui-conventions.md, "The live view"). Here and not
            over the chart because the floor leads with its price; this is
            owner material, read after the market like the rest of this
            column. Nothing when the workspace names no URL. */}
          <FloorLiveView url={ws.liveFeed ? null : ws.liveViewUrl} name={ws.name} />
          <SubjectAbout
            workspaceId={ws.workspaceId}
            name={ws.name}
            value={ws.subjectAbout}
            defaultText=""
            canManage={canManage}
            onSaved={reload}
            doors={
              canManage ? null : (
                <AgentDoors
                  floor={{ idOrSlug: idOrSlug ?? ws.workspaceId, name: ws.name }}
                  workspaceId={ws.workspaceId}
                  state={null}
                  canManage={false}
                  signedIn={!!user}
                  onAskOtto={() => setAskingOtto(true)}
                />
              )
            }
          />
        </div>

        {/* The page ends on a three-cell board (docs/ui-conventions.md, "The
            page ends", revised 2026-09-04), full width under the three
            columns. The floor stops explaining itself (2026-09-01): the
            market above SHOWS what this is, and these cells say only the
            three things it cannot: what the mechanism is for (a link to the
            guide), that a stranger may offer to do the work for real money
            (a scroll to the proposal rail, never a second control), and the
            owner's door: the company-facing sentence over the email field.
            The door is an email box, not a "waitlist" (owner direction
            2026-08-10): anyone who wants their own numbers run this way gets
            set up within days, so the copy promises contact, not a queue. */}
      </main>
      {/* Outside the floor grid on purpose: a sticky rail is constrained by
          the grid CONTAINER, not its own row, so a board inside the grid
          had the rails sliding over it (preview 2026-09-04). */}
      <div className="pubws-end-wrap">
        <section className="pubws-end" aria-label="Next steps">
          <div className="pubws-end-cell">
            <h2 className="pubws-h2 pubws-end-label">New here?</h2>
            <p className="pubws-end-line">Telarchy prices what a decision does to a number before anyone commits.</p>
            <Link className="pubws-end-go" to="/forecast">
              How it works {endArrow}
            </Link>
          </div>
          <div className="pubws-end-cell">
            <h2 className="pubws-h2 pubws-end-label">Do the work</h2>
            <p className="pubws-end-line">
              Offer to do it and name your price. The owner pays in real money if the market says it clears.
            </p>
            <button type="button" className="pubws-end-go" onClick={() => scrollToAction('contract')}>
              Offer a proposal {endArrow}
            </button>
          </div>
          <div className="pubws-end-cell">
            <h2 className="pubws-h2 pubws-end-label">Your own numbers</h2>
            <p className="pubws-end-line">See what a decision does to your numbers before you say yes.</p>
            <SetupForm source={ws.slug || idOrSlug || 'floor'} />
          </div>
        </section>
      </div>

      {/* The floor is designed to stay open, so every deploy would strand
          this tab on old code forever (owner report 2026-08-13: a fixed
          bug kept "happening" in a pre-fix tab). Offer the reload, never
          force it: yanking a composed bet or a selected branch out from
          under the visitor is worse than stale code. */}
      {/* The metrics, and the dates as rows on each metric's sheet: the
          `dates` chip opens the same dialog straight onto the metric on
          screen (docs/owner-on-the-floor.md, dialogs 1 and 2). */}
      {(ownerDialog?.kind === 'metrics' || ownerDialog?.kind === 'dates') && ws && (
        <MetricsDialog
          workspaceId={ws.workspaceId}
          markets={horizons.map(h => ({
            metricId: h.metricId,
            targetDate: h.targetDate,
            label: h.label,
            pool: h.pool,
            traders: h.traderCount ?? 0,
            tradedVolume: h.tradedVolume ?? 0,
          }))}
          defaultCredits={defaultCredits}
          spendable={(balance ?? 0) + liquidityWallet}
          initialMetricId={ownerDialog.kind === 'dates' ? ownerDialog.metricId : undefined}
          onAdd={openNewMetric}
          onClose={() => setOwnerDialog(null)}
          onDone={() => {
            setOwnerDialog(null);
            reload();
          }}
        />
      )}
      {ownerDialog?.kind === 'new-metric' && ws && (
        <NewMetricDialog
          workspaceId={ws.workspaceId}
          onClose={() => setOwnerDialog(null)}
          onCreated={m => setOwnerDialog({ kind: 'add-date', metricId: m.id, metricName: m.name })}
        />
      )}
      {ownerDialog?.kind === 'add-date' && ws && (
        <AddDateDialog
          workspaceId={ws.workspaceId}
          metricId={ownerDialog.metricId}
          metricName={ownerDialog.metricName}
          defaultCredits={defaultCredits}
          spendable={(balance ?? 0) + liquidityWallet}
          onClose={() => setOwnerDialog(null)}
          onDone={() => {
            setOwnerDialog(null);
            reload();
          }}
        />
      )}
      {ownerDialog?.kind === 'report' && ws && (
        <ReportValueDialog
          workspaceId={ws.workspaceId}
          metricId={ownerDialog.metricId}
          metricName={ownerDialog.metricName}
          unit={unit}
          lastValue={nowReading}
          lastAt={lastReading?.at ?? null}
          marketSays={hero?.consensus ?? null}
          settlesLabel={settleLeft}
          rangeMax={hero?.rangeMax ?? 1000}
          rangeEditable={metricUntraded}
          periodLabel={hero?.label ?? null}
          // Only once the period has closed: before that, "this is
          // September's number" is a forecast, and the dialog should not
          // offer to file one as a measurement.
          // Only in the window between the period ending and the market
          // settling: before it, "this is September's number" is a forecast;
          // after it, the market has already paid out on something.
          periodEnd={
            hero?.periodEnd && new Date(hero.periodEnd).getTime() <= now.getTime()
              ? new Date(new Date(hero.periodEnd).getTime() - 1000).toISOString()
              : null
          }
          onClose={() => setOwnerDialog(null)}
          onDone={() => {
            setOwnerDialog(null);
            reload();
          }}
        />
      )}
      {ownerDialog?.kind === 'inject' && ws && (
        <InjectLiquidityDialog
          workspaceId={ws.workspaceId}
          marketId={ownerDialog.marketId}
          marketLabel={ownerDialog.marketLabel}
          pool={ownerDialog.pool}
          traders={ownerDialog.traders}
          metricId={ownerDialog.metricId}
          metricName={ownerDialog.metricName}
          targetDate={ownerDialog.targetDate}
          canManage={canManage}
          defaultCredits={defaultCredits}
          onClose={() => setOwnerDialog(null)}
          onDone={() => {
            setOwnerDialog(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

export function TopBar({
  user,
  ready,
  floor = null,
  canFund = false,
  busy = false,
}: {
  user: boolean;
  ready: boolean;
  /** Whether the page under the bar is still waiting on its payload: while
   *  it is, a 2px accent hairline runs along the bar's bottom edge
   *  (docs/ui-conventions.md, "While a page loads"). */
  busy?: boolean;
  /** Which floor the reader is standing on, so account settings can hand out
   *  a prompt for THIS company rather than a generic one. */
  floor?: FloorRef | null;
  /** Whether they can put liquidity behind this market, which decides whether
   *  the wallet chip offers its plus to someone holding nothing yet. */
  canFund?: boolean;
}) {
  const navigate = useNavigate();
  // The ROUTER's location, not window's: under a basename (the beta serves at
  // /beta) window.location.pathname already carries the prefix, and navigate()
  // adds it again, so a return path built from it lands at /beta/beta/...
  const location = useLocation();
  return (
    <nav className="pubws-topbar">
      {busy && <span className="pubws-progress" aria-hidden="true" />}
      {/* The logo answers "what else is there to trade?": it opens the
          floor selection (owner ask 2026-08-14; previously the default
          floor itself, which from a floor was a no-op). */}
      <Link to="/marketplace" className="pubws-logolink" aria-label="Telarchy">
        {/* Same lockup treatment as the landing nav (3rem), so the page
            reads as the same site. */}
        <span className="pubws-logo-wide">
          <Logo variant="lockup" height="3rem" />
        </span>
        <span className="pubws-logo-phone">
          <Logo variant="mark" height="2rem" alt="" />
        </span>
      </Link>
      <div className="pubws-topbar-right">
        {!user && <ManifoldButton signedIn={false} onRequireSignup={() => navigate(authPath('signup', location))} />}
        <TopBarShortcuts />
        {/* Rendered only after the session check settles: while it is
            pending, user is still null, and a signed-in visitor would see
            "Log in" flash and vanish. Anonymous visitors get it fading in. */}
        {ready && user && (
          <div className="pubws-fade">
            <NotificationsBell />
          </div>
        )}
        {ready &&
          (user ? (
            <div className="pubws-fade">
              <AccountMenu floor={floor} canFund={canFund} />
            </div>
          ) : (
            <Link to={authPath('login', location)} className="pubws-login pubws-fade">
              Log in
            </Link>
          ))}
      </div>
    </nav>
  );
}

/**
 * The paid / not-paid phrase in the conditional headline, as the world
 * toggle itself. Both phrases occupy the same grid cell (the button sizes
 * to the longer one, so any text length is layout-stable); the active one
 * stands, the other waits below it, and a click crossfades them and
 * re-points the whole view at the other branch.
 */
/** A word of the question line that steps through its options. One option
 *  renders as a plain word; more get a button that advances to the next
 *  and LOOPS (the 2026-08-20 arrow rule), wearing the world word's dotted
 *  underline so a clickable word looks the same everywhere on the floor.
 *  The inner span re-mounts (keyed) and slides in, so a changed word is
 *  seen changing. */
function CycleWord({
  what,
  options,
  activeKey,
  onStep,
}: {
  what: string;
  options: Array<{ key: string; label: string; title?: string }>;
  activeKey: string;
  onStep: (key: string) => void;
}) {
  const idx = Math.max(
    0,
    options.findIndex(o => o.key === activeKey),
  );
  const active = options[idx];
  if (!active) return null;
  if (options.length < 2) {
    return (
      <span className="pubws-ask-word" title={active.title}>
        {active.label}
      </span>
    );
  }
  const next = options[(idx + 1) % options.length];
  return (
    <button
      type="button"
      className="pubws-ask-word pubws-ask-word--live"
      title={active.title}
      onClick={() => onStep(next.key)}
      aria-label={`${what}: ${active.label}. Show ${next.label}`}
    >
      <span key={active.key} className="pubws-ask-word-inner">
        {active.label}
      </span>
    </button>
  );
}

/** The quiet arrow after a page-end link, the home board's own. */
const endArrow = (
  <svg
    className="pubws-end-arrow"
    viewBox="0 0 14 14"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2 7h10M8 3l4 4-4 4" />
  </svg>
);

/** One email in, one promise out: we set you up, no queue language.
 *  `source` names which door this was, so /admin can tell a signup from
 *  this market apart from one off the marketplace tile. */
function SetupForm({ source }: { source: string }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      // The floor names itself, so /admin can tell a signup from this market
      // apart from one off the marketplace tile.
      await api.joinWaitlist({ email, source });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <p className="pubws-setup-done">Got it. We will get back to you within a few days.</p>;
  }
  return (
    <form className="pubws-setup" onSubmit={e => void submit(e)}>
      <div className="pubws-setup-row">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          aria-label="Your email"
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Get set up'}
        </button>
      </div>
      {error && <p className="pubws-setup-err">{error}</p>}
    </form>
  );
}
