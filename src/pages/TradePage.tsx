import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AccountMenu } from '../components/AccountMenu';
import { AgentDoors } from '../components/AgentDoors';
import { EarnDoor } from '../components/EarnDoor';
import { FloorAnnouncements } from '../components/FloorAnnouncements';
import { BooksList, BooksRow } from '../components/FloorBooks';
import { FloorChat } from '../components/FloorChat';
import { FloorComments } from '../components/FloorComments';
import { FloorHead, OwnerRow, RunFloorRow } from '../components/FloorHead';
import { NumbersBand, SettlementLine } from '../components/FloorNumbers';
import {
  BranchTicket,
  DecisionBand,
  DecisionNote,
  PairBand,
  ProposalLabel,
  WorkBlock,
} from '../components/FloorProposal';
import { FloorStandings, type ProposalTraderRow, SeasonAdvert, useCurrentSeason } from '../components/FloorRails';
import {
  BET_INTENT_KEY,
  type BetIntent,
  FloorVerbs,
  PositionRow,
  SignupDoor,
  STAKE_KEY,
} from '../components/FloorVerbs';
import { Ghost, GhostRows, LoadingStatus } from '../components/Ghosts';
import { JobsBoard, splitAsk } from '../components/JobsBoard';
import { Logo } from '../components/Logo';
import { short } from '../components/MarketFacts';
import { MetricsDialog } from '../components/MetricsDialog';
import { NotificationsBell } from '../components/NotificationsBell';
import { granularityOf, NumberChart } from '../components/NumberChart';
import { AddDateDialog, InjectLiquidityDialog, NewMetricDialog, ReportValueDialog } from '../components/OwnerDialogs';
import { QuestionLine } from '../components/QuestionLine';
import { DEFAULT_STAKE, type TicketPosition, TradeTicket } from '../components/TradeTicket';
import { useAuth } from '../hooks/useAuth';
import { useMyParticipantId } from '../hooks/useMyParticipantId';
import type { FloorRef } from '../lib/agent-prompt';
import type { LeaderboardEntry, LimitOrder } from '../lib/api';
import { api, type PublicWorkspace, setActiveWorkspace } from '../lib/api';
import { parseFloorHash } from '../lib/floor-hash';
import {
  buildHorizonViews,
  captionLabel,
  dateSegmentOf,
  datesOf,
  dayOf,
  type HorizonView,
  horizonById,
  metricLabelOf,
  metricsOf,
  type PriceSeries,
  priceSeriesIsInline,
  priceSeriesOf,
  settleNoteOf,
  timeLeftOf,
} from '../lib/floor-horizons';
import { formatPairValue, pairNeedsDecimals } from '../lib/formatImpact';
import { dropInline, readInline } from '../lib/inline-data';
import { authPath } from '../lib/nextPath';
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

function formatValue(v: number): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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
  /** Held positions BY MARKET: with a proposal open both branches are on
   *  screen, and each column's row is its own book's (docs/ui-conventions.md,
   *  "Your position"). */
  const [posByMarket, setPosByMarket] = useState<Record<string, TicketPosition[]>>({});
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
    if (!ws) return;
    const path = window.location.pathname + window.location.search;
    if (selectedJobId) {
      if (/^\d+$/.test(selectedJobId)) return;
      const p = ws.proposals?.find(x => x.id === selectedJobId);
      const name = p?.number ? String(p.number) : selectedJobId;
      const want = `#proposal=${encodeURIComponent(name)}`;
      if (window.location.hash !== want) window.history.replaceState(null, '', path + want);
    } else if (parseFloorHash(window.location.hash)?.proposal) {
      window.history.replaceState(null, '', path);
    }
  }, [ws, selectedJobId]);
  // A proposal address accepts the number too: #proposal=7 names proposal
  // #7 (docs/ui-conventions.md, "A proposal has a number and an address").
  // The hash lands before the payload does, so the number waits here as the
  // selection until the proposals arrive and one of them answers to it.
  useEffect(() => {
    if (!ws || !selectedJobId || !/^\d+$/.test(selectedJobId)) return;
    const wanted = Number(selectedJobId);
    const hit = ws.proposals?.find(p => p.number === wanted);
    if (hit) setSelectedJobId(hit.id);
  }, [ws, selectedJobId]);
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
  /* The sign-up door a stranger's verb press opens, inside the verbs panel
     and in the ticket's place (docs/ui-conventions.md, "Signed out, rows 1
     to 3 are identical"). There is no demo ticket for a stranger: the verbs
     already quote the stake, which is what the demo ticket existed to show. */
  const [betDoor, setBetDoor] = useState<'higher' | 'lower' | null>(null);
  /* The stake the verbs quote and the ticket opens at, remembered per
     session, so a trader who bets 100 once is quoted at 100 from then on. */
  const [stakeText, setStakeText] = useState(() => {
    try {
      return sessionStorage.getItem(STAKE_KEY) ?? String(DEFAULT_STAKE);
    } catch {
      return String(DEFAULT_STAKE);
    }
  });
  const stakeNum = Math.max(0, Math.floor(parseFloat(stakeText) || 0));
  const setStake = (next: string) => {
    setStakeText(next);
    try {
      sessionStorage.setItem(STAKE_KEY, next);
    } catch {
      /* private mode: the stake still applies for this page */
    }
  };
  const [descExpanded, setDescExpanded] = useState(false);
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
  const [declineReason, setDeclineReason] = useState('');
  const [decideBusy, setDecideBusy] = useState(false);
  const [decideErr, setDecideErr] = useState('');
  // Removing a job is not a decision and has no undo in the UI, so it arms
  // first and takes a second click to fire.
  /** Which of the decision band's reviews is open (docs/ui-conventions.md,
   *  "The proposal view", P5): the payment review, the decline review with
   *  its published-reason field, or the remove confirm. */
  const [decideMode, setDecideMode] = useState<null | 'approve' | 'decline' | 'remove'>(null);

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
      setDeclineReason('');
      setDecideMode(null);
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
      setDecideMode(null);
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
    setDecideMode(null);
    setDeclineReason('');
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
  // One clock for the page, so the countdown and every settle tooltip agree.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  // How long until the market on screen settles: beside the price in the
  // market chart's row (owner ask 2026-08-28), so the clock never leaves
  // the page.
  const settleLeft = hero ? timeLeftOf(hero, now) : null;
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
  // The number chart renders even with no readings: it draws its own
  // "no reading yet" state with the market's marker (owner report
  // 2026-08-28, implied valuation: hiding it read as the graph
  // collapsing).
  // The arithmetic under the price: booked, missing, per day. Null for any
  // metric that does not accumulate inside its period, which is most of them.
  const gap = periodGapOf(hero);
  const unit = hero?.unit ?? '';
  const metricLabel = hero?.metricLabel ?? '';

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
  const activeMarketId = active?.marketId ?? null;

  /* The bet a stranger composed before the sign-up door: after sign-up the
     page returns to this floor and opens the ticket with that verb, that
     stake and a FRESH quote (docs/ui-conventions.md, "Signed out, rows 1 to
     3 are identical"). Consumed on arrival, so a second visit is not a
     second ticket. */
  useEffect(() => {
    if (!user || !activeMarketId || !idOrSlug) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(BET_INTENT_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const intent = JSON.parse(raw) as BetIntent;
      if (intent.floor !== idOrSlug || intent.marketId !== activeMarketId) return;
      if (intent.stake > 0) setStakeText(String(intent.stake));
      setBetModal(intent.direction);
    } catch {
      /* a garbled intent is not a bet */
    }
    try {
      sessionStorage.removeItem(BET_INTENT_KEY);
    } catch {
      /* nothing to clear */
    }
  }, [user, activeMarketId, idOrSlug]);

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
      // The market on screen, and, with a proposal open, the other branch
      // too: a position on the book the reader is not composing in still
      // belongs under its own ticket.
      const wanted = new Set<string>([activeMarketId]);
      if (selectedJob && pair) {
        if (pair.approvedMarketId) wanted.add(pair.approvedMarketId);
        if (pair.declinedMarketId) wanted.add(pair.declinedMarketId);
      }
      for (const marketId of wanted) {
        api
          .getPositions(marketId, undefined, ws.workspaceId)
          .then((rows: Array<{ direction: 'higher' | 'lower'; shares: number; totalCost: number }>) =>
            setPosByMarket(prev => ({ ...prev, [marketId]: (rows ?? []).filter(r => r.shares > 1e-9) })),
          )
          .catch(e => console.error('positions fetch failed:', e));
      }
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
    // Positions are keyed by market, so nothing has to be blanked: a stale
    // key can never paint under another book's ticket.
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
  useEffect(() => {
    const tick = () => {
      if (typeof document === 'undefined' || !document.hidden) pollRef.current();
    };
    const interval = setInterval(tick, 15_000);
    const onVisible = () => {
      if (!document.hidden) pollRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

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

  // The pair band has to add up at a glance (docs/ui-conventions.md, "The
  // proposal view", P4): the two calls print with two decimals when the
  // difference needs them, and the chart's branch labels use the same rule
  // (NumberChart asks the same helper).
  const pairDecimals =
    !!pair &&
    pair.approvedConsensus !== null &&
    pair.declinedConsensus !== null &&
    pairNeedsDecimals(pair.approvedConsensus, pair.declinedConsensus, formatValue);
  const pairCall = (value: number) => (pairDecimals ? formatPairValue(value, unit) : `${unit}${formatValue(value)}`);
  // When the pair sits away from the unconditional call by more than the
  // difference, one grey line under the row says why in the trader's terms:
  // the two books' pools and the market's own call.
  const decisionWhy = (() => {
    if (!pair || pair.approvedConsensus === null || pair.declinedConsensus === null) return null;
    const base = hero?.consensus ?? null;
    if (base === null) return null;
    const diff = Math.abs(pair.approvedConsensus - pair.declinedConsensus);
    const away = Math.min(Math.abs(pair.approvedConsensus - base), Math.abs(pair.declinedConsensus - base));
    if (away <= diff) return null;
    const ap = Math.round(pair.approvedPool ?? 0);
    const dp = Math.round(pair.declinedPool ?? 0);
    const pools =
      ap === dp
        ? `${ap.toLocaleString('en-US')} cr in each`
        : `${ap.toLocaleString('en-US')} cr and ${dp.toLocaleString('en-US')} cr`;
    return `Both books trade thin (${pools}); the market's own call is ${unit}${formatValue(base)}.`;
  })();
  // ONE probability per BOOK, folded in ONE place: the live one when the
  // socket has spoken for that book, else the payload's. A proposal puts two
  // books on screen at once (docs/ui-conventions.md, "The proposal view",
  // P6), so the fold cannot be per page: the ticket, the verbs and the
  // position card all used to derive it separately, and the ticket could say
  // a position was worth one thing and the card directly under it another
  // (AGENTS.md: two surfaces that show the same fact derive it from the same
  // place).
  const probabilityOf = (book: { marketId: string; probability: number; rangeMin: number; rangeMax: number }) =>
    livePrice && livePrice.marketId === book.marketId && book.rangeMax > book.rangeMin
      ? Math.max(0, Math.min(1, (livePrice.value - book.rangeMin) / (book.rangeMax - book.rangeMin)))
      : book.probability;
  /* What each side has on the table: the verbs quote it in the same words
     as the ticket's pills, from the same function, so the two untouched
     states of a market cannot drift apart. */
  const shownProbability = active ? probabilityOf(active) : 0;
  const consensus =
    (livePrice && livePrice.marketId === activeMarketId ? livePrice.value : null) ?? active?.consensus ?? null;

  /* The floor's own facts, never one book's (docs/ui-conventions.md, "The
     floor head"): distinct accounts that have traded on any of its books,
     the credits in every open book, the number of open baseline books. */
  const floorFacts = {
    traders: (ws as { traderCount?: number } | null)?.traderCount ?? 0,
    poolCredits: horizons.reduce((sum, h) => sum + (h.pool ?? 0), 0),
    books: horizons.length,
  };
  /* Every open book of the floor, listed once: metric order first, then
     soonest date within a metric (docs/ui-conventions.md, "Books on this
     floor"). One order, so the rail and the row under the question cannot
     disagree about which book is which. */
  const books = useMemo(
    () =>
      [...horizons].sort(
        (a, b) =>
          (a.metricOrder ?? 0) - (b.metricOrder ?? 0) ||
          new Date(a.resolvesOn ?? 0).getTime() - new Date(b.resolvesOn ?? 0).getTime() ||
          a.metricLabel.localeCompare(b.metricLabel),
      ),
    [horizons],
  );
  /* Whether anything on this floor is the owner's to report. On a floor
     whose every metric the platform syncs there is nothing to report, and
     the owner row says so instead of offering a control. */
  const floorHasReportedMetric = horizons.some(h => !h.platformSynced);
  const pendingProposals = (ws?.proposals ?? []).filter(p => (p.status ?? 'pending') === 'pending');
  /* The largest absolute impact among the pending proposals, on the
     horizon on screen, signed as the board prints it. */
  const largestPendingImpact = (() => {
    let best: number | null = null;
    for (const p of pendingProposals) {
      const pr = hero
        ? p.markets.find(
            m => m.targetDate === hero.targetDate && (m.metricId === undefined || m.metricId === hero.metricId),
          )
        : null;
      if (!pr || pr.approvedConsensus === null || pr.declinedConsensus === null) continue;
      const d = pr.approvedConsensus - pr.declinedConsensus;
      if (best === null || Math.abs(d) > Math.abs(best)) best = d;
    }
    return best;
  })();
  /* What counts as needing the owner's decision (docs/ui-conventions.md,
     "The proposals board"): pending, a non-zero ask, and proposed by
     somebody other than the owner. Oldest first, because that is the one
     the owner row selects. */
  const awaitingDecision = pendingProposals
    .filter(p => (p.askUsd ?? splitAsk(p.title).ask ?? 0) > 0 && p.proposedByHandle !== myAgentId)
    .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
  /* When a book last traded, for its facts row: a price point IS a trade. */
  const lastTradeOf = (history: PriceSeries | undefined | null) => {
    const points = (history ?? []).filter(p => p.consensus !== null);
    return points.length > 0 ? points[points.length - 1].at : null;
  };
  const lastTradeAt = lastTradeOf(active?.history);
  /* A trader holds ONE net side, so the position row is never two rows. */
  const positions = (activeMarketId ? posByMarket[activeMarketId] : undefined) ?? [];
  const heldPosition = positions.find(p => p.shares > 1e-9) ?? null;
  const heldOn = (marketId: string | null | undefined) =>
    (marketId ? (posByMarket[marketId] ?? []) : []).find(p => p.shares > 1e-9) ?? null;
  /* What this proposal asks, in whole USD: the stored field, or the price
     the title carries on a proposal that predates it. */
  const selectedJobAsk = selectedJob ? (selectedJob.askUsd ?? splitAsk(selectedJob.title).ask ?? 0) : 0;
  /* The day the surviving book pays at, as the pair's one rule says it. */
  const settleWords = hero?.settleShort ?? null;
  /* Funding or deepening a book, from the panel where that book is traded:
     the plain view's verbs panel and activity row, or the branch's own
     column on a proposal (docs/ui-conventions.md, "The verbs and the inline
     ticket"). Naming the branch matters: the credits go into one of the two
     worlds, and injecting into the wrong one is invisible until somebody
     trades it. */
  const openInject = (which?: 'approved' | 'declined') => {
    if (!hero) return;
    // On a proposal the caller names the book, because both are on screen
    // and injecting into the wrong world is invisible until somebody
    // trades it.
    const book = selectedJob && which ? branchShape(which) : active;
    if (!book) return;
    setOwnerDialog({
      kind: 'inject',
      marketId: book.marketId,
      marketLabel: `${metricLabel} · ${dateSegmentOf(hero)}${selectedJob && which ? ` · if ${which}` : ''}`,
      pool: book.pool,
      traders: book.traders,
      metricId: selectedJob ? undefined : hero.metricId,
      metricName: selectedJob ? undefined : metricLabel,
      targetDate: selectedJob ? undefined : hero.targetDate,
    });
  };
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
  // The definition belongs to the market on screen. The workspace-level
  // heroMetricDescription is only a fallback when the on-screen market IS the
  // hero metric; borrowed under any other clock it would caption one market
  // with another's settlement text.
  const horizonDescription =
    hero?.description ?? (hero && hero.metricId === ws?.heroMetricId ? (ws?.heroMetricDescription ?? null) : null);
  /* Whether the definition under the settlement line is expanded. The line
     itself is one line with "Full definition" pinned outside the clamp
     (docs/ui-conventions.md, "The settlement line"). */
  const [defExpanded, setDefExpanded] = useState(false);
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
                  {hint.description && <p className="pubws-ws-tagline">{hint.description}</p>}
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

  /** The inline ticket, inside whichever verbs panel opened it: the ticket's
   *  own card is the one card (docs/ui-conventions.md, "The verbs and the
   *  inline ticket"). The book it trades is always the one on `active`,
   *  because pressing a verb selects that branch in the same event. */
  const inlineTicket = (book: NonNullable<typeof active>, title: string) => (
    <div className="pubws-ticket-inline" key={betModal}>
      <TradeTicket
        probability={probabilityOf(book)}
        liquidity={book.liquidity}
        positions={trading ? positions : []}
        onTrade={placeTrade}
        onTradeTarget={placeTargetTrade}
        onSell={sellPosition}
        balance={balance}
        onPreview={setTicketPreview}
        unit={unit}
        consensus={consensus}
        rangeMin={book.rangeMin}
        rangeMax={book.rangeMax}
        orders={trading && betModal === 'manage' ? orders : []}
        onPlaceLimit={trading ? placeLimit : async () => {}}
        onCancelLimit={trading ? cancelLimit : undefined}
        initialDir={betModal === 'manage' ? undefined : (betModal ?? undefined)}
        initialStake={stakeNum}
        manageMode={betModal === 'manage'}
        title={betModal === 'manage' ? undefined : `Bet ${betModal === 'higher' ? 'Higher' : 'Lower'} · ${title}`}
        onCancel={() => {
          setBetModal(null);
          setTicketPreview(null);
        }}
        onClose={() => {
          setBetModal(null);
          setTicketPreview(null);
        }}
      />
    </div>
  );
  /** The sign-up door, in the ticket's place, keeping the composed bet. */
  const signupDoor = (book: NonNullable<typeof active>) =>
    betDoor && (
      <SignupDoor
        direction={betDoor}
        unit={unit}
        rangeMin={book.rangeMin}
        rangeMax={book.rangeMax}
        probability={probabilityOf(book)}
        liquidity={book.liquidity}
        stake={stakeNum}
        onContinue={email => {
          try {
            sessionStorage.setItem(
              BET_INTENT_KEY,
              JSON.stringify({
                floor: idOrSlug ?? ws.workspaceId,
                marketId: book.marketId,
                direction: betDoor,
                stake: stakeNum,
              }),
            );
            if (email.trim()) sessionStorage.setItem('signup-email', email.trim());
          } catch {
            /* private mode: the door still opens */
          }
          navigate(authPath('signup', location));
        }}
      />
    );
  /** One branch's column (docs/ui-conventions.md, "The proposal view", P6):
   *  its word and its call as the heading, its OWN verbs quoted from its own
   *  book, its position under them, and its branch rule at the foot. */
  const branchColumn = (which: 'approved' | 'declined') => {
    const book = branchShape(which);
    if (!book) return null;
    const held = heldOn(book.marketId);
    const mine = branch === which;
    return (
      <BranchTicket
        key={which}
        branch={which}
        call={book.consensus === null ? null : pairCall(book.consensus)}
        /* Deepening this branch's own book. An unfunded branch is funded from
           the verbs panel's unfunded state below, so the column offers the
           control exactly once either way. */
        onInject={user && book.funded ? () => openInject(which) : null}
      >
        {canTrade && !selectedJobDecided && (
          <FloorVerbs
            unit={unit}
            rangeMin={book.rangeMin}
            rangeMax={book.rangeMax}
            probability={probabilityOf(book)}
            liquidity={book.liquidity}
            funded={book.funded}
            traders={book.traders}
            pool={book.pool}
            lastTradeAt={lastTradeOf(book.history)}
            now={now}
            stake={stakeNum}
            stakeText={stakeText}
            onStake={setStake}
            signedIn={!!user}
            onVerb={direction => {
              setBranch(which);
              if (user) {
                setBetModal(direction);
                setBetDoor(null);
              } else {
                setBetDoor(direction);
              }
            }}
            onInject={user ? () => openInject(which) : null}
          >
            {user && mine && betModal && inlineTicket(book, `if ${which}`)}
            {!user && mine && betDoor && book.funded && signupDoor(book)}
          </FloorVerbs>
        )}
        {trading && !selectedJobDecided && held && (
          <PositionRow
            direction={held.direction}
            shares={held.shares}
            totalCost={held.totalCost}
            probability={probabilityOf(book)}
            liquidity={book.liquidity}
            onSell={() => {
              setBranch(which);
              setBetModal('manage');
            }}
          />
        )}
      </BranchTicket>
    );
  };

  return (
    <div className="pubws pubws--center">
      <TopBar
        user={!!user}
        ready={!authLoading}
        floor={idOrSlug ? { idOrSlug, name: ws.name } : null}
        canFund={canManage}
        canManage={canManage}
        onOtto={user ? () => setAskingOtto(true) : undefined}
      />
      {/* Otto is ONE panel with two doors, the bar's link and the Otto row
          under the activity block (docs/ui-conventions.md, "The Otto row").
          The corner dock is not drawn any more: it covered the proposal
          rows at the foot of the page. */}
      {idOrSlug && (
        <FloorChat
          idOrSlug={idOrSlug}
          workspaceName={ws.name}
          metricLabel={selectedJob ? null : metricLabel}
          signedIn={!!user}
          dock={false}
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
      {/* `pubws-main--context` marks the plain market view, which is the
          only view with a left rail: with a proposal selected the floor is
          two columns at every width, the pair beside the proposals
          (docs/ui-conventions.md, "The rails"). */}
      <main className={`pubws-main pubws-main--floor${selectedJob ? '' : ' pubws-main--context'}`}>
        <div className="pubws-center">
          {/* The floor identity leads (docs/ui-conventions.md, "The floor
            head, the owner row and the run-a-floor row"): the FLOOR label
            with the floor's own facts, the name, the one-liner. Fixed
            across proposal selection: only the column below it swaps. */}
          {ws.name && (
            <FloorHead
              workspaceId={ws.workspaceId}
              name={ws.name}
              description={ws.description ?? null}
              facts={floorFacts}
              canManage={canManage}
              onSaved={reload}
            />
          )}
          {/* Directly under the identity at every width: the owner's three
            jobs, or, for everyone else, the one door to running a floor of
            their own. Never both. */}
          {canManage ? (
            <OwnerRow
              report={
                floorHasReportedMetric && hero?.metricId
                  ? () => setOwnerDialog({ kind: 'report', metricId: hero.metricId, metricName: metricLabel })
                  : null
              }
              decisions={awaitingDecision.length}
              onDecide={() => {
                const oldest = awaitingDecision[0];
                if (oldest) setSelectedJobId(oldest.id);
              }}
              onManage={() => setOwnerDialog({ kind: 'metrics' })}
            />
          ) : (
            <RunFloorRow signedIn={!!user} />
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
          {/* P1 (docs/ui-conventions.md, "The proposal view"): the way back
            on the left, and what this is on the right. */}
          {selectedJob && (
            <div className="pubws-back-row">
              <button className="pubws-back" onClick={() => setSelectedJobId(null)}>
                ← Back to the market
              </button>
              <ProposalLabel
                number={selectedJob.number ?? null}
                status={selectedJob.status ?? 'pending'}
                editedAt={selectedJob.editedAt ?? null}
              />
            </div>
          )}
          {/* P2: the headline, then the question in the question's own
            voice. The condition lives in the question, never in a second
            copy of it. */}
          {selectedJob && <h1 className="pubws-proposal-title">{splitAsk(selectedJob.title).rest}</h1>}
          {/* The question is one sentence whose metric and date words ARE
            the pickers (docs/ui-conventions.md, "The question line"). It is
            an h2 that is a block child of .pubws-center: the controls go
            INSIDE the heading, never in a wrapper around it. */}
          {hero && (
            <QuestionLine
              horizons={horizons}
              hero={hero}
              workspaceName={ws.name}
              onSelect={setHorizonId}
              condition={
                selectedJob
                  ? {
                      who: selectedJob.proposedByName ?? 'someone',
                      ask: selectedJob.askUsd ?? splitAsk(selectedJob.title).ask ?? 0,
                    }
                  : null
              }
              flashed={flashContract}
            />
          )}
          {/* Every open book of the floor, once, under the question below
            1400px; the left rail carries the same list above it. Not in the
            proposal view, whose column is the pair. */}
          {hero && !selectedJob && (
            <BooksRow
              horizons={books}
              workspaceName={ws.name}
              selectedId={hero.marketId}
              onPick={setHorizonId}
              onManage={canManage ? () => setOwnerDialog({ kind: 'metrics' }) : null}
              proposals={
                ws.proposals !== undefined ? { count: pendingProposals.length, largest: largestPendingImpact } : null
              }
              onJumpToProposals={() => scrollToAction('contract')}
              unit={unit}
            />
          )}
          {hero && active && (
            <>
              {/* The plain market view's band and settlement line. With a
                proposal on screen the pair band replaces them: the numbers
                that matter there are the two branches' own. */}
              {!selectedJob && (
                <>
                  <NumbersBand
                    hero={hero}
                    consensus={consensus}
                    unit={unit}
                    workspaceName={ws.name}
                    now={now}
                    priceSeries={active.history}
                    nowReading={nowReading}
                    lastReadingAt={lastReading?.at ?? null}
                    readingIsStale={readingIsStale}
                    canReport={canManage && !!hero.metricId}
                    onReport={() =>
                      setOwnerDialog({ kind: 'report', metricId: hero.metricId, metricName: metricLabel })
                    }
                  />
                  {/* A market on a number that does not exist yet says so,
                    once, between the band and the settlement line. */}
                  {hero.settlesNaForNow && <p className="pubws-na-note">{settleNoteOf(hero)}</p>}
                  <SettlementLine
                    hero={hero}
                    unit={unit}
                    description={horizonDescription}
                    now={now}
                    lastReadingAt={lastReading?.at ?? null}
                    expanded={defExpanded}
                    onToggle={() => setDefExpanded(v => !v)}
                    canManage={canManage}
                    onEdit={() => setOwnerDialog({ kind: 'metrics' })}
                  />
                </>
              )}
              {/* P3, the work: what is promised, before any button. The
                manager edits it in place, same three fields as posting. */}
              {selectedJob &&
                (editingJob ? (
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
                  <WorkBlock
                    description={selectedJob.description ?? null}
                    ask={selectedJobAsk}
                    payee={selectedJob.proposedByName ?? 'the proposer'}
                    expanded={descExpanded}
                    onToggle={() => setDescExpanded(v => !v)}
                    canEdit={canEditJob}
                    onEdit={() => {
                      const split = splitAsk(selectedJob.title);
                      setJobAsk(split.ask !== null ? String(split.ask) : '');
                      setJobTitle(split.rest);
                      setJobDesc(selectedJob.description ?? '');
                      setJobErr('');
                      setEditingJob(true);
                    }}
                  />
                ))}
              {/* P4, the pair band: both calls with their own books, and the
                difference between them in ink. */}
              {selectedJob && pair && (
                <PairBand
                  approved={pair.approvedConsensus}
                  declined={pair.declinedConsensus}
                  print={pairCall}
                  unit={unit}
                  metricLabel={captionLabel(metricLabel, ws.name)}
                  facts={{
                    approved: {
                      pool: pair.approvedPool ?? 0,
                      traders: pair.approvedTraders ?? 0,
                      lastTradeAt: lastTradeOf(condHistory?.approved),
                    },
                    declined: {
                      pool: pair.declinedPool ?? 0,
                      traders: pair.declinedTraders ?? 0,
                      lastTradeAt: lastTradeOf(condHistory?.declined),
                    },
                  }}
                  why={decisionWhy}
                  now={now}
                />
              )}
              {/* P5, the decision band: the owner's, and it precedes the
                tickets at every width. */}
              {selectedJob &&
                (canManage ? (
                  <DecisionBand
                    payee={selectedJob.proposedByName ?? 'the proposer'}
                    ask={selectedJobAsk}
                    decided={
                      selectedJobDecided
                        ? {
                            word: selectedJob.status === 'approved' ? 'Approved' : 'Declined',
                            day: dayOf(selectedJob.resolvedAt ?? null),
                          }
                        : null
                    }
                    busy={decideBusy}
                    error={decideErr}
                    mode={decideMode}
                    onMode={next => {
                      setDecideMode(next);
                      setDecideErr('');
                      if (next !== 'decline') setDeclineReason('');
                    }}
                    onApprove={() => void decide('approve')}
                    onDecline={() => void decide('decline')}
                    onRemove={() => void removeJob()}
                    reason={declineReason ?? ''}
                    onReason={setDeclineReason}
                  />
                ) : selectedJobDecided ? (
                  <DecisionBand
                    payee={selectedJob.proposedByName ?? 'the proposer'}
                    ask={selectedJobAsk}
                    decided={{
                      word: selectedJob.status === 'approved' ? 'Approved' : 'Declined',
                      day: dayOf(selectedJob.resolvedAt ?? null),
                    }}
                    busy={false}
                    error=""
                    mode={null}
                    onMode={() => {}}
                    onApprove={() => {}}
                    onDecline={() => {}}
                    onRemove={() => {}}
                    reason=""
                    onReason={() => {}}
                  />
                ) : (
                  <DecisionNote />
                ))}
              {/* P6, the two tickets: both books on screen, each quoting
                from its own price and stating its own rule. There is no
                switch and no pill toggle. */}
              {selectedJob && pair && (
                <div className="pubws-tickets-wrap">
                  <div className="pubws-tickets">
                    {branchColumn('approved')}
                    {branchColumn('declined')}
                  </div>
                  <p className="pubws-pair-rule">
                    The book left standing pays at the real number{settleWords ? ` on ${settleWords}` : ''}.
                  </p>
                </div>
              )}
              {/* The verbs panel of the plain market view: the stake and
                this book's facts, the two verbs with a payout already
                quoted for that stake, and the range line that is the rule
                the two previews follow. */}
              {!selectedJob && canTrade && (
                <FloorVerbs
                  unit={unit}
                  rangeMin={active.rangeMin}
                  rangeMax={active.rangeMax}
                  probability={shownProbability}
                  liquidity={active.liquidity}
                  funded={active.funded}
                  traders={active.traders}
                  pool={active.pool}
                  lastTradeAt={lastTradeAt}
                  now={now}
                  stake={stakeNum}
                  stakeText={stakeText}
                  onStake={setStake}
                  signedIn={!!user}
                  onVerb={direction => {
                    if (user) {
                      setBetModal(direction);
                      setBetDoor(null);
                    } else {
                      setBetDoor(direction);
                    }
                  }}
                  onInject={user ? () => openInject() : null}
                >
                  {user && betModal && inlineTicket(active, `${captionLabel(metricLabel, ws.name)} · ${hero.label}`)}
                  {!user && betDoor && active.funded && signupDoor(active)}
                </FloorVerbs>
              )}
              {/* Your position: one ruled icon row under the verbs, never
                two rows, because a trader holds one net side. */}
              {!selectedJob && trading && heldPosition && (
                <PositionRow
                  direction={heldPosition.direction}
                  shares={heldPosition.shares}
                  totalCost={heldPosition.totalCost}
                  probability={shownProbability}
                  liquidity={active.liquidity}
                  onSell={() => setBetModal('manage')}
                />
              )}
              {/* ONE chart, the number's own, with the market's call drawn
                on it (docs/ui-conventions.md, "The chart"). The second
                chart, "how the call moved", is not rendered any more. */}
              {consensus !== null && (
                <div className="pubws-numchart">
                  <NumberChart
                    points={hero.metricHistory}
                    markers={datesOf(horizons, hero.metricId).flatMap(d => {
                      if (!d.resolvesOn) return [];
                      const pr = selectedJob?.markets.find(
                        m => m.targetDate === d.targetDate && (m.metricId === undefined || m.metricId === d.metricId),
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
                    /* The amber line is the BASELINE market's own call, on
                       a proposal too: the pair's two lines are drawn beside
                       it, never in its place. */
                    call={priceSeriesOf(hero.marketId, ws, horizonPrices)}
                    branches={
                      selectedJob && pair
                        ? { approved: condHistory?.approved ?? [], declined: condHistory?.declined ?? [] }
                        : null
                    }
                    rangeMin={hero.rangeMin}
                    rangeMax={hero.rangeMax}
                    selectedResolvesOn={hero.resolvesOn ?? new Date().toISOString()}
                    granularity={granularityOf(hero.targetDate)}
                    unit={unit}
                    now={now}
                    preview={chartPreview}
                    center={<span className="pubws-chart-cap">{captionLabel(metricLabel, ws.name)}</span>}
                  />
                </div>
              )}
              {/* What is left to reach the price, in the reader's own
                arithmetic. Hidden while a proposal is selected, because then
                the number on screen is that proposal's impact. */}
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
              {/* Discussion, Positions, Activity: the conversation and the
                tape under the chart, following the one view. */}
              {idOrSlug && (
                <div className="pubws-activity">
                  <FloorComments
                    idOrSlug={idOrSlug}
                    /* Right-aligned on the tab row: what the book on screen
                       holds, and the way to deepen it for anyone signed in
                       (docs/ui-conventions.md, "Activity"). On a proposal
                       the panel covers both branches, so the row reads both
                       pools. An unfunded book is not deepened from here: its
                       own panel above is already offering it, once. */
                    trailing={
                      <span className="pubws-pool-inject">
                        <span className="pubws-pool-inject-n">
                          {selectedJob && pair
                            ? `${short(pair.approvedPool ?? 0)} cr · ${short(pair.declinedPool ?? 0)} cr`
                            : `${short(active.pool)} cr pool`}
                        </span>
                        {/* On a proposal the row covers the pair, so one
                            control here could not name which of the two books
                            it deepens: each branch is deepened from its own
                            column (P6). */}
                        {user && active.funded && !selectedJob && (
                          <button type="button" className="pubws-facts-act" onClick={() => openInject()}>
                            Inject liquidity
                          </button>
                        )}
                      </span>
                    }
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
                        : { marketId: hero.marketId }
                    }
                    canPost={!!user && joined}
                    onRequireSignup={() => navigate(authPath('signup', location))}
                  />
                </div>
              )}
              {/* The Otto row (docs/ui-conventions.md, "The Otto row"): one
                ruled row under the activity block, the second of his two
                doors, and the way to connecting an AI of one's own. */}
              <div className="pubws-otto-row">
                <span className="pubws-otto-row-mark" aria-hidden="true">
                  O
                </span>
                <button type="button" className="pubws-otto-row-go" onClick={() => setAskingOtto(true)}>
                  {canManage ? 'Otto runs this floor with you →' : 'Otto runs this market with you →'}
                </button>
                <Link className="pubws-otto-row-own" to="#account">
                  connect your own AI
                </Link>
                <p className="pubws-otto-row-line">
                  {!user
                    ? 'Reading the book is all he can do until you sign up; signed in he trades, funds and reports as you.'
                    : canManage
                      ? 'Reports numbers, funds books, decides proposals, all by chat.'
                      : 'Trades, funds and reports as you.'}
                </p>
              </div>
            </>
          )}
        </div>
        {/* The proposals board IS the right rail, in view on the fold. It
            comes before the left rail in the DOM so that on a phone the
            stack is market, proposals, season and announcements, standings:
            the next thing to trade before the context. */}
        {ws.proposals !== undefined && hero ? (
          <aside className="pubws-rail pubws-rail--right" aria-label="Proposals">
            <JobsBoard
              proposals={ws.proposals}
              unit={unit}
              horizonDate={hero.targetDate}
              horizonMetricId={hero.metricId}
              selectedId={selectedJobId}
              onSelect={id => setSelectedJobId(cur => (cur === id ? null : id))}
              viewerId={user?.id ?? null}
              signedIn={!!user}
              onRequireSignup={() => navigate(authPath('signup', location))}
              workspaceName={ws.name}
              proposalReward={ws.proposalReward}
              metricNames={metricNames}
              onPropose={async (title, description, askUsd) => {
                if (!user) {
                  navigate(authPath('signup', location));
                  return;
                }
                const created = (await api.createProposal({ title, description, askUsd })) as { id?: string };
                reload();
                if (created?.id) setSelectedJobId(created.id);
              }}
            />
          </aside>
        ) : (
          <aside className="pubws-rail pubws-rail--right" aria-hidden="true" />
        )}
        {/* The left rail is about THIS floor and never about other people
            (docs/ui-conventions.md, "The rails"): from the top, the books
            list, the season, the announcements. Only in the plain market
            view: a proposal's page is about the proposal and its two
            branches. */}
        {!selectedJob && hero && (
          <aside className="pubws-rail pubws-rail--left" aria-label="This floor">
            <BooksList
              horizons={books}
              workspaceName={ws.name}
              selectedId={hero.marketId}
              onPick={setHorizonId}
              onManage={canManage ? () => setOwnerDialog({ kind: 'metrics' }) : null}
            />
            <SeasonAdvert season={season} signedIn={!!user} canManage={canManage} />
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
        {/* The standings sit under the Otto row: nothing about other people
            above the fold. */}
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
  canManage = false,
  busy = false,
  onOtto,
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
  /** Whether they manage the floor under the bar: the owner of their own
   *  floor is not offered "Earn credits" on it (critics' round 3). */
  canManage?: boolean;
  /** Opens Otto's panel. The link is drawn only where there is a panel to
   *  open (the floor), and only for someone signed in: the dock in the
   *  corner is gone (docs/ui-conventions.md, "The Otto row"). */
  onOtto?: () => void;
}) {
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
      {/* Rendered only after the session check settles: while it is
          pending, user is still null, and a signed-in visitor would see
          "Log in" flash and vanish. Anonymous visitors get it fading in. */}
      <div className="pubws-topbar-right">
        {ready &&
          (user ? (
            <>
              {/* One door to the money, not two (owner ask 2026-08-30), and
                  none at all for the owner of the floor under the bar, who
                  reads "Earn credits" as their own bill. */}
              {!canManage && <EarnDoor />}
              <div className="pubws-fade">
                <NotificationsBell />
              </div>
              {onOtto && (
                <button type="button" className="pubws-otto-link" onClick={onOtto}>
                  Otto
                </button>
              )}
              <div className="pubws-fade">
                <AccountMenu floor={floor} canFund={canFund} />
              </div>
            </>
          ) : (
            <>
              {/* Signed out the right side is the two doors and nothing else
                  (docs/ui-conventions.md, "The top bar and the account
                  menu"): the verbs panel's "free credits to start" line
                  carries the earn offer where the stake is, and the bug,
                  Discord and theme icons moved into the account menu. */}
              <Link to={authPath('login', location)} className="pubws-login pubws-fade">
                Log in
              </Link>
              <Link to={authPath('signup', location)} className="pubws-cta pubws-cta--small pubws-signup pubws-fade">
                Sign up
              </Link>
            </>
          ))}
      </div>
    </nav>
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
