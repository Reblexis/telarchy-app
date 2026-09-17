import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { MAX_OPTION_LABEL, MAX_OPTIONS, optionsFromLabels } from '../lib/proposal-options';
import { countdownTo } from '../lib/viewer-time';
import { FloorModal } from './FloorModal';

/** One book a proposal can be priced on, as the form needs it
 *  (docs/ui-conventions.md, "Posting one"). */
export interface ProposalBook {
  metricId: string;
  metricLabel: string;
  targetDate: string;
  dateLabel: string;
  /** What the floor adds to each side of this book on a new proposal; null
   *  when proposals are not priced here at all. */
  opensWith: number | null;
  /** End of the priced period (ISO): a proposal is priced here only when
   *  this falls after its deadline. */
  periodEndsOn?: string | null;
  /** Editing: what this proposal's sides of the book hold now, together. */
  holds?: number;
  /** Editing: how many open sides the proposal has on this book. */
  sides?: number;
}

/** A proposer's liquidity for one book: `amount` into EACH side of it. */
export interface LiquidityCell {
  metricId: string;
  targetDate: string;
  amount: number;
}

const bookKey = (b: { metricId: string; targetDate: string }) => `${b.metricId}:${b.targetDate}`;

/** The pool's mark on the board, reused for the bill. */
const DropGlyph = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="M8 1.8c2.6 3 4.2 5.2 4.2 7.4A4.2 4.2 0 0 1 8 13.4a4.2 4.2 0 0 1-4.2-4.2C3.8 7 5.4 4.8 8 1.8Z" />
  </svg>
);

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

/** What the form is opened on when it edits (docs/ui-conventions.md,
 *  "Editing one"): the words and the price as they stand, the deadline it
 *  cannot move, and what the proposal's markets hold now. */
const deadlineWords = (iso: string) => {
  const { label } = countdownTo(iso);
  return label === 'overdue' ? 'Past its deadline. ' : `In ${label}. `;
};

export interface ProposalFormEdit {
  ask: number | null;
  title: string;
  description: string;
  decideBy?: string | null;
}

interface ProposalFormProps {
  onClose: () => void;
  workspaceName?: string;
  metricNames: string[];
  proposalReward: number;
  /** The floor's own decision window in minutes, the preselected preset. */
  decisionMinutes: number;
  /** The viewer's two purses, liquidity credits spent first; null when
   *  unknown, and the server decides then. */
  liquidityCredits: number | null;
  tradingCredits: number | null;
  /** The books this floor prices, one per metric and date. */
  books: ProposalBook[];
  /** `options` is present only when the Options row holds two or more filled
   *  labels, `liquidity` only when the proposer named an amount; otherwise
   *  the call has four arguments and posts a free two-branch proposal. */
  onPropose?: (
    title: string,
    description: string,
    askUsd: number,
    decideBy: string,
    options?: Array<{ id: string; label: string }>,
    liquidity?: LiquidityCell[],
  ) => Promise<void>;
  /** Present with `onSave`, the form edits instead of posting. */
  edit?: ProposalFormEdit;
  /** Throws when either half is refused; the form then stays open and says
   *  why. `add` is what to ADD per book, absent when none. */
  onSave?: (words: { title: string; description: string; askUsd: number }, add?: LiquidityCell[]) => Promise<void>;
}

/**
 * The form a proposal is posted with, and edited with (docs/ui-conventions.md,
 * "Posting one", "Editing one"). It is the ticket's structure, not just its
 * underlines: the ask is the hero numeric at the top like the bet amount, and
 * color only speaks as state, red for errors and green for the placed flash.
 * Escape and the backdrop close. It mounts when opened, so closing resets it.
 */
export function ProposalForm({
  onClose,
  workspaceName,
  metricNames,
  proposalReward,
  decisionMinutes,
  liquidityCredits,
  tradingCredits,
  books,
  onPropose,
  edit,
  onSave,
}: ProposalFormProps) {
  const [ask, setAsk] = useState(edit?.ask ? String(edit.ask) : '');
  // The window in minutes: a preset, or a custom number and unit.
  const [windowMinutes, setWindowMinutes] = useState(decisionMinutes);
  const [customOpen, setCustomOpen] = useState(false);
  const [customN, setCustomN] = useState('30');
  const [customUnit, setCustomUnit] = useState<'m' | 'h' | 'd'>('m');
  // The proposer's liquidity per book, whole credits, keyed metric:date.
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [perDateOpen, setPerDateOpen] = useState(false);
  const [title, setTitle] = useState(edit?.title ?? '');
  const [desc, setDesc] = useState(edit?.description ?? '');
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
    api
      .getParticipant()
      .then(p => setAccountPayout((p as { payoutHandle?: string | null }).payoutHandle ?? null))
      .catch(e => {
        console.error('participant fetch failed:', e);
        setAccountPayout(null);
      });
  }, []);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // The confirm stays disabled until these hold, so the short errors
  // below are a fallback for the server, not the primary guardrail. A $0
  // job needs no payment details (owner decision 2026-08-10); a paid one
  // is blocked, with a warning, until the account has them.
  const askNum = Math.max(0, Math.floor(parseFloat(ask) || 0));
  // An edit never asks again: the handle was snapshotted at posting, and the
  // server refuses a price it cannot pay.
  const needsPayout = !edit && askNum > 0 && accountPayout === null;
  // The books this proposal will be priced on: leaf metrics, whose period
  // ends after the deadline picked above (the server refuses any other).
  const deadlineMs = edit ? 0 : Date.now() + windowMinutes * 60_000;
  const offered = books.filter(
    b => b.opensWith !== null && (edit || !b.periodEndsOn || new Date(b.periodEndsOn).getTime() > deadlineMs),
  );
  const sidesNew = optionsOpen ? (optionsFromLabels(optionLabels)?.length ?? 2) : 2;
  const cells: LiquidityCell[] = offered
    .map(b => ({ metricId: b.metricId, targetDate: b.targetDate, amount: amounts[bookKey(b)] ?? 0 }))
    .filter(c => c.amount > 0);
  // The whole bill: every side of every funded book.
  const bill = offered.reduce((sum, b) => sum + (amounts[bookKey(b)] ?? 0) * (edit ? (b.sides ?? 2) : sidesNew), 0);
  const purses = liquidityCredits !== null && tradingCredits !== null ? liquidityCredits + tradingCredits : null;
  // A bill they cannot pay is refused here rather than by a 400 after the
  // click; unknown purses leave it to the server.
  const billTooBig = bill > 0 && purses !== null && bill > purses;
  const fromWallet = Math.min(liquidityCredits ?? 0, bill);
  const uniform = (() => {
    const values = offered.map(b => amounts[bookKey(b)] ?? 0);
    return values.length > 0 && values.every(v => v === values[0]) ? values[0] : null;
  })();
  const setEach = (n: number) => setAmounts(Object.fromEntries(offered.map(b => [bookKey(b), n])));
  const metricCols = Array.from(new Map(offered.map(b => [b.metricId, b.metricLabel])));
  const dateRows = Array.from(new Map(offered.map(b => [b.targetDate, b.dateLabel])));
  const whole = (raw: string) => parseInt(raw.replace(/[^0-9]/g, '').slice(0, 7), 10) || 0;
  const formValid = title.trim().length > 0 && !needsPayout && !billTooBig;

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
      if (edit) {
        // The words first, the liquidity second (docs/ui-conventions.md,
        // "Editing one"): onSave throws if either is refused.
        await onSave?.(
          { title: fullTitle, description: desc.trim(), askUsd: askNum },
          cells.length > 0 ? cells : undefined,
        );
        onClose();
        return;
      }
      const decideBy = new Date(Date.now() + windowMinutes * 60_000).toISOString();
      // Fewer than two filled labels is a two-branch proposal.
      const options = optionsOpen ? optionsFromLabels(optionLabels) : undefined;
      if (cells.length > 0) await onPropose?.(fullTitle, desc.trim(), askNum, decideBy, options, cells);
      else if (options) await onPropose?.(fullTitle, desc.trim(), askNum, decideBy, options);
      else await onPropose?.(fullTitle, desc.trim(), askNum, decideBy);
      // The green moment: the one place the form earns its color. The form
      // unmounts on close, which is what resets it.
      setPlaced(true);
      closeTimer.current = setTimeout(onClose, 900);
    } catch (e) {
      setFormErr((e as Error).message || 'Failed to submit');
    } finally {
      setFormBusy(false);
    }
  };

  const liquidityLabel = edit ? 'Add liquidity, each book' : 'Your liquidity, each book';

  return (
    <FloorModal onClose={onClose} label={edit ? 'Edit proposal' : 'Offer to do the work'}>
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
          {/* Liquidity is the form's other money, so it sits beside the price
              in the same numeral (docs/ui-conventions.md, "Posting one"): one
              number for every book, empty because posting is free. */}
          {offered.length > 0 && (
            <div className="jobform-askblock">
              <p className="ticket-label">{liquidityLabel}</p>
              <label className="ticket-amt ticket-amt--price jobform-ask">
                <input
                  value={uniform ? String(uniform) : ''}
                  style={{ width: `${Math.max(4, String(uniform ?? '').length + 1)}ch` }}
                  onChange={e => setEach(whole(e.target.value))}
                  placeholder={uniform === null ? 'mixed' : '0'}
                  inputMode="numeric"
                  aria-label={liquidityLabel}
                />
                <span className="ticket-amt-unit">cr</span>
              </label>
            </div>
          )}
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {offered.length > 0 && (
          <div className="jobform-field">
            <button
              type="button"
              className="jobform-perdate"
              aria-expanded={perDateOpen}
              onClick={() => setPerDateOpen(v => !v)}
            >
              {perDateOpen ? 'one number for all' : 'set per date'}
            </button>
            {perDateOpen && (
              <div className="jobform-gridwrap">
                <div
                  className="jobform-grid"
                  style={{
                    gridTemplateColumns: `minmax(4.2rem, auto) repeat(${metricCols.length}, minmax(4.5rem, 1fr))`,
                  }}
                >
                  <span />
                  {metricCols.map(([id, label]) => (
                    <span key={id} className="jobform-grid-h">
                      {label}
                    </span>
                  ))}
                  {dateRows.map(([targetDate, dateLabel]) => (
                    <Fragment key={targetDate}>
                      <span className="jobform-grid-r">{dateLabel}</span>
                      {metricCols.map(([metricId, metricLabel]) => {
                        const b = offered.find(x => x.metricId === metricId && x.targetDate === targetDate);
                        if (!b) return <span key={metricId} />;
                        const n = amounts[bookKey(b)] ?? 0;
                        return (
                          <div key={metricId} className="jobform-cell">
                            <input
                              value={n ? String(n) : ''}
                              onChange={e => setAmounts(a => ({ ...a, [bookKey(b)]: whole(e.target.value) }))}
                              placeholder="0"
                              inputMode="numeric"
                              aria-label={`${metricLabel}, ${dateLabel}`}
                            />
                            <span className="jobform-cell-note">
                              {edit
                                ? b.holds
                                  ? `holds ${Math.round(b.holds).toLocaleString()}`
                                  : '\u00a0'
                                : b.opensWith
                                  ? `+${b.opensWith.toLocaleString()} floor`
                                  : '\u00a0'}
                            </span>
                          </div>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
            {/* The bill as icon facts, never a sentence: what goes in, and the
                two purses in the order they are spent. */}
            {bill > 0 && (
              <div className="jobform-facts">
                <span className="jobform-fact" title="Into its markets, every side of every book">
                  <DropGlyph />
                  {bill.toLocaleString()}
                </span>
                {liquidityCredits !== null && (
                  <span className="jobform-fact" title="Liquidity credits, spent first">
                    liquidity {Math.floor(liquidityCredits).toLocaleString()}
                    {fromWallet > 0 ? ` → ${Math.floor(liquidityCredits - fromWallet).toLocaleString()}` : ''}
                  </span>
                )}
                {tradingCredits !== null && (
                  <span className={`jobform-fact${billTooBig ? ' is-bad' : ''}`} title="Trading credits, spent second">
                    trading {Math.floor(tradingCredits).toLocaleString()}
                    {bill > fromWallet && !billTooBig
                      ? ` → ${Math.floor(tradingCredits - (bill - fromWallet)).toLocaleString()}`
                      : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <label className="jobform-field">
          <span className="ticket-label">
            Proposal{' '}
            <span className={`jobform-count${title.length >= 70 ? ' is-max' : title.length >= 60 ? ' is-near' : ''}`}>
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
        {!edit && (
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
        )}

        {/* A paid job cannot go up without somewhere for the money to
            go; the warning names the fix and the confirm stays off. */}
        {/* How long the owner has, as a duration (docs/ui-conventions.md):
            presets with the floor's own preselected, and custom for
            anything else. */}
        {edit ? (
          <div className="jobform-field">
            <span className="ticket-label">Decided</span>
            <span className="jobform-seed-note">
              {edit.decideBy ? deadlineWords(edit.decideBy) : ''}The deadline cannot be moved.
            </span>
          </div>
        ) : (
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
        )}

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
          {edit
            ? formBusy
              ? 'Saving…'
              : 'Save'
            : placed
              ? 'Added to ballot'
              : formBusy
                ? 'Submitting…'
                : formValid && askNum > 0
                  ? `Offer this for $${askNum}`
                  : 'Propose'}
          {!placed && (
            <span className="ticket-go-sub">
              {edit ? (
                billTooBig && purses !== null ? (
                  <>You hold {Math.floor(purses).toLocaleString()}&nbsp;cr</>
                ) : bill > 0 ? (
                  <>Adds {bill.toLocaleString()}&nbsp;cr of yours to its markets.</>
                ) : (
                  'Prices and positions stay. The edit is public.'
                )
              ) : billTooBig && purses !== null ? (
                <>You hold {Math.floor(purses).toLocaleString()}&nbsp;cr</>
              ) : bill > 0 ? (
                // One short line: a centred sub-line must never wrap into a block.
                <>Puts {bill.toLocaleString()}&nbsp;cr of yours in its markets.</>
              ) : (
                <>
                  {/* The bounty is the workspace's own proposalReward: a
                      hardcoded 500 cr promised what most floors do not pay. */}
                  Free to post. Approved means you are paid in real money
                  {proposalReward > 0 ? <>, plus {proposalReward.toLocaleString()}&nbsp;cr</> : null}.
                </>
              )}
            </span>
          )}
        </button>
      </div>
    </FloorModal>
  );
}
