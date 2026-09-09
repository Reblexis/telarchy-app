import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicProposal, PublicProposalMarketPair } from '../lib/api';
import { api } from '../lib/api';
import { settleShortOf } from '../lib/floor-horizons';
import { formatImpact, pairCallPrinter } from '../lib/formatImpact';
import { FloorModal } from './FloorModal';
import { Dollar, Drop, People } from './MarketFacts';

/**
 * The jobs board: the proposal side of the trading floor, rendered for
 * signed-in participants (paid-jobs round 1, charter of 2026-08-09).
 * A proposal is an OFFER TO DO WORK at a price ("$80: I will ..."), never a
 * request for someone else to do it. Every label here has to carry that
 * direction: a public reader asked "can i ask anything and you'll do it with
 * my credits?" when the button said "Suggest a proposal" and the only money beside
 * it was a credit cost. Credits are the anti-spam stake; the payout is USD to
 * the proposer. Its conditional
 * pair prices what happens to the metric if the money is sent.
 *
 * One number per job (owner decision 2026-08-09: as few numbers as
 * possible): the impact, which IS if-done minus if-not-done.
 *
 * The board is a SELECTOR, not a second trading surface (owner decision,
 * same day): picking a job re-points the page's one market view and its
 * one ticket at that job's conditional market. Nothing here trades.
 *
 * The form asks for the USD ask separately and composes it into the title,
 * so the API stays untouched (round 1 encodes the ask as a text
 * convention). The ask is required: every job has a price.
 */

interface Props {
  proposals: PublicProposal[];
  unit: string;
  /** The job whose conditional market the page is currently showing. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPropose: (title: string, description: string, askUsd: number) => Promise<void>;
  /** Whether a participant is signed in. When false, the propose button
      becomes a signup door rather than opening a form the submit would
      bounce anyway. */
  signedIn: boolean;
  /** Called when a signed-out visitor taps the propose button. */
  onRequireSignup: () => void;
  /** The floor's one horizon: the delta the charter funds on, so it is what
      the ballot ranks and prints. Null before the markets arrive, where the
      largest-impact fallback stands. */
  horizonDate?: string | null;
  /** The metric of that horizon. With two metrics read on one date a pair is
      only identified by BOTH (owner report 2026-08-26: the board printed one
      metric's delta under the other's caption). Absent on a payload that
      predates metricId on pairs, where date alone still has to do. */
  horizonMetricId?: string | null;
  /** The signed-in participant's id. A row never names the reader as its own
      proposer (docs/ui-conventions.md, "The proposals board": "the proposer
      named only when they are not the viewer"), and the owner's foot counts
      how many of the open ones are theirs. */
  viewerId?: string | null;
  /** Whether the reader owns this floor. The owner's board is an INBOX: the
      payment requests come first under a count line that says what it
      counts, then a thin rule, then the rest by impact. */
  canManage?: boolean;
  /** Funding a pair nobody has priced. Absent for a signed-out visitor, who
      has nothing to inject with. */
  onInject?: ((id: string) => void) | null;
  /** Workspace name, for the "do something useful for X?" propose prompt. */
  workspaceName: string;
  /** The workspace's proposalReward, in credits. Defaults to 0, so the board
   *  must not promise a bounty it does not pay. */
  proposalReward?: number;
  /** The numbers this floor prices, for the form's placeholders. A proposer
   *  arrives knowing what they want to do and not which metric it moves;
   *  naming them in the prompt is what turns "Links: portfolio" into a pitch
   *  the market can price (owner direction 2026-08-20). */
  metricNames?: string[];
}

/** A signed impact figure as the ballot prints it: the one impact precision
 *  every surface shares (lib/formatImpact), so the rail, the decision row and
 *  the chip beside the call print the same string. */
export function fmtDelta(d: number, unit: string): string {
  return formatImpact(d, unit);
}

/** On the ballot: not yet decided by the owner. */
export function isPending(p: PublicProposal): boolean {
  return !p.status || p.status === 'pending';
}

/**
 * The ballot in the floor's order: by ABSOLUTE impact, largest first, ties
 * by pool, and a pair with no liquidity last (docs/ui-conventions.md, "The
 * proposals board"; revised 2026-09-08, superseding the pool-first order of
 * 2026-09-02: the board is the ranking the owner acts on, and what a
 * proposal does to the number is that ranking). One function, so a panel
 * that shows the floor elsewhere (the /owners product moment) can never
 * disagree with the floor.
 */
export function pendingBallot(
  proposals: PublicProposal[],
  impactOf: (p: PublicProposal) => number | null,
  poolFor: (p: PublicProposal) => number = poolOf,
  pricedFor: (p: PublicProposal) => boolean = () => true,
): PublicProposal[] {
  return proposals.filter(isPending).sort(byImpactThenPool(impactOf, poolFor, pricedFor));
}

/** The one comparator the ballot and the owner's inbox group share. */
export function byImpactThenPool(
  impactOf: (p: PublicProposal) => number | null,
  poolFor: (p: PublicProposal) => number = poolOf,
  pricedFor: (p: PublicProposal) => boolean = () => true,
) {
  return (a: PublicProposal, b: PublicProposal) => {
    // An unpriced pair has no impact to rank on, so it goes to the bottom
    // rather than to the top on a delta nobody has traded.
    const pa = pricedFor(a);
    const pb = pricedFor(b);
    if (pa !== pb) return pa ? -1 : 1;
    const ia = Math.abs(impactOf(a) ?? 0);
    const ib = Math.abs(impactOf(b) ?? 0);
    if (ia !== ib) return ib - ia;
    return poolFor(b) - poolFor(a);
  };
}

/** What this proposal asks in whole USD: the stored column, or the price the
 *  title carries on a proposal that predates it. */
export function askOf(p: PublicProposal): number {
  return p.askUsd ?? splitAsk(p.title).ask ?? 0;
}

/**
 * What the owner has to decide (docs/ui-conventions.md, "The owner's rail is
 * an inbox"): PENDING, with a non-zero ask, and proposed by somebody other
 * than the owner. A pending proposal with a zero ask, or one the owner
 * posted, is still pending and is not counted. The floor head's owner row
 * reads the same list, so its count and the board's agree and its press
 * lands on the first row of the group.
 */
export function paymentRequests(
  proposals: PublicProposal[],
  ownerId: string | null | undefined,
  order?: (a: PublicProposal, b: PublicProposal) => number,
): PublicProposal[] {
  const group = proposals.filter(p => isPending(p) && askOf(p) > 0 && p.proposedByHandle !== ownerId);
  return order ? group.sort(order) : group;
}

/**
 * What is behind a proposal: both branches of every pair, added up (owner ask
 * 2026-09-02). A proposal's forecast is two books, and half the money is not
 * the number a reader comparing two proposals wants. A branch with no market
 * counts as nothing rather than as a hole, which is not the same as a market
 * nobody has funded (zero).
 */
export function poolOf(p: PublicProposal): number {
  return (p.markets ?? []).reduce((sum, m) => sum + (m.approvedPool ?? 0) + (m.declinedPool ?? 0), 0);
}

/** Round-1 convention: the USD ask is composed into the title ("$80: ...").
    Parse it back out so the row can show cost as a structured field. */
export function splitAsk(title: string): { ask: number | null; rest: string } {
  const m = title.match(/^\$(\d+):\s*(.*)$/s);
  return m ? { ask: parseInt(m[1], 10), rest: m[2] } : { ask: null, rest: title };
}

/**
 * What posting costs and what approval pays, in one sentence. The board's
 * foot and the propose dialog's confirm both print THIS string, so the two
 * surfaces can never disagree (docs/ui-conventions.md, "The proposals
 * board"). The credit bounty is the workspace's own `proposalReward` and is
 * 0 unless the workspace sets it, so a floor never promises credits it does
 * not pay.
 */
export function proposeTerms(proposalReward: number): string {
  const bonus = proposalReward > 0 ? `, plus ${proposalReward.toLocaleString('en-US')} cr` : '';
  return `Free to post. If approved you are paid the ask in real money${bonus}.`;
}

/**
 * "net revenue", "net revenue and weekly traders", "a, b and c": the metrics
 * as a reader would say them out loud. Falls back to a phrase rather than an
 * empty gap, because the placeholder is a sentence and a sentence with a hole
 * in it teaches nothing.
 */
export function metricsPhrase(names: string[]): string {
  const clean = names.map(n => n.trim()).filter(Boolean);
  if (clean.length === 0) return 'the number on this page';
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

function headlineDelta(p: PublicProposal): number | null {
  const deltas = p.markets.map(m => m.delta).filter((d): d is number => d !== null);
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), deltas[0]);
}

/**
 * This proposal's priced impact on one horizon: the pair for the metric AND
 * the date on screen. Date alone picked the first pair on that date, which
 * on a floor with two metrics read on one date was whichever had the larger
 * delta (owner report 2026-08-26).
 */
export function deltaAt(
  p: PublicProposal,
  targetDate: string | null | undefined,
  metricId?: string | null,
): number | null {
  return pairAt(p, targetDate, metricId)?.delta ?? null;
}

/** This proposal's pair for the metric AND date on screen, or null. */
export function pairAt(
  p: PublicProposal,
  targetDate: string | null | undefined,
  metricId?: string | null,
): PublicProposalMarketPair | null {
  if (!targetDate) return null;
  return (
    p.markets.find(
      m => m.targetDate === targetDate && (!metricId || m.metricId === undefined || m.metricId === metricId),
    ) ?? null
  );
}

/** The credits behind both branches of one pair, added up: what somebody put
 *  behind this proposal's forecast on the horizon the board is reading. */
export function poolOfPair(pair: PublicProposalMarketPair | null): number {
  if (!pair) return 0;
  return (pair.approvedPool ?? 0) + (pair.declinedPool ?? 0);
}

/** Whether a pair is priced: BOTH branches hold liquidity, which is the
 *  platform's own rule for when a pair has a price (an opening price is the
 *  market's price until somebody moves it). An unpriced pair prints "no
 *  price yet" and sorts last. */
export function pairIsPriced(pair: PublicProposalMarketPair | null): boolean {
  if (!pair) return false;
  return (pair.approvedLiquidity ?? 0) > 0 && (pair.declinedLiquidity ?? 0) > 0 && pair.delta !== null;
}

export function JobsBoard({
  proposalReward = 0,
  proposals,
  unit,
  selectedId,
  onSelect,
  onPropose,
  signedIn,
  onRequireSignup,
  workspaceName,
  metricNames = [],
  horizonDate,
  horizonMetricId,
  viewerId = null,
  canManage = false,
  onInject = null,
}: Props) {
  const navigate = useNavigate();
  // The number the charter funds on, falling back to the largest priced delta
  // before the floor's horizon is known.
  // With a horizon on screen the board prints THAT pair's delta or "open";
  // it never borrows another pair's number. The largest-delta fallback is
  // only for the moment before the markets arrive and no horizon is known:
  // used as a fallback for an unpriced pair, it printed the active-traders
  // delta under the valuation caption while the ticket said "not yet priced"
  // (owner report, docs/ui-conventions.md "the board reads the pair on screen").
  const pairOf = (p: PublicProposal) => pairAt(p, horizonDate, horizonMetricId);
  const impactOf = (p: PublicProposal) => (horizonDate ? deltaAt(p, horizonDate, horizonMetricId) : headlineDelta(p));
  /** What is behind the pair on screen, and whether it is priced at all:
   *  both the ranking and the row's own credits fact read the pair the board
   *  is reading, never another horizon's. */
  const poolFor = (p: PublicProposal) => poolOfPair(pairOf(p));
  const pricedFor = (p: PublicProposal) => pairIsPriced(pairOf(p));
  const [foldOpen, setFoldOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [ask, setAsk] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [placed, setPlaced] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Payment details live in account settings, not in the job form (owner
  // direction 2026-08-10). The form only REPORTS them, as a facts row:
  // set means the job can be paid, unset points at the account menu, and
  // the server enforces it either way at creation.
  const [accountPayout, setAccountPayout] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!formOpen) return;
    api
      .getParticipant()
      .then(p => setAccountPayout((p as { payoutHandle?: string | null }).payoutHandle ?? null))
      .catch(e => {
        console.error('participant fetch failed:', e);
        setAccountPayout(null);
      });
  }, [formOpen]);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // The board opens on the live ballot: pending proposals are the list and
  // the decided ones are folded behind one row (owner report 2026-09-01,
  // "there are too many proposals visible"). A decided proposal cannot be
  // traded on or influenced, and decided proposals carry the largest
  // impacts, so ranking them in with the pending ones put the whole archive
  // above the fold. The pending ones keep the ranking the owner acts on;
  // the decided ones are a record and read newest decision first (owner
  // ask 2026-09-04). docs/ui-conventions.md, "The board opens on the live
  // ballot".
  const byImpact = (a: PublicProposal, b: PublicProposal) => (impactOf(b) ?? 0) - (impactOf(a) ?? 0);
  // What a proposal does to the number is the ranking (see `pendingBallot`).
  const order = byImpactThenPool(impactOf, poolFor, pricedFor);
  const pending = pendingBallot(proposals, impactOf, poolFor, pricedFor);
  /* The owner's inbox group, in the board's own order, so the owner row's
     press lands on the row the board draws first. */
  const inbox = canManage ? paymentRequests(pending, viewerId, order) : [];
  const inboxIds = new Set(inbox.map(p => p.id));
  const rest = pending.filter(p => !inboxIds.has(p.id));
  /* How many of the open ones the owner posted: no row wears a "yours" tag,
     so the count lives in the foot instead. */
  const mine = viewerId ? pending.filter(p => p.proposedByHandle === viewerId).length : 0;
  /* The count line under the caption, labelled by what it counts. */
  const largest = pending.reduce<number | null>((best, p) => {
    if (!pricedFor(p)) return best;
    const d = impactOf(p);
    if (d === null) return best;
    return best === null || Math.abs(d) > Math.abs(best) ? d : best;
  }, null);
  // Newest decision first; a proposal with no decision time sorts last and
  // impact breaks a tie.
  const decidedAt = (p: PublicProposal) => (p.resolvedAt ? Date.parse(p.resolvedAt) : Number.NEGATIVE_INFINITY);
  const byDecision = (a: PublicProposal, b: PublicProposal) => {
    const ta = decidedAt(a);
    const tb = decidedAt(b);
    if (ta !== tb) return ta > tb ? -1 : 1;
    return byImpact(a, b);
  };
  const decided = proposals.filter(p => !isPending(p)).sort(byDecision);

  // A board with nothing pending has no ballot to bury, so the decided ones
  // ARE the list and there is no fold; a board with nothing decided has
  // nothing to fold away.
  const foldable = pending.length > 0 && decided.length > 0;
  // A `#proposal=<id>` link from a notification can point the page at a
  // decided proposal, and the fold must never hide the row the view is
  // pointed at.
  const decidedSelected = !!selectedId && decided.some(p => p.id === selectedId);
  const showDecided = !foldable || foldOpen || decidedSelected;
  const toggleFold = () => {
    // Collapsing releases a selected decided proposal rather than hiding it,
    // so the control can never be dead.
    if (showDecided && decidedSelected && selectedId) onSelect(selectedId);
    setFoldOpen(!showDecided);
  };

  // The confirm stays disabled until these hold, so the short errors
  // below are a fallback for the server, not the primary guardrail. A $0
  // job needs no payment details (owner decision 2026-08-10); a paid one
  // is blocked, with a warning, until the account has them.
  const askNum = Math.max(0, Math.floor(parseFloat(ask) || 0));
  const needsPayout = askNum > 0 && accountPayout === null;
  const formValid = title.trim().length > 0 && !needsPayout;

  const submit = async () => {
    if (!title.trim()) {
      setFormErr('Add a proposal.');
      return;
    }
    // The title carries the price because it reads well and travels
    // (activity log, share text); the number is also sent separately, and
    // that copy is the one anything financial reads. A free job keeps a
    // clean title. Where the money goes comes from the account; the
    // server refuses a paid job without it.
    const fullTitle = askNum > 0 ? `$${askNum}: ${title.trim()}` : title.trim();
    setFormErr('');
    setFormBusy(true);
    try {
      await onPropose(fullTitle, desc.trim(), askNum);
      // The green moment: the one place the form earns its color.
      setPlaced(true);
      closeTimer.current = setTimeout(() => {
        setAsk('');
        setTitle('');
        setDesc('');
        setPlaced(false);
        setFormOpen(false);
      }, 900);
    } catch (e) {
      setFormErr((e as Error).message || 'Failed to submit');
    } finally {
      setFormBusy(false);
    }
  };

  /** One proposal's row (docs/ui-conventions.md, "The proposals board"):
      the number and the title, under them the two calls of the pair on
      screen and the icon row, and the impact right-aligned in ink. The same
      object in both groups: the fold changes which proposals are listed,
      never how a proposal reads. */
  const row = (p: PublicProposal, decide = false) => {
    const pair = pairOf(p);
    const delta = impactOf(p);
    const priced = pricedFor(p);
    const selected = selectedId === p.id;
    const { rest: titleRest } = splitAsk(p.title);
    const askUsd = askOf(p);
    // The two calls at the pair band's precision, so "17.04 / 17.00" never
    // reads as "17.0 / 17.0" beside a difference of +0.04.
    const call = pairCallPrinter(pair?.approvedConsensus, pair?.declinedConsensus, unit);
    return (
      <li key={p.id} className={selected ? 'is-open' : ''}>
        <button
          className={`pubws-ballot-row${selected ? ' is-selected' : ''}`}
          aria-pressed={selected}
          title={titleRest}
          onClick={() => onSelect(p.id)}
        >
          <span className="pubws-ballot-main">
            <span className="pubws-ballot-title">
              {/* The number leads: it is how a person names the proposal
                  ("what does #7 mean?"), so it reads before the words. */}
              {p.number ? <span className="pubws-ballot-num">#{p.number}</span> : null}
              {titleRest}
            </span>
            {/* Both calls of the pair on screen, in small mono: the row says
                what the two worlds are worth, not only their difference. */}
            {priced && pair?.approvedConsensus !== null && pair?.declinedConsensus !== null && pair && (
              <span className="pubws-ballot-calls">
                if approved {call(pair.approvedConsensus!)} · if declined {call(pair.declinedConsensus!)}
              </span>
            )}
            {/* The floor head's glyph set, never a sentence and never a
                caret: the ask, the credits behind the pair, the proposer. */}
            <span className="pubws-ballot-facts">
              <span title="paid to the proposer on approval">
                <Dollar /> ${askUsd.toLocaleString('en-US')} ask
              </span>
              {/* The owner's inbox marks the rows that are waiting on them,
                  beside the money they are being asked for. */}
              {decide && <span className="pubws-ballot-decide">decide</span>}
              <span title="credits behind the pair">
                <Drop /> {Math.round(poolFor(p)).toLocaleString('en-US')} cr
              </span>
              {/* A link cannot nest inside the row button, so the name is
                  a span that navigates; stopPropagation keeps the row from
                  also selecting. The reader is never named to themselves:
                  their own rows read as theirs because nobody else is on
                  them. */}
              {p.proposedByName &&
                p.proposedByHandle !== viewerId &&
                (p.proposedByHandle ? (
                  <span>
                    <People /> by{' '}
                    <span
                      className="pubws-name-link"
                      role="link"
                      tabIndex={0}
                      onClick={ev => {
                        ev.stopPropagation();
                        navigate(`/participants/${encodeURIComponent(p.proposedByHandle!)}`);
                      }}
                      onKeyDown={ev => {
                        if (ev.key === 'Enter') {
                          ev.stopPropagation();
                          navigate(`/participants/${encodeURIComponent(p.proposedByHandle!)}`);
                        }
                      }}
                    >
                      {p.proposedByName}
                    </span>
                  </span>
                ) : (
                  <span>
                    <People /> by {p.proposedByName}
                  </span>
                ))}
              {p.status && p.status !== 'pending' && (
                <span className={`pubws-ballot-status is-${p.status}`}>{p.status}</span>
              )}
            </span>
          </span>
          <span className="pubws-ballot-impact">
            {/* The impact is INK, never green: the board ranks proposals, it
                does not approve of them. "±0" says the two worlds are priced
                the same, which is a statement; an unpriced pair says so and
                offers the credits that would fix it. */}
            {!priced ? (
              <>
                <span className="pubws-ballot-delta pubws-ballot-delta--open">no price yet</span>
                {onInject && (
                  <span
                    className="pubws-ballot-inject"
                    role="button"
                    tabIndex={0}
                    onClick={ev => {
                      ev.stopPropagation();
                      onInject(p.id);
                    }}
                    onKeyDown={ev => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.stopPropagation();
                        onInject(p.id);
                      }
                    }}
                  >
                    Inject
                  </span>
                )}
              </>
            ) : delta === 0 ? (
              <span className="pubws-ballot-delta pubws-ballot-delta--open">±{unit}0</span>
            ) : (
              <span className="pubws-ballot-delta">{fmtDelta(delta ?? 0, unit)}</span>
            )}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section className="pubws-section" aria-label="Proposals">
      <div className="pubws-lb-head">
        <h2 className="pubws-h2">Proposals</h2>
        {/* One column label for the whole list instead of one per row; it is
            the header's meta, the same anatomy as the standings rail. */}
        {proposals.length > 0 && (
          <span className="pubws-lb-meta" aria-hidden="true">
            {horizonDate ? `impact on ${settleShortOf(horizonDate) ?? horizonDate}` : 'impact if done'}
          </span>
        )}
      </div>
      {/* What a row is to a trader (docs/ui-conventions.md, "The proposals
          board"; critics' round 2026-09-08: nothing on the rail said why a
          trader would touch it). */}
      <p className="pubws-ballot-why">
        Each is a pair of books: the number if approved, the number if declined. Trade either.
      </p>
      {/* One more ruled line, labelled by what it counts. For the owner the
          board is an INBOX and this line is the header of the group under
          it; for everybody else it says how much is open and how big the
          biggest call is (docs/ui-conventions.md, "The owner's rail is an
          inbox"). */}
      {proposals.length > 0 &&
        (canManage ? (
          inbox.length > 0 ? (
            <p className="pubws-ballot-count pubws-ballot-count--inbox">
              {inbox.length} payment request{inbox.length === 1 ? '' : 's'} ↓
            </p>
          ) : (
            <p className="pubws-ballot-count pubws-ballot-count--none">No payment requests</p>
          )
        ) : (
          <p className="pubws-ballot-count">
            {pending.length} open
            {largest !== null ? ` · largest impact ${fmtDelta(largest, unit)}` : ''}
          </p>
        ))}

      {proposals.length === 0 ? (
        <p className="pubws-lb-empty">Nothing on the ballot yet. Yours could be first.</p>
      ) : (
        <ul className="pubws-ballot">
          {/* The owner's payment requests come first, then a thin rule, then
              every other pending row by absolute impact. */}
          {inbox.map(p => row(p, true))}
          {inbox.length > 0 && rest.length > 0 && <li className="pubws-ballot-rule" aria-hidden="true" />}
          {rest.map(p => row(p))}
        </ul>
      )}
      {/* The foot (docs/ui-conventions.md, "The proposals board"): the
          decided fold, the button, and one line naming what approval pays. */}
      <div className="pubws-ballot-foot">
        {/* One hairline row standing for the archive, in the rail head's
            anatomy: the count left, the action right. */}
        {foldable && (
          <button
            type="button"
            className={`pubws-ballot-fold${showDecided ? ' is-open' : ''}`}
            aria-expanded={showDecided}
            onClick={toggleFold}
          >
            <span className="pubws-ballot-fold-count">{`${decided.length} decided`}</span>
            <span className="pubws-ballot-fold-act">
              {showDecided ? 'Hide' : 'Show'}
              <svg
                className="pubws-ballot-fold-chev"
                width="11"
                height="11"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 6.5L8 10.5L12 6.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        )}
        {showDecided && decided.length > 0 && <ul className="pubws-ballot">{decided.map(p => row(p))}</ul>}
        <button className="pubws-propose-cta" onClick={() => (signedIn ? setFormOpen(true) : onRequireSignup())}>
          + Propose
        </button>
        {/* Surface the upside on the board itself, not only inside the form.
            The credit bounty is the workspace's own proposalReward and
            defaults to 0, so say it only where it is actually paid: a
            hardcoded "plus 500 cr" was a promise most floors do not keep.
            The propose dialog's confirm repeats this phrase verbatim, so the
            two surfaces never disagree. */}
        <p className="pubws-propose-cost">{proposeTerms(proposalReward)}</p>
        {/* No row wears a "yours" tag; the owner reads the count here. */}
        {canManage && mine > 0 && (
          <p className="pubws-ballot-mine">
            {mine} of {pending.length} are yours
          </p>
        )}
      </div>

      {/* The form is the ticket's structure, not just its underlines
          (Codex redesign 2026-08-10): the ask is the hero numeric at the
          top like the bet amount, the consequences live in the same ruled
          facts table, and color only speaks as state, red for errors and
          green for the placed flash. Escape and the backdrop close. */}
      {formOpen && (
        <FloorModal onClose={() => setFormOpen(false)} label="Offer to do the work">
          <div className="jobform">
            <div className="ticket-head jobform-head">
              <div className="jobform-askblock">
                <p className="ticket-label">Your price, paid to you in USD</p>
                <label className="ticket-amt ticket-amt--price jobform-ask">
                  <span className="ticket-amt-unit">$</span>
                  <input
                    value={ask}
                    style={{ width: `${Math.max(4, ask.length)}ch` }}
                    onChange={e => setAsk(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="0"
                    inputMode="numeric"
                    aria-label="Price in USD (required)"
                    required
                  />
                </label>
              </div>
              <button className="ticket-close" aria-label="Close" onClick={() => setFormOpen(false)}>
                ×
              </button>
            </div>

            <label className="jobform-field">
              <span className="ticket-label">
                Proposal{' '}
                <span
                  className={`jobform-count${title.length >= 70 ? ' is-max' : title.length >= 60 ? ' is-near' : ''}`}
                >
                  {title.length}/70
                </span>
              </span>
              <input
                className="jobform-line jobform-line--title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={`I will do a very useful thing for ${workspaceName || 'this company'}`}
                maxLength={70}
                aria-label="Proposal title"
              />
            </label>

            <label className="jobform-field">
              <span className="ticket-label">Pitch</span>
              <textarea
                className="jobform-line jobform-line--desc"
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder={`This will affect ${metricsPhrase(metricNames)} in this way because of these reasons`}
                rows={3}
                aria-label="Proposal pitch"
              />
            </label>

            {/* A paid job cannot go up without somewhere for the money to
                go; the warning names the fix and the confirm stays off. */}
            {needsPayout && (
              <p className="ticket-err">A paid proposal needs payment details first: add them in your account menu.</p>
            )}
            {formErr && <p className="ticket-err">{formErr}</p>}
            {/* The whole deal rides the confirm itself (owner direction
                2026-08-12): the cost belongs at the moment of commitment,
                so the sub-line repeats the board's phrase verbatim. Hidden
                on the placed flash so the green moment stays clean. */}
            <button
              className={`ticket-go${placed ? ' is-placed' : ''}`}
              disabled={formBusy || (!placed && !formValid)}
              onClick={() => void submit()}
            >
              {placed
                ? 'Added to ballot'
                : formBusy
                  ? 'Submitting…'
                  : formValid && askNum > 0
                    ? `Offer this for $${askNum}`
                    : 'Propose'}
              {/* The board's foot prints the same string, so the two
                  surfaces never disagree. */}
              {!placed && <span className="ticket-go-sub">{proposeTerms(proposalReward)}</span>}
            </button>
          </div>
        </FloorModal>
      )}
    </section>
  );
}
