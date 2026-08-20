import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { MarketChart } from '../components/MarketChart';
import { TradeTicket, type TicketPosition } from '../components/TradeTicket';
import { FloorModal } from '../components/FloorModal';
import { useAnimatedNumber } from '../lib/useAnimatedNumber';
import { indexBundleSrc } from '../lib/bundle-version';
import { JobsBoard, splitAsk } from '../components/JobsBoard';
import { SubjectAbout } from '../components/SubjectAbout';
import { FloorAnnouncements } from '../components/FloorAnnouncements';
import { FloorComments } from '../components/FloorComments';
import { LeaderboardRail } from '../components/FloorRails';
import { useMyParticipantId } from '../hooks/useMyParticipantId';
import { AccountMenu } from '../components/AccountMenu';
import { FloorChat } from '../components/FloorChat';
import type { FloorRef } from '../lib/agent-prompt';
import { NotificationsBell } from '../components/NotificationsBell';
import { DiscordButton } from '../components/DiscordButton';
import { ManifoldButton } from '../components/ManifoldButton';
import { ReportButton } from '../components/ReportButton';
import { Logo } from '../components/Logo';
import type { LeaderboardEntry, LimitOrder } from '../lib/api';
import {
  buildHorizonViews, captionLabel, horizonById, priceSeriesIsInline, priceSeriesOf, settleDayOf,
  stepHorizon,
  type HorizonView, type PriceSeries,
} from '../lib/floor-horizons';
import { periodGapOf } from '../lib/period-gap';

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

function fmtShares(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}

function formatValue(v: number): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// The floor's built-in "What is <name>?" copy, shown until the workspace owner
// writes their own (subjectAbout). Free text: description, then sources.
const DEFAULT_SUBJECT_ABOUT = `LookPilot is a webcam head tracker for flight, trucking and racing sims, the best-reviewed one on Steam: look around in the game by moving your head, no hardware. It makes money by selling the app, $14.99 once per player, so every copy sold is what this market is betting on.

Sources:
- Steam store page: https://store.steampowered.com/app/3326890/LookPilot/
- Data room, the numbers this settles on, updated once per day: https://lookpilot.app/data-room/
- SteamDB, third-party sales estimates: https://steamdb.info/app/3326890/`;

function formatDelta(delta: number, unit = ''): string {
  const abs = Math.abs(delta);
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  const num = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${unit}${num}`;
}

// Labels, ordering and per-horizon facts live in lib/floor-horizons: one
// home, so no surface can decide what a horizon is from its index.

export function TradePage() {
  const params = useParams();
  const idOrSlug = params.slug ?? params.workspaceId;
  const { user, loading: authLoading } = useAuth();
  // Which row on the board is this visitor's. Rows are keyed by participant
  // id and the session carries an auth user id, which is a different thing.
  const myParticipantId = useMyParticipantId(!!user);
  const navigate = useNavigate();
  const location = useLocation();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [positions, setPositions] = useState<TicketPosition[]>([]);
  const [orders, setOrders] = useState<LimitOrder[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [ticketPreview, setTicketPreview] = useState<{ direction: 'higher' | 'lower'; newProb: number } | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  // Selecting a job switches the ONE market view to that job's conditional
  // market (owner decision 2026-08-09: no second market underneath). null
  // means the baseline market is showing.
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // A notification points AT something: #contract=<id> opens the floor on
  // that contract, and #comment=<id> says which line in its thread the
  // reader was told about. Landing them on the page and leaving them to find
  // it is most of the way to not having linked at all, so the comment id is
  // handed to FloorComments, which opens the thread, scrolls to that line and
  // flashes it once. The hash is consumed on arrival so it does not fight the
  // back button or the #account link that shares this bar.
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  const [flashContract, setFlashContract] = useState(false);
  //
  // Driven by the ROUTER's hash, not by the hashchange event. A click on the
  // bell while already standing on this floor changes the hash through
  // pushState, and pushState does not fire hashchange, so a listener-only
  // version silently did nothing exactly where it was most likely to be used
  // (owner report 2026-08-19: "I click it and it still doesn't highlight").
  // location.hash sees both that and a pasted URL.
  useEffect(() => { setEditingJob(false); setJobErr(''); }, [selectedJobId]);

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const contract = params.get('contract');
    const comment = params.get('comment');
    if (!contract && !comment) return;
    if (contract) setSelectedJobId(contract);
    setFocusCommentId(comment);
    // With no comment to point at, the contract itself is the thing the
    // notification named, so that is what flashes.
    if (contract && !comment) {
      setFlashContract(true);
      setTimeout(() => setFlashContract(false), 1800);
    }
    // Consumed once applied, so it does not fight the back button or re-fire
    // the flash on the next render. replaceState rather than navigate: this is
    // tidying the address bar, not a place in the history.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [location.hash]);
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
  // The bet dialog (owner direction 2026-08-10, after Manifold): the floor
  // shows two buttons; composing the bet happens in a modal. null = closed,
  // 'manage' = opened from the position summary with no side preset.
  const [betModal, setBetModal] = useState<'higher' | 'lower' | 'manage' | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const joinTried = useRef(false);
  // The owner's decision controls (owner ask 2026-08-11: approve from the
  // floor). manage capability on this workspace reveals them on a selected
  // job; everyone else never sees the bar.
  const [canManage, setCanManage] = useState(false);
  // Who the viewer is as a participant, so the floor can tell "my contract"
  // from someone else's. A proposer edits their own; a manager edits any.
  const [myAgentId, setMyAgentId] = useState<string | null>(null);
  // Editing the selected contract in place (owner ask 2026-08-20). Same shape
  // as the metric definition editor above: words save in place, and the price
  // only moves while nobody has traded the pair (docs/market-integrity.md I1b).
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
    api.getMarketplaceWorkspace(idOrSlug)
      .then(setWs)
      .catch(e => {
        console.error('trade page fetch failed:', e);
        // A missing slug is usually a bookmark from the deleted console
        // (/overview, /metrics, ...), so say what the visitor can do rather
        // than quoting an HTTP status at them.
        const missing = e instanceof Error && /\b404\b/.test(e.message);
        setError(missing
          ? 'There is no market at this address.'
          : e instanceof Error ? e.message : 'Failed to load workspace');
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [idOrSlug]);

  // Canonical URL is the root-level slug; shared /marketplace/<x> links
  // keep working and quietly become /<slug>.
  useEffect(() => {
    if (!ws?.slug) return;
    if (location.pathname.startsWith('/marketplace/')) {
      navigate(`/${ws.slug}`, { replace: true });
    }
  }, [ws, location.pathname, navigate]);

  // Silent join on an Open workspace; idempotent server-side.
  useEffect(() => {
    if (!ws || !user || joinTried.current) return;
    if (ws.joinAs !== 'trader') return;
    joinTried.current = true;
    api.joinWorkspace(ws.workspaceId)
      .then(() => {
        setActiveWorkspace(ws.workspaceId);
        setJoined(true);
      })
      .catch(e => console.error('silent join failed:', e));
  }, [ws, user]);

  // Scoped to THIS workspace (owner report 2026-08-15): the rail's other
  // half, top contractors, has always been this workspace's, and a floor
  // that ranks its traders globally is answering a question nobody asked
  // while standing here. The cross-workspace board still lives at
  // /leaderboard.
  const loadLeaders = () => {
    if (!idOrSlug) return;
    // Enough rows for the rail's top ten AFTER dropping never-traded
    // participants (owner direction 2026-08-17); the rail slices to ten.
    api.getLeaderboard(30, idOrSlug)
      .then(r => setLeaders(r.participants ?? []))
      .catch(e => console.error('leaderboard fetch failed:', e));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadLeaders, [idOrSlug]);

  // Once joined (the workspace header is set), ask who we are HERE: an
  // owner/admin membership reveals the decision bar on selected jobs.
  useEffect(() => {
    if (!user || !joined) return;
    api.getProfile()
      .then(p => setCanManage((p as { authRole?: string }).authRole === 'admin'))
      .catch(e => console.error('profile fetch failed:', e));
  }, [user, joined]);

  const decide = async (action: 'approve' | 'decline', refund = false) => {
    if (!selectedJobId || !ws) return;
    setDecideErr('');
    setDecideBusy(true);
    try {
      if (action === 'approve') {
        await api.approveProposal(selectedJobId);
      } else {
        await api.declineProposal(selectedJobId, (declineReason ?? '').trim(), refund);
      }
      setDeclineReason(null);
      setSelectedJobId(null);
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
      setDecideErr((e as Error).message || 'Could not remove the contract');
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
  const prevHorizon = stepHorizon(horizons, horizonId, -1);
  // The arithmetic under the price: booked, missing, per day. Null for any
  // metric that does not accumulate inside its period, which is most of them.
  const gap = periodGapOf(hero);
  const nextHorizon = stepHorizon(horizons, horizonId, 1);
  const unit = hero?.unit ?? '';
  const metricLabel = hero?.metricLabel ?? '';
  const selectedJob = ws?.proposals?.find(p => p.id === selectedJobId) ?? null;
  // A contract is editable by whoever posted it (and by a manager) while it is
  // still on the ballot. The server decides the same thing again; this only
  // decides whether to draw the button.
  const canEditJob = !!selectedJob
    && (selectedJob.status ?? 'pending') === 'pending'
    && (canManage || (!!myAgentId && selectedJob.proposedByHandle === myAgentId));

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
      if (!task) throw new Error('A contract needs a title');
      const fullTitle = askNum > 0 ? `$${askNum}: ${task}` : task;
      await api.editProposal(selectedJob.id, {
        title: fullTitle,
        description: jobDesc.trim(),
        askUsd: askNum,
      });
      setEditingJob(false);
      reload();
    } catch (e) {
      setJobErr(e instanceof Error ? e.message : 'Could not save the contract');
    } finally {
      setJobSaving(false);
    }
  };

  // The contract's pair for the horizon on screen, not whichever pair the
  // payload happened to list first.
  const pair = (hero && selectedJob?.markets.find(m => m.targetDate === hero.targetDate))
    ?? selectedJob?.markets[0] ?? null;
  // A decided job is history: its markets are resolved, so trading is paused;
  // the page still shows the impact that was priced for it.
  const selectedJobDecided = !!selectedJob?.status && selectedJob.status !== 'pending';
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
      rangeMin: pair.rangeMin,
      rangeMax: pair.rangeMax,
      history: condHistory?.[b] ?? [],
    };
  };
  // The one market the page is showing and the ticket is trading: the
  // baseline, or the selected branch of the selected job.
  const active = branchShape(branch) ?? (hero
    ? {
        marketId: hero.marketId,
        consensus: hero.consensus,
        probability: hero.probability,
        liquidity: hero.liquidity,
        funded: hero.liquidity > 0,
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
      .then(([a, d]) => { if (token === condReqRef.current) setCondHistory({ approved: a, declined: d }); })
      .catch(e => console.error('conditional history fetch failed:', e));
  };
  // The workspace's stable identity for URLs. Deliberately NOT the `ws`
  // object: that is a fresh object on every five-second poll, and effects
  // keyed on it re-ran (and re-reset) on every tick.
  const wsKey = ws ? (ws.slug || ws.workspaceId) : null;

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
  // only matters for a market it does not carry (a contract's branch).
  const horizonPricesRef = useRef<() => void>(() => {});
  horizonPricesRef.current = () => {
    if (!heroMarketId || !wsKey || heroPricesInline) return;
    const token = ++priceReqRef.current;
    api.getPublicMarketHistory(wsKey, heroMarketId)
      .then(points => {
        if (token !== priceReqRef.current) return;
        setHorizonPrices(prev => ({ ...prev, [heroMarketId]: points }));
      })
      .catch(e => console.error('horizon price history fetch failed:', e));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { horizonPricesRef.current(); }, [heroMarketId, heroPricesInline, wsKey]);

  // The initial pull for a newly selected job. Keyed on the market ids and
  // the workspace's stable slug, NOT on the `ws` object: `ws` is a fresh
  // object on every five-second poll, and depending on it re-ran this whole
  // effect (and its resets) on every tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { condHistoryRef.current(); }, [pair?.approvedMarketId, pair?.declinedMarketId, wsKey]);

  const refreshMoney = () => {
    if (activeMarketId && ws) {
      api.getPositions(activeMarketId, undefined, ws.workspaceId)
        .then((rows: Array<{ direction: 'higher' | 'lower'; shares: number; totalCost: number }>) =>
          setPositions((rows ?? []).filter(r => r.shares > 1e-9)))
        .catch(e => console.error('positions fetch failed:', e));
      api.getLimitOrders(activeMarketId, ws.workspaceId)
        .then(rows => setOrders(rows ?? []))
        .catch(e => console.error('limit orders fetch failed:', e));
    }
    api.getParticipant()
      .then(pt => {
        const row = pt as { balance?: number; id?: string };
        setBalance(row.balance ?? null);
        setMyAgentId(row.id ?? null);
      })
      .catch(e => console.error('participant fetch failed:', e));
  };
  // Positions belong to the market on screen, so they refetch on a switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPositions([]); setOrders([]); if (joined) refreshMoney(); }, [joined, activeMarketId]);

  // Live updates (owner ask 2026-08-11: the market updates in real time
  // for viewers and traders). The floor polls every few seconds so a
  // price move, a filled limit order, or a new job appears without a
  // reload. A ref holds the latest closures so the interval never runs a
  // stale one. Paused while the tab is hidden; a fresh pull the instant it
  // comes back, so returning to the tab is never stale.
  const pollRef = useRef<() => void>(() => {});
  pollRef.current = () => {
    reload();
    loadLeaders();
    condHistoryRef.current();
    horizonPricesRef.current();
    if (joined) refreshMoney();
  };
  useEffect(() => {
    const tick = () => { if (typeof document === 'undefined' || !document.hidden) pollRef.current(); };
    const interval = setInterval(tick, 5000);
    const onVisible = () => { if (!document.hidden) pollRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // Stale-tab guard (owner report 2026-08-13): a long-open floor tab runs
  // the bundle it loaded with forever, so a deploy's fixes never reach it.
  // Every five minutes, compare the bundle the served index references with
  // the one running; a mismatch offers a reload via the pill in the render.
  // Inert in dev, where the served page carries no built bundle.
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    const current = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.getAttribute('src');
    if (!current) return;
    const currentPath = new URL(current, window.location.origin).pathname;
    const check = () => {
      if (document.hidden) return;
      fetch('/', { cache: 'no-store' })
        .then(r => r.text())
        .then(html => {
          const served = indexBundleSrc(html);
          if (served && served !== currentPath) setUpdateAvailable(true);
        })
        .catch(e => console.error('update check failed:', e));
    };
    const iv = setInterval(check, 300_000);
    return () => clearInterval(iv);
  }, []);

  // The ticket owns busy/error/flash UI state; the page owns the money
  // plumbing. Errors propagate by throwing so the ticket can show them
  // where the finger is.
  const doTrade = async (body: Record<string, unknown>) => {
    if (!ws) return;
    const r = await api.trade(body, ws.workspaceId) as { consensus?: number | null };
    if (typeof r.consensus === 'number' && typeof body.marketId === 'string') {
      setLivePrice({ marketId: body.marketId, value: r.consensus });
    }
    refreshMoney();
    reload();
    condHistoryRef.current();
  };
  const placeTrade = async (direction: 'higher' | 'lower', amount: number) => {
    if (!activeMarketId) return;
    await doTrade({ marketId: activeMarketId, direction, amount });
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
  // after its first trade. For a job, the chip shows the impact itself
  // (approved minus declined), which is the one number the job is about,
  // and it stays the same whichever branch is on screen.
  const marketOpen = pair
    ? null
    : active?.history.find(p => p.consensus !== null)?.consensus ?? null;
  // Impact is the delta on the floor's one horizon, which is also the only
  // market on screen, so `pair` already IS that pair. Kept as its own name
  // because the ballot passes the same target date and the two must agree.
  const jobImpact = pair && pair.approvedConsensus !== null && pair.declinedConsensus !== null
    ? pair.approvedConsensus - pair.declinedConsensus
    : null;
  const impactUnit = unit;
  const consensus = (livePrice && livePrice.marketId === activeMarketId ? livePrice.value : null)
    ?? active?.consensus ?? null;
  // The number rolls to its new value (trade, branch switch, job select)
  // instead of teleporting; everything downstream (chart, ticket) uses the
  // true value, only the headline shows the tween.
  const shownConsensus = useAnimatedNumber(consensus);

  // "What is this?" reveal: the concept beats draw themselves in when the
  // section scrolls into view (a one-shot IntersectionObserver), so the
  // explanation lands as a small orchestrated moment instead of sitting
  // static at the bottom. Dep on `ws` so the observer attaches once the
  // section actually renders.
  // "What can you do?" sends the reader to the control it names: the bet
  // buttons, or the contracts board. Scrolling beats opening a modal here,
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
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setAboutIn(true); io.disconnect(); }
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, aboutIn]);

  // The composed bet's impact, projected from probability space onto the
  // metric's range so the chart can draw where the call would move.
  const chartPreview = active && ticketPreview
    ? { direction: ticketPreview.direction, value: active.rangeMin + ticketPreview.newProb * (active.rangeMax - active.rangeMin) }
    : null;

  // Year chart: the hero metric's REAL value over the calendar year (solid),
  // continued to where the market sees it settling (dashed, to the resolve
  // date). The x-axis is the year, not the trading timeline, so this is its
  // own chart below the market poster, drawn in the same visual family.
  const heroActualHistory = useMemo(() => {
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
    if (!ws?.heroMetricId) return;
    setDefSaving(true);
    setDefErr('');
    try {
      await api.updateMetricDescription(ws.heroMetricId, defDraft, ws.workspaceId);
      setEditingDef(false);
      reload();
    } catch (e) {
      setDefErr((e as Error).message);
    } finally {
      setDefSaving(false);
    }
  };

  // The definition belongs to the market on screen.
  const horizonDescription = hero?.description ?? null;

  if (error) {
    return (
      <div className="pubws pubws--center">
        <TopBar user={!!user} ready={!authLoading} />
        <main className="pubws-main">
          <section className="pubws-status">
            <p className="pubws-pitch">{error}</p>
            <p className="pubws-pitch"><Link to="/marketplace">See the open markets</Link></p>
          </section>
        </main>
      </div>
    );
  }

  if (!ws) {
    // The loading screen is the market's own motif (the amber call dot,
    // rippling) where the market is about to appear; no spinner, no text.
    return (
      <div className="pubws pubws--center">
        <TopBar user={!!user} ready={!authLoading} />
        <main className="pubws-main">
          <div className="pubws-loading" role="status" aria-label="Loading">
            <span className="pubws-loading-dot" />
          </div>
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
      />
      {/* Otto, in the corner rather than in the column (owner direction
          2026-08-20): a reader needs him at whatever point of the page their
          question arrives, and the page's job is the market. */}
      {idOrSlug && (
        <FloorChat
          idOrSlug={idOrSlug}
          workspaceName={ws.name}
          metricLabel={selectedJob ? null : metricLabel}
        />
      )}
      <main className="pubws-main pubws-main--floor">
        <LeaderboardRail entries={leaders} contractors={ws?.topContractors} unit={unit} signedIn={!!user} meId={myParticipantId} />
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
            <h1 className="pubws-ws-name">{ws.name}</h1>
            {ws.description && <p className="pubws-ws-tagline">{ws.description}</p>}
          </header>
        )}
        {hero && active && consensus !== null && (
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
            {selectedJob ? (
              <>
                <button className="pubws-back" onClick={() => setSelectedJobId(null)}>
                  ← {metricLabel}
                </button>
                <h2 className={`pubws-instrument-title pubws-question pubws-enter pubws-enter--1${flashContract ? ' is-flashed' : ''}`}>
                  What is {metricLabel} if{' '}
                  {selectedJob.proposedByName ?? 'someone'}{' '}
                  {/* The phrase IS the world: green "is paid" in the
                      approved branch, red "is not paid" in the declined one,
                      and clicking it flips to the other world (owner
                      direction 2026-08-10). Both phrases share one grid
                      cell, so the headline sizes to the longer one and
                      never reflows on a switch, whatever the ask's width. */}
                  <WorldWord
                    branch={branch}
                    approvedText={splitAsk(selectedJob.title).ask !== null
                      ? `is paid $${splitAsk(selectedJob.title).ask}`
                      : 'does'}
                    declinedText={splitAsk(selectedJob.title).ask !== null
                      ? `is not paid $${splitAsk(selectedJob.title).ask}`
                      : 'does not do'}
                    onToggle={pair?.declinedMarketId
                      ? () => setBranch(b => (b === 'approved' ? 'declined' : 'approved'))
                      : null}
                  />
                  {splitAsk(selectedJob.title).ask !== null ? ' to do:' : ':'}
                  {' '}
                  <span className="pubws-question-task">{splitAsk(selectedJob.title).rest}</span>
                </h2>
                {editingJob ? (
                  /* Editing a contract in place (owner ask 2026-08-20). The
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
                        aria-label="Contract title"
                      />
                    </label>
                    <label className="jobform-field">
                      <span className="ticket-label">Details</span>
                      <textarea
                        className="pubws-know-edit-text"
                        rows={4}
                        value={jobDesc}
                        onChange={e => setJobDesc(e.target.value)}
                        aria-label="Contract details"
                      />
                    </label>
                    <p className="pubws-settle">
                      Editing the words keeps the market and every position on it,
                      and publishes that it changed. The price can only move while
                      nobody has traded this contract yet, because the market
                      opened at that number.
                    </p>
                    <div>
                      <button className="pubws-decide" disabled={jobSaving} onClick={() => { void saveJobEdit(); }}>
                        {jobSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        className="pubws-decide"
                        style={{ marginLeft: '0.5rem' }}
                        disabled={jobSaving}
                        onClick={() => { setEditingJob(false); setJobErr(''); }}
                      >
                        Cancel
                      </button>
                    </div>
                    {jobErr && <p className="ticket-err">{jobErr}</p>}
                  </div>
                ) : selectedJob.description && (
                  <>
                    <p className={`pubws-details pubws-enter pubws-enter--1${descExpanded ? '' : ' is-clamped'}`}>
                      {selectedJob.description}
                    </p>
                    {selectedJob.description.length > 220 && (
                      <button className="pubws-details-more" onClick={() => setDescExpanded(v => !v)}>
                        {descExpanded ? 'less' : 'more'}
                      </button>
                    )}
                  </>
                )}
                {/* Edited, and when: a trader who priced this contract before
                    the wording moved is entitled to know that it moved. */}
                {!editingJob && selectedJob.editedAt && (
                  <p className="pubws-proposal-meta">
                    edited {new Date(selectedJob.editedAt).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', timeZone: 'UTC',
                    })}
                  </p>
                )}
                {/* The proposer's own controls. A contract is a listing its
                    author should be able to correct: a typo, a clearer
                    description, a price they got wrong before anyone traded. */}
                {canEditJob && !editingJob && (
                  <div className="pubws-ownerbar pubws-enter pubws-enter--1">
                    <button
                      className="pubws-decide"
                      onClick={() => {
                        const split = splitAsk(selectedJob.title);
                        setJobAsk(split.ask !== null ? String(split.ask) : '');
                        setJobTitle(split.rest);
                        setJobDesc(selectedJob.description ?? '');
                        setJobErr('');
                        setEditingJob(true);
                      }}
                    >
                      Edit contract
                    </button>
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
                              {decideBusy ? 'Deciding…' : splitAsk(selectedJob.title).ask !== null
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
                            <button className="pubws-decide" onClick={() => { setRemoveArmed(false); setDecideErr(''); }}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="pubws-decide"
                            disabled={decideBusy}
                            onClick={() => { setRemoveArmed(true); setDecideErr(''); }}
                            title="Take this contract off the board. Stakes are refunded."
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
                          placeholder="Why not, published on the contract"
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
                        <button className="pubws-decide" onClick={() => { setDeclineReason(null); setDecideErr(''); }}>
                          Cancel
                        </button>
                      </>
                    )}
                    {decideErr && <p className="ticket-err">{decideErr}</p>}
                  </div>
                )}
              </>
            ) : (
              /* The metric name alone: it carries its own horizon
                 ("September 2026 net revenue"), so a settle date beside it
                 was redundant and confusing when the two differ (a September
                 metric settling 14 October read as an October market; owner
                 direction 2026-08-18). The chart caption below still says
                 when it lands. It is a caption, not a headline: with the
                 company named above, this line's only job is to say what
                 the big number underneath measures. */
              /* One clock at a time, with a way to the others. The arrows
                 render whenever the floor has more than one market and they
                 LOOP (owner ask 2026-08-20): a control that sometimes does
                 nothing is worse than one that always moves, and with one
                 market they do not render at all, so looping never shows the
                 same number twice in a row. */
              /* The arrows live INSIDE the caption, not in a wrapper around
                 it. Wrapping the h2 in a flex row put it in a 59px column
                 beside the price on the live floor, four words tall and
                 overlapping the leaderboard rail: this heading's placement
                 comes from rules that assume it is a block child of
                 .pubws-center, and a new element between them broke that. The
                 settle day rides on it too (owner ask 2026-08-20), computed
                 from the market and never stored on the metric. It was taken
                 off this line on 2026-08-18 as redundant, when a floor had one
                 market and the metric's name carried its own horizon; with
                 arrows it is the only thing telling two clocks apart. */
              <h2 className="pubws-instrument-label pubws-enter pubws-enter--1">
                {horizons.length > 1 && (
                  <button
                    className="pubws-hstep"
                    onClick={() => prevHorizon && setHorizonId(prevHorizon.marketId)}
                    aria-label={prevHorizon ? `Show ${prevHorizon.metricLabel}, ${prevHorizon.label}` : 'Previous market'}
                  >‹</button>
                )}
                {captionLabel(metricLabel, ws.name)}
                {hero?.settleShort && <span className="pubws-instrument-at"> @ {hero.settleShort}</span>}
                {horizons.length > 1 && (
                  <button
                    className="pubws-hstep"
                    onClick={() => nextHorizon && setHorizonId(nextHorizon.marketId)}
                    aria-label={nextHorizon ? `Show ${nextHorizon.metricLabel}, ${nextHorizon.label}` : 'Next market'}
                  >›</button>
                )}
              </h2>
            )}
            <div className="pubws-headline pubws-enter pubws-enter--2">
              <span className="pubws-price">{unit}{formatValue(shownConsensus ?? consensus)}</span>
              {!selectedJob && marketOpen !== null && consensus !== marketOpen && (
                <span key={`open-${Math.round(consensus - marketOpen)}`} className={`pubws-delta-chip ${consensus >= marketOpen ? 'is-up' : 'is-down'}`}>
                  {consensus >= marketOpen ? '▲' : '▼'} {formatDelta(consensus - marketOpen, unit)}
                  {' '}since open
                </span>
              )}
              {/* The impact is the job's one number, so it is always said:
                  priced, zero-so-far, or not yet priced. Silence read as a
                  broken page. */}
              {selectedJob && (
                jobImpact === null ? (
                  <span className="pubws-delta-chip">impact not yet priced</span>
                ) : jobImpact === 0 ? (
                  <span className="pubws-delta-chip">±{impactUnit}0 impact so far</span>
                ) : (
                  <span key={`imp-${Math.round(jobImpact)}`} className={`pubws-delta-chip ${jobImpact >= 0 ? 'is-up' : 'is-down'}`}>
                    {jobImpact >= 0 ? '▲' : '▼'} {formatDelta(jobImpact, impactUnit)} impact
                    {hero ? ` by ${hero.label}` : ''}
                  </span>
                )
              )}
            </div>
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
                    <b>{unit}{formatValue(gap.booked)}</b> booked already, past the market's{' '}
                    {unit}{formatValue(gap.target)} with {gap.daysLeft === 1 ? 'a day' : `${gap.daysLeft} days`} to go.
                  </>
                ) : (
                  <>
                    <b>{unit}{formatValue(gap.booked)}</b> booked so far. Another{' '}
                    <b>{unit}{formatValue(gap.needed)}</b> reaches the market's {unit}{formatValue(gap.target)},
                    which is about <b>{unit}{formatValue(gap.perDay)} a day</b> for the{' '}
                    {gap.daysLeft === 1 ? 'day' : `${gap.daysLeft} days`} left.
                  </>
                )}
              </p>
            )}
            {/* A market nobody has traded yet has no replayed history, which
                used to mean no chart at all: selecting a fresh job showed a
                price and blank space. A market always has a call, so fall
                back to that single point and let the chart hold it. */}
            {/* Every proposal branches into two worlds and both are on the
                page (owner decision 2026-08-10): the toggle picks which one
                the ticket trades, the chart draws the other as a quiet
                second line, and the gap between the lines is the impact. */}
            {selectedJob && pair?.declinedMarketId && (
              <div className="pubws-branch pubws-enter pubws-enter--2" role="group" aria-label="Branch">
                <button
                  className={`pubws-branch-opt pubws-branch-opt--approved${branch === 'approved' ? ' is-active' : ''}`}
                  aria-pressed={branch === 'approved'}
                  onClick={() => setBranch('approved')}
                >
                  if approved
                </button>
                <button
                  className={`pubws-branch-opt pubws-branch-opt--declined${branch === 'declined' ? ' is-active' : ''}`}
                  aria-pressed={branch === 'declined'}
                  onClick={() => setBranch('declined')}
                >
                  if declined
                </button>
              </div>
            )}
            <div className="pubws-enter pubws-enter--3">
              <MarketChart
                key={active.marketId}
                series={active.history.length > 0
                  ? active.history
                  : [{ at: new Date().toISOString(), consensus }]}
                consensus={consensus}
                unit={unit}
                note={settleDayOf(hero.targetDate) ? `resolves ${settleDayOf(hero.targetDate)}` : undefined}
                preview={chartPreview}
                orders={orders.map(o => ({ id: o.id, direction: o.direction, limitValue: o.limitValue }))}
                /* Only ever the other BRANCH: same metric, same window,
                   two worlds, so the gap is the priced impact. The other
                   horizon measures a different window and shares no scale
                   with this one (2026-08-15), so it gets its own chart
                   below rather than a line on this axis. */
                secondary={selectedJob && otherBranch && otherBranch.consensus !== null
                  ? {
                      series: otherBranch.history,
                      consensus: otherBranch.consensus,
                      label: branch === 'approved' ? 'if declined' : 'if approved',
                      tone: branch === 'approved' ? 'lower' as const : 'higher' as const,
                    }
                  : null}
              />
            </div>
          </section>
        )}

        {active && !selectedJobDecided && (trading || (canTrade && !user && !authLoading)) ? (
          <section className="pubws-act pubws-enter pubws-enter--3" aria-label="Place a trade">
            {/* Prominent, Manifold-style (owner direction 2026-08-10):
                the two filled verbs ARE the floor's call to action, green
                up first like the reference. The dialog they open keeps its
                own side pills for switching.

                Unless the market has no liquidity, in which case there is
                nothing to trade against and the server refuses the bet. Say
                so here rather than letting someone compose a bet and meet
                "Market has no liquidity" at submit (owner report
                2026-08-15). The number above is the baseline's prior, drawn
                so the chart is not blank; it is not a price anyone made. */}
            {active.funded ? (
              <div className="pubws-bet" role="group" aria-label="Bet">
                <button className="pubws-bet-btn pubws-bet-btn--higher" onClick={() => setBetModal('higher')}>Bet Higher ↑</button>
                <button className="pubws-bet-btn pubws-bet-btn--lower" onClick={() => setBetModal('lower')}>Bet Lower ↓</button>
              </div>
            ) : (
              <p className="pubws-unfunded" role="status">
                {selectedJob
                  ? 'This contract has no market yet: nobody has funded one, so there is nothing to trade against. The owner funds it, or the proposer can back it themselves.'
                  : 'This market has no liquidity yet, so there is nothing to trade against.'}
              </p>
            )}
            {/* The held position stays visible on the floor; managing it
                (selling, cancelling orders) happens in the same dialog. */}
            {(positions.length > 0 || orders.length > 0) && (
              <button className="pubws-pos-summary" onClick={() => setBetModal('manage')}>
                {positions.map(p => `${p.direction === 'higher' ? '▲' : '▼'} ${fmtShares(p.shares)} ${p.direction}`).join(' · ')}
                {positions.length > 0 && orders.length > 0 ? ' · ' : ''}
                {orders.length > 0 ? `${orders.length} resting order${orders.length > 1 ? 's' : ''}` : ''}
                {' '}→ manage
              </button>
            )}
            {/* The conversation under whatever the one view shows: the
                baseline market's thread, or the selected job's (owner ask
                2026-08-11). */}
            {idOrSlug && (
              <FloorComments
                idOrSlug={idOrSlug}
                /* Both keys when a contract is on screen (owner report
                   2026-08-15: "if there is a trade why don't I see it down
                   here"). The conversation belongs to the CONTRACT, so it
                   survives switching branch, while positions and trades
                   belong to the BRANCH MARKET actually being traded. Passing
                   only the proposal left marketKey empty, so the panel never
                   fetched and rendered Comments alone, on a market that had
                   a real trade in it. */
                focusCommentId={focusCommentId}
                onFocusHandled={() => setFocusCommentId(null)}
                subject={selectedJob
                  ? { proposalId: selectedJob.id, marketId: activeMarketId ?? undefined }
                  : hero ? { marketId: hero.marketId } : {}}
                canPost={!!user && joined}
                onRequireSignup={() => navigate('/signup')}
              />
            )}

          </section>
        ) : null}



        {/* Two questions, two sections (owner direction 2026-08-10):
            "What is this market?" is the metric's stored definition,
            verbatim, because it is the settlement text. "What is
            LookPilot?" is the product in its own words plus the primary
            sources; know the company, trade it better.

            Editing the definition no longer voids the market (owner
            direction 2026-08-18, docs/market-integrity.md). Every edit is
            logged instead, and the log is rendered below the definition so
            a trader can see whether the wording moved after they took
            their position. */}
        <section className="pubws-know pubws-enter pubws-enter--3" aria-label="What is this market">
          <h2 className="pubws-know-head">
            What is this market?
            {/* Managers edit the definition in place (owner ask 2026-08-18).
                Saving keeps the market: the price, the pool and every
                position survive. What it does instead is publish the change
                here, which is the honest trade when no code can tell a
                clarification from a redefinition. */}
            {canManage && ws.heroMetricId && !editingDef && (
              <button
                className="pubws-decide"
                style={{ marginLeft: '0.6rem' }}
                onClick={() => {
                  setDefDraft(horizonDescription ?? ws?.heroMetricDescription ?? '');
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
                rows={6}
                onChange={e => setDefDraft(e.target.value)}
              />
              <p className="pubws-settle">
                This text is what the market settles on. Saving keeps the
                market open and every position intact, and publishes the
                change below, old wording and new, for anyone holding a
                position to see.
              </p>
              <div>
                <button
                  className="pubws-decide"
                  disabled={defSaving}
                  onClick={() => { void saveDefinition(); }}
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
            (horizonDescription ?? ws?.heroMetricDescription) && (
              <p className="pubws-know-what">{horizonDescription ?? ws?.heroMetricDescription}</p>
            )
          )}
          {/* The actual-trajectory chart that used to sit here was removed
              on owner direction 2026-08-18: the floor no longer plots the
              metric's measured values, only the market. The history fields
              stay in the API. */}
        </section>
        {/* The owner's disclosures, in the owner-prose zone between the
            market's definition and the company blurb. A charter that promises
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
        <SubjectAbout
          workspaceId={ws.workspaceId}
          name={ws.name}
          value={ws.subjectAbout}
          defaultText={DEFAULT_SUBJECT_ABOUT}
          canManage={canManage}
          onSaved={reload}
        />
        </div>
        {/* The jobs board IS the right rail (owner direction 2026-08-10:
            jobs where the activity log was). The log's information lives
            on in the chart and the board itself; the rail slot goes to the
            thing a visitor can act on. */}
        {ws.proposals !== undefined && hero ? (
          <aside className="pubws-rail pubws-rail--right" aria-label="Contracts">
            <JobsBoard
              proposals={ws.proposals}
              unit={unit}
              horizonDate={hero.targetDate}
              selectedId={selectedJobId}
              onSelect={id => setSelectedJobId(cur => (cur === id ? null : id))}
              signedIn={!!user}
              onRequireSignup={() => navigate('/signup')}
              workspaceName={ws.name}
              onPropose={async (title, description, askUsd) => {
                // Anonymous proposers go through the signup door; the board
                // itself is public information (Open workspace ballot).
                // Payment details come from the account (owner decision
                // 2026-08-10): the server reads and snapshots them.
                if (!user) { navigate('/signup'); return; }
                // No proposer stake (owner call 2026-08-14): the workspace
                // auto-funds the branch markets instead. Charging the empty
                // side of the marketplace half a newcomer's starting balance
                // to make an offer is spam defence aimed the wrong way; add
                // it back if someone actually spams.
                await api.createProposal({ title, description, askUsd });
                reload();
              }}
            />
          </aside>
        ) : (
          <aside className="pubws-rail pubws-rail--right" aria-hidden="true" />
        )}
      </main>

      {betModal && active && (
        <FloorModal onClose={() => setBetModal(null)} label="Place a trade">
          <TradeTicket
            probability={active.probability}
            liquidity={active.liquidity}
            positions={trading ? positions : []}
            onTrade={placeTrade}
            onSell={sellPosition}
            balance={balance}
            onPreview={setTicketPreview}
            unit={unit}
            consensus={consensus}
            rangeMin={active.rangeMin}
            rangeMax={active.rangeMax}
            orders={trading ? orders : []}
            onPlaceLimit={trading ? placeLimit : async () => {}}
            onCancelLimit={trading ? cancelLimit : undefined}
            onRequireSignup={trading ? undefined : () => navigate('/signup')}
            initialDir={betModal === 'manage' ? undefined : betModal}
            manageMode={betModal === 'manage'}
            onClose={() => setBetModal(null)}
          />
        </FloorModal>
      )}

      {/* Below the floor: why this exists, in three drawings and three
          sentences (owner direction 2026-08-10: about section under the
          main view, strong visuals, minimal text). The drawings reuse the
          chart's own vocabulary: the step line, the branch pair, the
          priced gap; nothing here is decoration from outside the product. */}
      <section className={`pubws-about${aboutIn ? ' is-in' : ''}`} ref={aboutRef} aria-label="What is this?">
        <h2 className="pubws-about-head">What is this?</h2>
        {/* Three rows, each locking its drawing beside the sentence it
            illustrates (redesigned 2026-08-12). Earlier passes put the art in
            a band above the columns; nothing tied a passage to its step, so it
            read as a squiggle floating over unrelated text. Hairline rows are
            also the house rhythm. */}
        <div className="pubws-about-beats">
          <div className="pubws-about-beat">
            <span className="pubws-about-num">01</span>
            <svg className="pubws-about-art" viewBox="0 0 170 56" aria-hidden="true">
              <path className="ab-line" d="M8,46 L46,46 L46,34 L88,34 L88,22 L130,22" />
              <circle className="ab-dot" cx="130" cy="22" r="4.5" />
            </svg>
            <p>A real company, run in the open. One number says how it is going.</p>
          </div>
          <div className="pubws-about-beat">
            <span className="pubws-about-num">02</span>
            <svg className="pubws-about-art" viewBox="0 0 170 56" aria-hidden="true">
              <path className="ab-line" d="M8,28 L62,28" />
              <path className="ab-up" d="M62,28 C100,28 110,14 152,10" />
              <path className="ab-down" d="M62,28 C100,28 110,42 152,46" />
              <circle className="ab-dot ab-dot--up" cx="152" cy="10" r="4.5" />
              <circle className="ab-dot ab-dot--down" cx="152" cy="46" r="4.5" />
            </svg>
            <p>Anyone can offer to do work and name their price, paid in real money if approved. Participants, human or AI, bet on both worlds: done, and not done.</p>
          </div>
          <div className="pubws-about-beat">
            <span className="pubws-about-num">03</span>
            <svg className="pubws-about-art" viewBox="0 0 170 56" aria-hidden="true">
              <line className="ab-gap" x1="30" y1="12" x2="30" y2="44" />
              <line className="ab-tick" x1="22" y1="12" x2="38" y2="12" />
              <line className="ab-tick" x1="22" y1="44" x2="38" y2="44" />
              <circle className="ab-dot ab-dot--up" cx="30" cy="12" r="4" />
              <circle className="ab-dot ab-dot--down" cx="30" cy="44" r="4" />
              <path className="ab-check" d="M80,30 L92,42 L120,14" />
            </svg>
            <p>The gap between those worlds is a calibrated number. The owner approves on it, and pays for outcomes, not promises.</p>
          </div>
        </div>
      </section>

      {/* Two ways in, said plainly (owner ask 2026-08-15). It sits BELOW
          "What is this?" (owner, same day): comprehension before action, and
          it keeps the two calls to action together instead of splitting them
          around the explainer. The three beats above say what this IS; a
          visitor who understands it still has to be told what they may DO,
          and the two sides of the economy are not symmetric in how obvious
          they are: the bet buttons are on screen, while the fact that a
          stranger can propose paid work and get paid for it is the part
          nobody guesses. Each card scrolls to the thing it names rather than
          opening a new surface. */}
      <section className="pubws-do" aria-label="What can you do?">
        <h2 className="pubws-do-head">What can you do?</h2>
        <div className="pubws-do-cards">
          <button className="pubws-do-card" onClick={() => scrollToAction('trade')}>
            <svg className="pubws-do-art" viewBox="0 0 120 48" aria-hidden="true">
              <path className="ab-line" d="M6,34 L34,34 L34,24 L64,24 L64,14 L100,14" />
              <circle className="ab-dot ab-dot--up" cx="100" cy="14" r="4.5" />
            </svg>
            <span className="pubws-do-title">Trade</span>
            <span className="pubws-do-body">
              Say where the number lands. You are paid for being right, and the
              price moves when you are.
            </span>
            <span className="pubws-do-go">Place a bet →</span>
          </button>
          <button className="pubws-do-card" onClick={() => scrollToAction('contract')}>
            <svg className="pubws-do-art" viewBox="0 0 120 48" aria-hidden="true">
              {/* The priced gap, then the approval: same motif as beat 03,
                  kept at its proportions so the gap reads as the subject and
                  the check as its consequence. */}
              <line className="ab-gap" x1="24" y1="8" x2="24" y2="40" />
              <line className="ab-tick" x1="16" y1="8" x2="32" y2="8" />
              <line className="ab-tick" x1="16" y1="40" x2="32" y2="40" />
              <circle className="ab-dot ab-dot--up" cx="24" cy="8" r="4" />
              <circle className="ab-dot ab-dot--down" cx="24" cy="40" r="4" />
              <path className="ab-check" d="M62,26 L72,36 L96,12" />
            </svg>
            <span className="pubws-do-title">Do a contract</span>
            <span className="pubws-do-body">
              Offer work and name your price. The market prices what it would do
              to the number, and the owner pays in real money if it clears.
            </span>
            <span className="pubws-do-go">Offer a contract →</span>
          </button>
        </div>
      </section>

      {/* The door is an email box, not a "waitlist" (owner direction
          2026-08-10): anyone who wants their own numbers run this way gets
          set up within days, so the copy promises contact, not a queue. One
          field, zero friction. It closes the page because the two calls to
          action escalate: trade, offer a contract, run your own number. */}
      <section className="pubws-door" aria-label="Get set up">
        <SetupForm source={ws.slug || idOrSlug || 'floor'} />
      </section>
      {/* The floor is designed to stay open, so every deploy would strand
          this tab on old code forever (owner report 2026-08-13: a fixed
          bug kept "happening" in a pre-fix tab). Offer the reload, never
          force it: yanking a composed bet or a selected branch out from
          under the visitor is worse than stale code. */}
      {updateAvailable && (
        <button className="pubws-update" onClick={() => window.location.reload()}>
          new version · reload
        </button>
      )}
    </div>
  );
}

export function TopBar({ user, ready, floor = null }: {
  user: boolean;
  ready: boolean;
  /** Which floor the reader is standing on, so account settings can hand out
   *  a prompt for THIS company rather than a generic one. */
  floor?: FloorRef | null;
}) {
  const navigate = useNavigate();
  return (
    <nav className="pubws-topbar">
      {/* The logo answers "what else is there to trade?": it opens the
          floor selection (owner ask 2026-08-14; previously the default
          floor itself, which from a floor was a no-op). */}
      <Link to="/marketplace" className="pubws-logolink" aria-label="Telarchy">
        {/* Same lockup treatment as the landing nav (3rem), so the page
            reads as the same site. */}
        <Logo variant="lockup" height="3rem" />
      </Link>
      <div className="pubws-topbar-right">
        <ManifoldButton signedIn={user} onRequireSignup={() => navigate('/signup')} />
        <DiscordButton />
        <ReportButton />
        {/* Rendered only after the session check settles: while it is
            pending, user is still null, and a signed-in visitor would see
            "Log in" flash and vanish. Anonymous visitors get it fading in. */}
        {ready && user && <div className="pubws-fade"><NotificationsBell /></div>}
        {ready && (user
          ? <div className="pubws-fade"><AccountMenu floor={floor} /></div>
          : <Link to="/login" className="pubws-login pubws-fade">Log in</Link>)}
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
function WorldWord({ branch, approvedText, declinedText, onToggle }: {
  branch: 'approved' | 'declined';
  approvedText: string;
  declinedText: string;
  onToggle: (() => void) | null;
}) {
  const inner = (
    <>
      <span className="pubws-world-opt pubws-world-opt--approved" aria-hidden={branch !== 'approved'}>{approvedText}</span>
      <span className="pubws-world-opt pubws-world-opt--declined" aria-hidden={branch !== 'declined'}>{declinedText}</span>
    </>
  );
  if (!onToggle) {
    return <span className={`pubws-world pubws-world--${branch}`}>{inner}</span>;
  }
  return (
    <button
      type="button"
      className={`pubws-world pubws-world--${branch} pubws-world--live`}
      onClick={onToggle}
      aria-label={`Switch to the world where this job is ${branch === 'approved' ? 'declined' : 'approved'}`}
    >
      {inner}
    </button>
  );
}

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
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The floor names itself, so /admin can tell a signup from this
        // market apart from one off the marketplace tile.
        body: JSON.stringify({ email, source }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Something went wrong');
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
      <p className="pubws-setup-lead">Want this for your own numbers, a company or a personal goal?</p>
      <div className="pubws-setup-row">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          aria-label="Your email"
        />
        <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Get set up'}</button>
      </div>
      {error && <p className="pubws-setup-err">{error}</p>}
    </form>
  );
}
