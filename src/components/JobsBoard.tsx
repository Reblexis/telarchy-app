import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicProposal } from '../lib/api';
import { api } from '../lib/api';
import { horizonLabel } from '../lib/floor-horizons';
import { MAX_OPTION_LABEL, MAX_OPTIONS, optionLead, optionsFromLabels, pairPool } from '../lib/proposal-options';
import { countdownTo, instantOf, tickIntervalFor } from '../lib/viewer-time';
import { BotMark } from './BotMark';
import { FloorModal } from './FloorModal';

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
  /** Trade this proposal's pair from the row it is read on
   *  (docs/ui-conventions.md, "The proposals board", 2026-09-09): selects
   *  the proposal and opens the ticket on that side. Absent on a board that
   *  is only a list, where no row grows verbs. */
  onTrade?: (id: string, direction: 'higher' | 'lower') => void;
  /** A manage-capable session rules from the row (docs/ui-conventions.md,
   *  "The proposals board", 2026-09-09): four pending proposals is a
   *  morning's work, not four page loads. Absent for everyone else. */
  canManage?: boolean;
  /** `option` names the chosen option when a proposal with options is
   *  approved from its row (docs/guides/proposals.md, "More than two
   *  options"); a two-branch ruling passes three arguments, as before. */
  onRule?: (id: string, action: 'approve' | 'decline', reason?: string, option?: string) => void | Promise<void>;
  /** `options` is present only when the form's Options row holds two or more
   *  filled labels; otherwise the call has four arguments and posts a
   *  two-branch proposal. */
  onPropose: (
    title: string,
    description: string,
    askUsd: number,
    decideBy: string,
    options?: Array<{ id: string; label: string }>,
  ) => Promise<void>;
  /** The floor's own decision window in minutes, the preselected preset on
   *  the form (docs/guides/proposals.md, "The deadline, and the close"). */
  decisionMinutes?: number;
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
  /** The signed-in participant's id: their own pending rows print "yours". */
  viewerId?: string | null;
  /** Workspace name, for the "do something useful for X?" propose prompt. */
  workspaceName: string;
  /** The workspace's proposalReward, in credits. Defaults to 0, so the board
   *  must not promise a bounty it does not pay. */
  proposalReward?: number;
  /** The feed's own action order by proposal id, on a floor with a feed
   *  (docs/ui-conventions.md, "A pending row keeps its place for its whole
   *  life"). Absent everywhere else, where creation order stands. */
  feedOrder?: Record<string, number>;
  /** The numbers this floor prices, for the form's placeholders. A proposer
   *  arrives knowing what they want to do and not which metric it moves;
   *  naming them in the prompt is what turns "Links: portfolio" into a pitch
   *  the market can price (owner direction 2026-08-20). */
  metricNames?: string[];
}

function fmtVal(v: number, unit: string): string {
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return unit + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A signed impact figure as the ballot prints it: "+12.0", "-3.0", "+120". */
export function fmtDelta(d: number, unit: string): string {
  return `${d > 0 ? '+' : d < 0 ? '-' : ''}${fmtVal(Math.abs(d), unit).replace(/^([+-])?/, '')}`;
}

/** How long a row ruled on under the reader keeps its place before it joins
 *  the decided fold (docs/ui-conventions.md, "A pending row keeps its place
 *  for its whole life"). */
const HOLD_MS = 10_000;

/** On the ballot: not yet decided by the owner. */
export function isPending(p: PublicProposal): boolean {
  return !p.status || p.status === 'pending';
}

/**
 * The ballot in the floor's order. Money decides it (owner decision
 * 2026-09-02: "proposals are ordered by total liquidity available"), so a
 * proposal somebody funded is read first and one nobody has backed sits at
 * the bottom rather than at the top by accident of its own unpriced delta;
 * impact breaks a tie. One function, so a panel that shows the floor
 * elsewhere (the /owners product moment) can never disagree with the floor.
 */
export function pendingBallot(
  proposals: PublicProposal[],
  /** The feed's own action order by proposal id, where a feed names one
   *  (docs/ui-conventions.md, "A pending row keeps its place for its whole
   *  life"): Continue, Turn left, Turn right, so the row a reader aims at
   *  is in the same place every minute. The server posts the three in
   *  whatever order it wrote them, which is not that order. */
  feedOrder?: Record<string, number>,
  /** Rows to keep on the ballot though they are no longer pending: a row
   *  ruled on under the reader holds its place for a moment. */
  alsoKeep?: ReadonlySet<string>,
): PublicProposal[] {
  /* Soonest ruling first (revised 2026-09-09, replacing pool-first of
     2026-09-02): the question a reader has is which of these needs them, not
     which is deepest, and pool-first put the biggest claimed impact on the
     floor at the bottom because nobody had funded it. A proposal with no
     deadline sorts last rather than first, the way a decided one with no
     decision time does.

     Nothing that MOVES can break the tie (revised 2026-09-11): pool and
     impact both change with every trade, so ranking on them re-sorted the
     list under the pointer, and a click on "Turn left" opened the next
     minute's "Continue forward". A proposal's deadline, its place in the
     feed's order and its creation are fixed for its whole life. */
  const dueAt = (p: PublicProposal) => (p.decideBy ? Date.parse(p.decideBy) : Number.POSITIVE_INFINITY);
  const rankOf = (p: PublicProposal) => feedOrder?.[p.id] ?? Number.POSITIVE_INFINITY;
  const madeAt = (p: PublicProposal) => (p.createdAt ? Date.parse(p.createdAt) : Number.POSITIVE_INFINITY);
  const cmp = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
  const byDue = (a: PublicProposal, b: PublicProposal) =>
    cmp(dueAt(a), dueAt(b)) ||
    cmp(rankOf(a), rankOf(b)) ||
    cmp(madeAt(a), madeAt(b)) ||
    (a.number ?? 0) - (b.number ?? 0);
  return proposals.filter(p => isPending(p) || alsoKeep?.has(p.id)).sort(byDue);
}

/**
 * What is behind a proposal: both branches of every pair, added up (owner ask
 * 2026-09-02). A proposal's forecast is two books, and half the money is not
 * the number a reader comparing two proposals wants. A branch with no market
 * counts as nothing rather than as a hole, which is not the same as a market
 * nobody has funded (zero).
 */
/** The pool's mark, the same drop the market facts use. */
/** The deadline's mark: a clock in the drop's register. */
export const ClockGlyph = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 4.5V8l2.4 1.6" />
  </svg>
);

/** The row's countdown lives in lib/viewer-time; re-exported for the page. */
export { countdownTo };

/**
 * The windows a proposer picks from (docs/ui-conventions.md): a DURATION,
 * not a date, because a date picker cannot express ten minutes. The floor's
 * own default is preselected and named as such; custom takes a number and a
 * unit and nothing else.
 */
export const WINDOW_PRESETS: Array<{ minutes: number; label: string }> = [
  { minutes: 60, label: '1h' },
  { minutes: 360, label: '6h' },
  { minutes: 1440, label: '1 day' },
  { minutes: 4320, label: '3 days' },
  { minutes: 10080, label: '1 week' },
];

/** "1 day", "45 minutes", "3 days": a window said the way a person says it. */
export function windowLabel(minutes: number): string {
  const preset = WINDOW_PRESETS.find(p => p.minutes === minutes);
  if (preset) return preset.label;
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export const PersonGlyph = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
);

export const CoinGlyph = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v9" />
    <path d="M14.4 9.6a2.6 2.6 0 0 0-2.4-1.3c-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 1.7 2.5.5 2.5 1.7-1.1 2-2.5 2a2.6 2.6 0 0 1-2.4-1.3" />
  </svg>
);

export const DropGlyph = () => (
  <svg width="9" height="11" viewBox="0 0 12 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M6 1.5C6 1.5 1.5 6.5 1.5 9.3a4.5 4.5 0 0 0 9 0C10.5 6.5 6 1.5 6 1.5Z" />
  </svg>
);

export function poolOf(p: PublicProposal): number {
  // Both branches of a pair, or every option of a proposal with options.
  return (p.markets ?? []).reduce((sum, m) => sum + pairPool(m), 0);
}

/** The id rule for typed option labels lives in lib/proposal-options. */
export { optionIdsOf } from '../lib/proposal-options';

/** Whether a proposal carries options instead of the approve/decline pair. */
export function hasOptions(p: PublicProposal): boolean {
  return (p.options?.length ?? 0) > 0 || p.markets.some(m => (m.options?.length ?? 0) > 0);
}

/** The label of a proposal's option by id, or the id itself when unknown. */
export function optionLabelOf(p: PublicProposal, id: string | null | undefined): string | null {
  if (!id) return null;
  return (
    p.options?.find(o => o.id === id)?.label ??
    p.markets.flatMap(m => m.options ?? []).find(o => o.id === id)?.label ??
    id
  );
}

/** Round-1 convention: the USD ask is composed into the title ("$80: ...").
    Parse it back out so the row can show cost as a structured field. */
export function splitAsk(title: string): { ask: number | null; rest: string } {
  const m = title.match(/^\$(\d+):\s*(.*)$/s);
  return m ? { ask: parseInt(m[1], 10), rest: m[2] } : { ask: null, rest: title };
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
  return pairAtHorizon(p, targetDate, metricId)?.delta ?? null;
}

/** The row a proposal prices for (metric, date), the same match deltaAt uses. */
export function pairAtHorizon(
  p: PublicProposal,
  targetDate: string | null | undefined,
  metricId?: string | null,
): PublicProposal['markets'][number] | null {
  if (!targetDate) return null;
  return (
    p.markets.find(
      m => m.targetDate === targetDate && (!metricId || m.metricId === undefined || m.metricId === metricId),
    ) ?? null
  );
}

export function JobsBoard({
  proposalReward = 0,
  proposals,
  unit,
  selectedId,
  onSelect,
  onTrade,
  canManage = false,
  onRule,
  onPropose,
  signedIn,
  onRequireSignup,
  workspaceName,
  feedOrder,
  metricNames = [],
  horizonDate,
  horizonMetricId,
  viewerId = null,
  decisionMinutes = 1440,
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
  const impactOf = (p: PublicProposal) => (horizonDate ? deltaAt(p, horizonDate, horizonMetricId) : headlineDelta(p));
  const [foldOpen, setFoldOpen] = useState(false);
  // The clocks on the rows tick: every second while a pending deadline is
  // under an hour, every minute otherwise (docs/ui-conventions.md, "The
  // deadline is said ONCE"). The interval is re-read after every tick so a
  // deadline crossing the hour line speeds the clock up on its own.
  const [now, setNow] = useState(() => Date.now());
  const tickMs = tickIntervalFor(proposals, now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  /* Ruling in place: which row is being ruled on, which way, and the reason
     the charter promises to publish. Approve confirms too, because a list is
     a place to mis-click and approving pays real money. */
  const [ruling, setRuling] = useState<{ id: string; action: 'approve' | 'decline'; reason: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [ask, setAsk] = useState('');
  // The window in minutes: a preset, or a custom number and unit.
  const [windowMinutes, setWindowMinutes] = useState(decisionMinutes);
  const [customOpen, setCustomOpen] = useState(false);
  const [customN, setCustomN] = useState('30');
  const [customUnit, setCustomUnit] = useState<'m' | 'h' | 'd'>('m');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  /* The Options row (docs/ui-conventions.md, "Posting one"): closed by
     default, two label fields when opened, up to six. */
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionLabels, setOptionLabels] = useState<string[]>(['', '']);
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
  /* A row ruled on under the reader holds its place (docs/ui-conventions.md,
     "A pending row keeps its place for its whole life"): for ten seconds it
     stays where it stood, its ruling on it, and only then joins the decided
     fold, so a click in flight lands on the row that was under the pointer
     and the next minute's rows arrive UNDER it rather than in its place. */
  const seenPendingRef = useRef<Set<string>>(new Set());
  const decidedAtRef = useRef<Map<string, number>>(new Map());
  const wasPending = seenPendingRef.current;
  const nowPending = new Set<string>();
  for (const p of proposals) {
    if (isPending(p)) {
      nowPending.add(p.id);
      decidedAtRef.current.delete(p.id);
    } else if (wasPending.has(p.id) && !decidedAtRef.current.has(p.id)) {
      decidedAtRef.current.set(p.id, Date.now());
    }
  }
  const held = new Set<string>();
  for (const [id, at] of decidedAtRef.current) {
    if (now - at < HOLD_MS) held.add(id);
    // The hold is over: the row joins the fold and both books forget it, so
    // a tab left open all day does not carry a day of decided ids, and a
    // forgotten one is never held a second time.
    else decidedAtRef.current.delete(id);
  }
  seenPendingRef.current = new Set([...nowPending, ...held]);
  // The deadline, the feed's order, then creation (see `pendingBallot`).
  const pending = pendingBallot(proposals, feedOrder, held);
  /* Five rows and a line for the rest: the board is one screen at four
     pending and would not be at twenty. A held row is a row that was already
     there, so it does not spend the budget. */
  const CAP = 5;
  let budget = CAP;
  const shownPending = showAll ? pending : pending.filter(p => held.has(p.id) || budget-- > 0);
  const hiddenPending = pending.length - shownPending.length;
  // Newest decision first; a proposal with no decision time sorts last and
  // impact breaks a tie.
  const decidedAt = (p: PublicProposal) => (p.resolvedAt ? Date.parse(p.resolvedAt) : Number.NEGATIVE_INFINITY);
  const byDecision = (a: PublicProposal, b: PublicProposal) => {
    const ta = decidedAt(a);
    const tb = decidedAt(b);
    if (ta !== tb) return ta > tb ? -1 : 1;
    return byImpact(a, b);
  };
  const decided = proposals.filter(p => !isPending(p) && !held.has(p.id)).sort(byDecision);

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
      const decideBy = new Date(Date.now() + windowMinutes * 60_000).toISOString();
      // Fewer than two filled labels is a two-branch proposal.
      const options = optionsOpen ? optionsFromLabels(optionLabels) : undefined;
      if (options) await onPropose(fullTitle, desc.trim(), askNum, decideBy, options);
      else await onPropose(fullTitle, desc.trim(), askNum, decideBy);
      // The green moment: the one place the form earns its color.
      setPlaced(true);
      closeTimer.current = setTimeout(() => {
        setAsk('');
        setWindowMinutes(decisionMinutes);
        setCustomOpen(false);
        setTitle('');
        setDesc('');
        setOptionsOpen(false);
        setOptionLabels(['', '']);
        setPlaced(false);
        setFormOpen(false);
      }, 900);
    } catch (e) {
      setFormErr((e as Error).message || 'Failed to submit');
    } finally {
      setFormBusy(false);
    }
  };

  /** One proposal's row. The same object in both groups: the fold changes
      which proposals are listed, never how a proposal reads. */
  const row = (p: PublicProposal) => {
    const delta = impactOf(p);
    const selected = selectedId === p.id;
    // Prefer the stored number; fall back to the title convention
    // only for proposals created before the column existed.
    const { ask: parsedAsk, rest: titleRest } = splitAsk(p.title);
    const askUsd = p.askUsd ?? parsedAsk;
    // Two lines, and only one of them is loud (docs/ui-conventions.md, "The
    // proposals board", revised 2026-09-09): the title and the impact on the
    // first, the four facts as an icon row on the second, the two verbs on
    // the right. Nothing stacked on the right edge, which is what made this
    // row unreadable in a 340px rail.
    const countdown = isPending(p) && p.decideBy ? countdownTo(p.decideBy, now) : null;
    // A priced, live proposal is one you can act on from where you read it.
    // A decided one has nothing left to trade, and an unpriced one has no
    // market to trade against.
    const tradeable = !!onTrade && isPending(p) && delta !== null;
    /* A proposal with options (docs/ui-conventions.md, "A proposal with
       options shows one world per option"): the row prints the leader's lead
       behind its label, and a manager chooses rather than approves. */
    const optioned = hasOptions(p);
    const rowPair = horizonDate ? pairAtHorizon(p, horizonDate, horizonMetricId) : null;
    const lead = optioned ? optionLead((rowPair ?? p.markets[0])?.options) : null;
    const chosenLabel = p.status === 'approved' ? optionLabelOf(p, p.decidedOption) : null;
    /* The options in the order a manager meets them: the leader first, then
       the proposer's order; a tie at the top has no leader, so the
       proposer's order alone. */
    const optionList = p.options?.length ? p.options : ((rowPair ?? p.markets[0])?.options ?? []);
    const leaderId = lead?.leader?.id ?? null;
    const choices = leaderId
      ? [...optionList.filter(o => o.id === leaderId), ...optionList.filter(o => o.id !== leaderId)]
      : optionList;
    return (
      <li key={p.id} className={selected ? 'is-open' : ''}>
        <div className={`pubws-prow${selected ? ' is-selected' : ''}`}>
          <button
            className={`pubws-ballot-row${selected ? ' is-selected' : ''}`}
            aria-pressed={selected}
            title={titleRest}
            onClick={() => onSelect(p.id)}
          >
            <span className="pubws-ballot-title">
              {/* The number leads: it is how a person names the proposal
                  ("what does #7 mean?"), so it reads before the words. */}
              {p.number ? <span className="pubws-ballot-num">#{p.number}</span> : null}
              {titleRest}
            </span>
            {/* The facts as an ICON ROW, the same vocabulary the market's own
                facts use: four labelled facts under every row is a paragraph
                per proposal. Each icon carries its words as a hover. */}
            <span className="pubws-prow-meta">
              {/* A pending proposal by the person reading is theirs, and says
                  so: an unfunded one sits last on the ballot, and its author
                  otherwise reloads the floor and cannot find it. */}
              {viewerId && isPending(p) && p.proposedByHandle === viewerId && (
                <span className="pubws-ballot-yours">yours</span>
              )}
              {/* A link cannot nest inside the row button, so the name is
                  a span that navigates; stopPropagation keeps the row from
                  also selecting. */}
              {p.proposedByName && (
                <span title={`Proposed by ${p.proposedByName}`}>
                  <PersonGlyph />
                  {p.proposedByHandle ? (
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
                  ) : (
                    p.proposedByName
                  )}
                  <BotMark bot={p.proposedByBot} />
                </span>
              )}
              {askUsd !== null && (
                <span title={`$${askUsd} to them if you approve it`}>
                  <CoinGlyph />${askUsd}
                </span>
              )}
              {/* The deadline, as a countdown (docs/ui-conventions.md, "The
                  deadline is one amber chip"): red inside the last day. */}
              {countdown && (
                <span
                  className={`pubws-ballot-clock${countdown.urgent ? ' is-urgent' : ''}`}
                  aria-label="Decision in"
                  title={`The owner decides by ${instantOf(p.decideBy)}`}
                >
                  <ClockGlyph />
                  {countdown.label}
                </span>
              )}
              {/* What is behind the forecast: what the number beside it is
                  worth trusting, and what the list is ordered by. */}
              <span
                className="pubws-ballot-pool"
                title={`${Math.round(poolOf(p)).toLocaleString()} credits behind this proposal`}
              >
                <DropGlyph />
                {Math.round(poolOf(p)).toLocaleString()}
              </span>
              {p.status && p.status !== 'pending' && (
                <span className={`pubws-ballot-status is-${p.lapsedAt ? 'lapsed' : p.status}`}>
                  {p.lapsedAt ? 'lapsed' : chosenLabel ? `Chose ${chosenLabel}` : p.status}
                </span>
              )}
            </span>
          </button>
          <span className="pubws-prow-impact pubws-ballot-impact">
            {/* "open" = nobody has priced it yet; a hard 0 means the two
                worlds are priced the same, which is a statement, not an
                absence. An option proposal names its leader first. */}
            {delta !== null && lead?.leader && (
              <>
                <span className="pubws-ballot-lead">{lead.leader.label}</span>{' '}
              </>
            )}
            {/* A tie at the top is not a lead: "tied" where the row would
                print "<leader> +lead" (docs/ui-conventions.md). */}
            {delta !== null && lead?.tied ? (
              <span className="pubws-ballot-delta pubws-ballot-delta--open">tied</span>
            ) : delta === null ? (
              <span className="pubws-ballot-delta pubws-ballot-delta--open">open</span>
            ) : delta === 0 ? (
              <span className="pubws-ballot-delta pubws-ballot-delta--open">±{unit}0</span>
            ) : (
              <span className={`pubws-ballot-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>{fmtDelta(delta, unit)}</span>
            )}
          </span>
          {/* Not on the row the page is already pointed at: that proposal's
              own ruling band is on screen, and two Approves for one proposal
              is one too many. */}
          {canManage && onRule && isPending(p) && !selected && (
            <span className="pubws-prow-acts">
              <button
                type="button"
                className="pubws-dir pubws-dir--mini pubws-dir--approve"
                onClick={() => setRuling({ id: p.id, action: 'approve', reason: '' })}
              >
                {optioned ? 'Choose' : 'Approve'}
              </button>
              <button
                type="button"
                className="pubws-dir pubws-dir--mini"
                onClick={() => setRuling({ id: p.id, action: 'decline', reason: '' })}
              >
                Decline
              </button>
            </span>
          )}
          {tradeable && (
            <span className="pubws-prow-acts">
              <button
                type="button"
                className="pubws-dir pubws-dir--mini pubws-dir--higher"
                onClick={() => onTrade?.(p.id, 'higher')}
              >
                Higher
              </button>
              <button
                type="button"
                className="pubws-dir pubws-dir--mini pubws-dir--lower"
                onClick={() => onTrade?.(p.id, 'lower')}
              >
                Lower
              </button>
            </span>
          )}
        </div>
        {ruling?.id === p.id && (
          /* The ruling itself, on the row: Approve names the money it pays
             and Decline asks for the reason the charter publishes, with the
             confirm off until one is typed. */
          <div className={`pubws-rule pubws-rule--${ruling.action}`}>
            {ruling.action === 'approve' && optioned ? (
              <p className="pubws-rule-what">
                Choosing one {askUsd ? `pays $${askUsd}, ` : ''}voids every other option and refunds its stakes at what
                they cost, and records every option at the call standing this instant.
              </p>
            ) : ruling.action === 'approve' ? (
              <p className="pubws-rule-what">
                Approving pays {askUsd === null ? 'nothing' : `$${askUsd}`} and records every pair at the call standing
                this instant.
              </p>
            ) : (
              <>
                <span className="pubws-rule-label">Why you are declining it, published on the proposal</span>
                <textarea
                  className="pubws-rule-reason"
                  rows={2}
                  value={ruling.reason}
                  onChange={e => setRuling({ ...ruling, reason: e.target.value })}
                />
              </>
            )}
            <div className="pubws-rule-acts">
              {ruling.action === 'approve' &&
                optioned &&
                choices.map(o => (
                  <button
                    key={o.id}
                    type="button"
                    className={`pubws-decide${leaderId === o.id ? ' pubws-decide--approve' : ''}`}
                    onClick={() => {
                      setRuling(null);
                      void onRule?.(p.id, 'approve', undefined, o.id);
                    }}
                  >
                    Choose {o.label}
                  </button>
                ))}
              {!(ruling.action === 'approve' && optioned) && (
                <button
                  type="button"
                  className={`pubws-decide pubws-decide--${ruling.action === 'approve' ? 'approve' : 'decline'}`}
                  disabled={ruling.action === 'decline' && ruling.reason.trim().length === 0}
                  onClick={() => {
                    const reason = ruling.action === 'decline' ? ruling.reason.trim() : undefined;
                    setRuling(null);
                    void onRule?.(p.id, ruling.action, reason);
                  }}
                >
                  {ruling.action === 'approve'
                    ? `Approve and pay ${askUsd === null ? 'nothing' : `$${askUsd}`}`
                    : 'Decline and publish'}
                </button>
              )}
              <button type="button" className="pubws-decide" onClick={() => setRuling(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
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
            {horizonDate ? `impact by ${horizonLabel(horizonDate)}` : 'impact if done'}
          </span>
        )}
      </div>

      {proposals.length === 0 ? (
        <p className="pubws-lb-empty">Nothing on the ballot yet. Yours could be first.</p>
      ) : (
        <ul className="pubws-ballot">
          {shownPending.map(row)}
          {hiddenPending > 0 && (
            <li>
              <button type="button" className="pubws-ballot-all" onClick={() => setShowAll(true)}>
                {hiddenPending} more open
              </button>
            </li>
          )}
          {foldable && (
            <li>
              {/* One hairline row standing for the archive, in the rail
                  head's anatomy: the count left, the action right. */}
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
            </li>
          )}
          {showDecided && decided.map(row)}
        </ul>
      )}
      {/* Proposing is not a main action (owner ask 2026-09-09: "traders are
          there to mostly trade not propose actions"). The band that stood
          here, a question, a button the width of the column and its
          fineprint, is gone; the page's closing board carries the
          invitation, and this is the quiet way in for anyone who came
          looking for it. Whoever the workspace allows can still post one. */}
      <div className="pubws-propose">
        <button
          type="button"
          className="pubws-propose-quiet"
          onClick={() => (signedIn ? setFormOpen(true) : onRequireSignup())}
        >
          + Propose work on this number
        </button>
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

            {/* Options (docs/ui-conventions.md, "Posting one"): closed by
                default, because a two-branch proposal is the default and
                stays the default. Opened, it holds two label fields and an
                "add option" control up to six; an emptied label drops its
                option, and fewer than two filled labels post a two-branch
                proposal. */}
            <div className="jobform-field jobform-options">
              <button
                type="button"
                className={`jobform-options-toggle${optionsOpen ? ' is-open' : ''}`}
                aria-expanded={optionsOpen}
                onClick={() => setOptionsOpen(v => !v)}
              >
                Options
                <span className="jobform-count">{optionsOpen ? 'choose between these' : 'approve or decline'}</span>
              </button>
              {optionsOpen && (
                <>
                  {optionLabels.map((label, i) => (
                    <input
                      key={i}
                      className="jobform-line jobform-line--option"
                      value={label}
                      maxLength={MAX_OPTION_LABEL}
                      placeholder={i === 0 ? 'Headline A' : i === 1 ? 'Headline B' : `Option ${i + 1}`}
                      aria-label={`Option ${i + 1} label`}
                      onChange={e => setOptionLabels(ls => ls.map((l, j) => (j === i ? e.target.value : l)))}
                    />
                  ))}
                  {optionLabels.length < MAX_OPTIONS && (
                    <button
                      type="button"
                      className="jobform-add-option"
                      onClick={() => setOptionLabels(ls => [...ls, ''])}
                    >
                      + add option
                    </button>
                  )}
                </>
              )}
            </div>

            {/* A paid job cannot go up without somewhere for the money to
                go; the warning names the fix and the confirm stays off. */}
            {/* How long the owner has, as a duration (docs/ui-conventions.md):
                presets with the floor's own preselected, and custom for
                anything else. */}
            <div className="jobform-field">
              <span className="ticket-label">Decided within</span>
              <div className="jobform-windows" aria-label="Decided within">
                {WINDOW_PRESETS.map(p => (
                  <button
                    key={p.minutes}
                    type="button"
                    className={`jobform-window${!customOpen && windowMinutes === p.minutes ? ' is-on' : ''}`}
                    aria-pressed={!customOpen && windowMinutes === p.minutes}
                    onClick={() => {
                      setCustomOpen(false);
                      setWindowMinutes(p.minutes);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`jobform-window${customOpen ? ' is-on' : ''}`}
                  aria-pressed={customOpen}
                  onClick={() => setCustomOpen(true)}
                >
                  custom
                </button>
                {!customOpen && windowMinutes === decisionMinutes && (
                  <span className="jobform-count">floor's default</span>
                )}
              </div>
              {customOpen && (
                <div className="jobform-windows">
                  <input
                    className="jobform-line jobform-line--n"
                    inputMode="numeric"
                    value={customN}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      setCustomN(raw);
                      const n = parseInt(raw, 10);
                      if (n > 0) setWindowMinutes(n * (customUnit === 'd' ? 1440 : customUnit === 'h' ? 60 : 1));
                    }}
                    aria-label="Custom window"
                  />
                  <select
                    className="jobform-line jobform-line--unit"
                    value={customUnit}
                    onChange={e => {
                      const u = e.target.value as 'm' | 'h' | 'd';
                      setCustomUnit(u);
                      const n = parseInt(customN, 10);
                      if (n > 0) setWindowMinutes(n * (u === 'd' ? 1440 : u === 'h' ? 60 : 1));
                    }}
                    aria-label="Custom window unit"
                  >
                    <option value="m">minutes</option>
                    <option value="h">hours</option>
                    <option value="d">days</option>
                  </select>
                </div>
              )}
            </div>

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
              {!placed && (
                <span className="ticket-go-sub">
                  {/* The bounty is the workspace's own proposalReward, like
                      the board above: a hardcoded 500 cr promised what most
                      floors do not pay. */}
                  Free to post. Approved means you are paid in real money
                  {proposalReward > 0 ? <>, plus {proposalReward.toLocaleString()}&nbsp;cr</> : null}.
                </span>
              )}
            </button>
          </div>
        </FloorModal>
      )}
    </section>
  );
}
