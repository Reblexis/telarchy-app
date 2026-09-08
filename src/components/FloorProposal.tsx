import type { ReactNode } from 'react';
import { dayOf, firstSentencesOf } from '../lib/floor-horizons';
import { formatImpact } from '../lib/formatImpact';
import { Dollar, MarketFacts, Page, People } from './MarketFacts';

/**
 * The proposal view's own blocks (docs/ui-conventions.md, "The proposal
 * view", P1 to P6): the label, the work, the pair band and the decision
 * band. The question line, the chart, the activity and the standings are
 * the floor's own components, unchanged by a proposal being on screen.
 */

/** P1: "PROPOSAL #3 · PENDING · EDITED 20 AUG", the edited day only when
 *  the words were edited, because a trader who priced this proposal before
 *  the wording moved is entitled to know that it moved. */
export function ProposalLabel({
  number,
  status,
  editedAt,
}: {
  number: number | null | undefined;
  status: string;
  editedAt: string | null | undefined;
}) {
  const edited = editedAt ? dayOf(editedAt) : null;
  return (
    <p className="pubws-proposal-label">
      {number ? `PROPOSAL #${number}` : 'PROPOSAL'} · {status.toUpperCase()}
      {edited ? ` · EDITED ${edited.toUpperCase()}` : ''}
    </p>
  );
}

/**
 * P3: what is being promised, before any button. The first two sentences,
 * "full scope" outside the clamp, and under them the icon row that names
 * the price, the payee and the world it is paid in.
 */
export function WorkBlock({
  description,
  ask,
  payee,
  expanded,
  onToggle,
  canEdit,
  onEdit,
}: {
  description: string | null;
  ask: number;
  payee: string;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const opening = firstSentencesOf(description, 2);
  const full = (description ?? '').trim();
  return (
    <section className="pubws-work" aria-label="The work">
      <p className="pubws-work-label">
        <span>THE WORK</span>
        {canEdit && (
          <button type="button" className="pubws-work-edit" onClick={onEdit}>
            Edit proposal
          </button>
        )}
      </p>
      {full && <p className="pubws-work-text">{expanded ? full : opening}</p>}
      {full && opening !== full && (
        <button type="button" className="pubws-work-more" onClick={onToggle}>
          {expanded ? 'less' : 'full scope'}
        </button>
      )}
      <span className="pubws-work-facts" aria-label="What this proposal asks">
        <span title="What this proposal asks, paid in real money on approval">
          <Dollar /> {`$${ask.toLocaleString('en-US')}`}
        </span>
        <span title="Who is paid if the owner approves">
          <People /> {payee}
        </span>
        <span title="The payment happens on approval and only then">
          <Page /> if approved
        </span>
      </span>
    </section>
  );
}

export interface BranchFacts {
  pool: number;
  traders: number;
  lastTradeAt: string | null;
}

/**
 * P4: the pair band. Both calls with their own books' facts, and the
 * difference in INK, so green never reads as a verdict. The band has to add
 * up at a glance, so the caller hands in the calls already printed at the
 * reconciling precision (`lib/formatImpact`).
 */
export function PairBand({
  approved,
  declined,
  print,
  unit,
  metricLabel,
  facts,
  why,
  now,
}: {
  approved: number | null;
  declined: number | null;
  /** The pair's own precision, from the caller (both calls and the
   *  difference reconcile or the band reads as wrong). */
  print: (v: number) => string;
  unit: string;
  /** The metric's own name, the difference's caption. */
  metricLabel: string;
  facts: { approved: BranchFacts; declined: BranchFacts };
  /** One tertiary line under the difference when the pair sits away from
   *  the market's own call, in the trader's terms. */
  why: string | null;
  now: Date;
}) {
  const priced = approved !== null && declined !== null;
  const cell = (branch: 'approved' | 'declined', value: number | null) => (
    <div className={`pubws-pair-cell pubws-pair-cell--${branch}`} key={branch}>
      <span className="pubws-stat-what">if {branch}</span>
      <span
        className={`pubws-price pubws-price--sm${value === null ? '' : branch === 'approved' ? ' is-up' : ' is-down'}`}
      >
        {value === null ? 'no price yet' : print(value)}
      </span>
      {/* An unpriced branch says so and stops there: the offer to fund it
          is in that branch's own column, once. */}
      {value !== null && (
        <MarketFacts
          traders={facts[branch].traders}
          pool={facts[branch].pool}
          lastTradeAt={facts[branch].lastTradeAt}
          now={now}
        />
      )}
    </div>
  );
  return (
    <div className="pubws-pair" role="group" aria-label="The pair">
      {cell('approved', approved)}
      {cell('declined', declined)}
      <div className="pubws-pair-cell pubws-pair-cell--diff">
        <span className="pubws-stat-what">
          difference in market calls · <span className="pubws-pair-unit">{metricLabel}</span>
        </span>
        <span className="pubws-price pubws-price--sm">
          {priced ? formatImpact((approved as number) - (declined as number), unit) : 'nothing to read yet'}
        </span>
        {why && <p className="pubws-pair-why">{why}</p>}
      </div>
    </div>
  );
}

/**
 * P5: the decision band, the owner's. One sentence in the product's terms
 * saying what each control does to the money, then the three controls. It
 * precedes the tickets at every width, because a decision is laid out as a
 * decision before it is asked. Nobody but a manage-capable session ever
 * renders the buttons; the backend enforces manage regardless.
 */
export function DecisionBand({
  payee,
  ask,
  decided,
  busy,
  error,
  mode,
  onMode,
  onApprove,
  onDecline,
  onRemove,
  reason,
  onReason,
}: {
  payee: string;
  ask: number;
  /** A decided proposal prints its decision and day instead. */
  decided: { word: string; day: string | null } | null;
  busy: boolean;
  error: string;
  /** Which review is open: none, the payment review, the decline review, or
   *  the remove confirm. */
  mode: null | 'approve' | 'decline' | 'remove';
  onMode: (next: null | 'approve' | 'decline' | 'remove') => void;
  onApprove: () => void;
  onDecline: () => void;
  onRemove: () => void;
  reason: string;
  onReason: (next: string) => void;
}) {
  if (decided) {
    return (
      <section className="pubws-decide pubws-decide--done" aria-label="The decision">
        {decided.word}
        {decided.day ? ` ${decided.day}` : ''}
        {ask > 0 && decided.word === 'Approved' ? ` · paid $${ask.toLocaleString('en-US')}` : ''}
      </section>
    );
  }
  const money = `$${ask.toLocaleString('en-US')}`;
  return (
    <section className="pubws-decide" aria-label="The decision">
      <p className="pubws-decide-line">
        {ask > 0 ? `Approving pays ${payee} ${money} now. ` : `Approving pays ${payee} nothing. `}
        The if-declined book is voided and stakes returned; the if-approved book pays at the real number. Declining is
        the reverse and pays nothing.
      </p>
      {mode === null && (
        <div className="pubws-decide-acts">
          <button type="button" className="pubws-decide-go" disabled={busy} onClick={() => onMode('approve')}>
            {ask > 0 ? `Approve, pay ${money}` : 'Approve'}
          </button>
          <button type="button" className="pubws-decide-no" disabled={busy} onClick={() => onMode('decline')}>
            Decline
          </button>
          <button type="button" className="pubws-decide-remove" disabled={busy} onClick={() => onMode('remove')}>
            Remove
          </button>
        </div>
      )}
      {mode === 'approve' && (
        <div className="pubws-review" aria-label="Payment review">
          <p className="pubws-review-row">
            <span>Paid to</span>
            <span>{payee}</span>
          </p>
          <p className="pubws-review-row">
            <span>Asks</span>
            <span>{money}</span>
          </p>
          <p className="pubws-review-row pubws-review-row--total">
            <span>Total</span>
            <span>{money}</span>
          </p>
          <p className="pubws-review-note">Approving IS the payment: there is no later step.</p>
          <div className="pubws-decide-acts">
            <button type="button" className="pubws-decide-go" disabled={busy} onClick={onApprove}>
              {busy ? 'Paying…' : `Approve and pay ${money}`}
            </button>
            <button type="button" className="pubws-decide-cancel" onClick={() => onMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {mode === 'decline' && (
        <div className="pubws-review" aria-label="Decline review">
          <p className="pubws-review-note">The reason is published on the proposal, so say it plainly.</p>
          <input
            className="pubws-decide-reason"
            value={reason}
            onChange={e => onReason(e.target.value)}
            placeholder="Why not, published on the proposal"
            aria-label="Decline reason"
          />
          <div className="pubws-decide-acts">
            <button
              type="button"
              className="pubws-decide-no"
              disabled={busy || reason.trim().length === 0}
              onClick={onDecline}
            >
              {busy ? 'Declining…' : 'Decline proposal'}
            </button>
            <button type="button" className="pubws-decide-cancel" onClick={() => onMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {mode === 'remove' && (
        <div className="pubws-review" aria-label="Remove review">
          <p className="pubws-decide-confirm">
            Removing voids both books and refunds everyone who traded them. The proposal leaves the board.
          </p>
          <div className="pubws-decide-acts">
            <button type="button" className="pubws-decide-no" disabled={busy} onClick={onRemove}>
              {busy ? 'Removing…' : 'Remove proposal'}
            </button>
            <button type="button" className="pubws-decide-cancel" onClick={() => onMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="ticket-err">{error}</p>}
    </section>
  );
}

/** Everyone but the owner reads one line where the band sits. */
export function DecisionNote() {
  return (
    <section className="pubws-decide pubws-decide--note" aria-label="The decision">
      The owner decides. Approving is the payment.
    </section>
  );
}

/**
 * P6: one branch's column. The branch word and its call as the heading,
 * the verbs panel inside, and the branch's own rule under it.
 */
export function BranchTicket({
  branch,
  call,
  onInject,
  children,
}: {
  branch: 'approved' | 'declined';
  /** Already printed at the pair's precision, or null when unpriced. */
  call: string | null;
  /** Deepening THIS book, for a signed-in reader, when it is already funded:
   *  the offer to fund or deepen a book appears once per book, in the panel
   *  where that book is traded (docs/ui-conventions.md, "The verbs and the
   *  inline ticket"). An unfunded branch offers it inside the verbs panel's
   *  unfunded state instead, so the column never carries two. */
  onInject: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <div className={`pubws-ticket-col pubws-ticket-col--${branch}`}>
      <p className="pubws-ticket-head">
        <span>
          IF {branch.toUpperCase()}
          {call ? ` · ${call}` : ''}
        </span>
        {onInject && (
          <button type="button" className="pubws-facts-act" onClick={onInject}>
            Inject liquidity
          </button>
        )}
      </p>
      {children}
      <p className="pubws-branch-rule">
        {branch === 'approved'
          ? 'If the owner declines, this book is voided and your stake returns.'
          : 'If the owner approves, this book is voided and your stake returns.'}
      </p>
    </div>
  );
}
