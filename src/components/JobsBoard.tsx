import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicProposal } from '../lib/api';
import { api } from '../lib/api';
import { horizonLabel } from '../lib/floor-horizons';
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
  /** The signed-in participant's id: their own pending rows print "yours". */
  viewerId?: string | null;
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

function fmtVal(v: number, unit: string): string {
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return unit + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDelta(d: number, unit: string): string {
  return `${d > 0 ? '+' : d < 0 ? '-' : ''}${fmtVal(Math.abs(d), unit).replace(/^([+-])?/, '')}`;
}

/**
 * What is behind a proposal: both branches of every pair, added up (owner ask
 * 2026-09-02). A proposal's forecast is two books, and half the money is not
 * the number a reader comparing two proposals wants. A branch with no market
 * counts as nothing rather than as a hole, which is not the same as a market
 * nobody has funded (zero).
 */
/** The pool's mark, the same drop the market facts use. */
const PoolDrop = () => (
  <svg width="9" height="11" viewBox="0 0 12 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M6 1.5C6 1.5 1.5 6.5 1.5 9.3a4.5 4.5 0 0 0 9 0C10.5 6.5 6 1.5 6 1.5Z" />
  </svg>
);

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
  if (!targetDate) return null;
  const pair = p.markets.find(
    m => m.targetDate === targetDate && (!metricId || m.metricId === undefined || m.metricId === metricId),
  );
  return pair?.delta ?? null;
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
  const isPending = (p: PublicProposal) => !p.status || p.status === 'pending';
  const byImpact = (a: PublicProposal, b: PublicProposal) => (impactOf(b) ?? 0) - (impactOf(a) ?? 0);
  // Money decides the order (owner decision 2026-09-02: "proposals are
  // ordered by total liquidity available"), so a proposal somebody funded is
  // read first and one nobody has backed sits at the bottom rather than at
  // the top by accident of its own unpriced delta. Impact breaks a tie.
  const byPool = (a: PublicProposal, b: PublicProposal) => poolOf(b) - poolOf(a) || byImpact(a, b);
  const pending = proposals.filter(isPending).sort(byPool);
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

  /** One proposal's row. The same object in both groups: the fold changes
      which proposals are listed, never how a proposal reads. */
  const row = (p: PublicProposal) => {
    const delta = impactOf(p);
    const selected = selectedId === p.id;
    // Prefer the stored number; fall back to the title convention
    // only for proposals created before the column existed.
    const { ask: parsedAsk, rest: titleRest } = splitAsk(p.title);
    const askUsd = p.askUsd ?? parsedAsk;
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
            <span className="pubws-ballot-facts">
              {/* A pending proposal by the person reading is theirs, and says
                  so: an unfunded one sits last on the ballot, and its author
                  otherwise reloads the floor and cannot find it. */}
              {viewerId && isPending(p) && p.proposedByHandle === viewerId && (
                <span className="pubws-ballot-yours">yours</span>
              )}
              {/* A link cannot nest inside the row button, so the name is
                  a span that navigates; stopPropagation keeps the row from
                  also selecting. */}
              {p.proposedByName &&
                (p.proposedByHandle ? (
                  <span>
                    by{' '}
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
                  <span>by {p.proposedByName}</span>
                ))}
              {askUsd !== null && <span>${askUsd} to them</span>}
              {p.status && p.status !== 'pending' && (
                <span className={`pubws-ballot-status is-${p.status}`}>{p.status}</span>
              )}
            </span>
          </span>
          <span className="pubws-ballot-impact">
            {/* "open" = nobody has priced it yet; a hard 0 means the two
                worlds are priced the same, which is a statement, not an
                absence. */}
            {delta === null ? (
              <span className="pubws-ballot-delta pubws-ballot-delta--open">open</span>
            ) : delta === 0 ? (
              <span className="pubws-ballot-delta pubws-ballot-delta--open">±{unit}0</span>
            ) : (
              <span className={`pubws-ballot-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>{fmtDelta(delta, unit)}</span>
            )}
            {/* What is behind the forecast, in the drop the market's own pool
                rows wear. Quiet and mono under the delta: it is what the
                number above it is worth trusting, and it is what the list is
                ordered by. */}
            <span
              className="pubws-ballot-pool"
              title={`${Math.round(poolOf(p)).toLocaleString()} credits behind this proposal`}
            >
              <PoolDrop />
              {Math.round(poolOf(p)).toLocaleString()}
            </span>
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
            {horizonDate ? `change by ${horizonLabel(horizonDate)} if approved` : 'change if approved'}
          </span>
        )}
      </div>

      {proposals.length === 0 ? (
        <p className="pubws-lb-empty">Nothing on the ballot yet. Yours could be first.</p>
      ) : (
        <ul className="pubws-ballot">
          {pending.map(row)}
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
      <div className="pubws-propose">
        <p className="pubws-propose-lead">Do you think you could do something useful for {workspaceName}?</p>
        <button className="pubws-propose-cta" onClick={() => (signedIn ? setFormOpen(true) : onRequireSignup())}>
          + Propose
        </button>
        {/* Surface the upside on the board itself, not only inside the form.
            The credit bounty is the workspace's own proposalReward and
            defaults to 0, so say it only where it is actually paid: a
            hardcoded "plus 500 cr" was a promise most floors do not keep. */}
        <p className="pubws-propose-cost">
          Free to post. Approved means <strong>you are paid in real money</strong>
          {proposalReward > 0 ? <>, plus {proposalReward.toLocaleString()}&nbsp;cr</> : null}. Put credits behind it and
          it moves up.
        </p>
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
