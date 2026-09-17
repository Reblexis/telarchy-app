import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { MAX_OPTION_LABEL, MAX_OPTIONS, optionsFromLabels } from '../lib/proposal-options';
import { countdownTo } from '../lib/viewer-time';
import { FloorModal } from './FloorModal';

/**
 * What a proposer may put behind their own proposal (docs/ui-conventions.md,
 * "Posting one"): the WHOLE amount in credits, split by the server across
 * the markets the proposal spawns. Zero, the default, is "none".
 */
export const SEED_PRESETS = [100, 500, 2000];

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
  pool?: number | null;
}

interface ProposalFormProps {
  onClose: () => void;
  workspaceName?: string;
  metricNames: string[];
  proposalReward: number;
  /** The floor's own decision window in minutes, the preselected preset. */
  decisionMinutes: number;
  /** What the viewer can put into a pool; null when unknown, and the server
   *  decides then. */
  spendable: number | null;
  /** `options` is present only when the Options row holds two or more filled
   *  labels, `liquidityBudget` only when the proposer picked one; otherwise
   *  the call has four arguments and posts a free two-branch proposal. */
  onPropose?: (
    title: string,
    description: string,
    askUsd: number,
    decideBy: string,
    options?: Array<{ id: string; label: string }>,
    liquidityBudget?: number,
  ) => Promise<void>;
  /** Present with `onSave`, the form edits instead of posting. */
  edit?: ProposalFormEdit;
  /** Throws when either half is refused; the form then stays open and says
   *  why. `addBudget` is the whole amount to ADD, absent when none. */
  onSave?: (words: { title: string; description: string; askUsd: number }, addBudget?: number) => Promise<void>;
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
  spendable,
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
  // The proposer's own liquidity, whole credits; 0 is none.
  const [seed, setSeed] = useState(0);
  const [seedCustomOpen, setSeedCustomOpen] = useState(false);
  const [seedCustom, setSeedCustom] = useState('');
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
  // A seed they cannot pay is refused here rather than by a 400 after the
  // click; an unknown balance leaves it to the server.
  const seedTooBig = seed > 0 && spendable !== null && seed > spendable;
  const formValid = title.trim().length > 0 && !needsPayout && !seedTooBig;

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
        await onSave?.({ title: fullTitle, description: desc.trim(), askUsd: askNum }, seed > 0 ? seed : undefined);
        onClose();
        return;
      }
      const decideBy = new Date(Date.now() + windowMinutes * 60_000).toISOString();
      // Fewer than two filled labels is a two-branch proposal.
      const options = optionsOpen ? optionsFromLabels(optionLabels) : undefined;
      if (seed > 0) await onPropose?.(fullTitle, desc.trim(), askNum, decideBy, options, seed);
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

  const held = spendable !== null ? ` You hold ${Math.floor(spendable).toLocaleString()} cr.` : '';
  const seedLabel = edit ? 'Add liquidity' : 'Your liquidity';
  const holds = edit?.pool
    ? `Its markets hold ${Math.round(edit.pool).toLocaleString()} cr now.`
    : 'Its markets hold nothing yet.';
  const seedNote = edit
    ? seed > 0
      ? `${holds} Yours is added on top, split across them; it does not come out before the decision.${seedTooBig ? '' : held}`
      : `${holds} Add your own so there is a price to read.`
    : seed > 0
      ? `Split across this proposal's markets so traders have a price to move. The owner buys it back on approval.${seedTooBig ? '' : held}`
      : 'Optional. Your credits in the books, so there is a price to read.';

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
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

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
            <span className="jobform-count jobform-seed-note">
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

        {/* The proposer's own liquidity (docs/ui-conventions.md, "Posting
            one"): none by default, because posting is free; a number is
            the whole amount, which the server splits across the markets. */}
        <div className="jobform-field">
          <span className="ticket-label">{seedLabel}</span>
          <div className="jobform-windows" aria-label={seedLabel}>
            <button
              type="button"
              className={`jobform-window${!seedCustomOpen && seed === 0 ? ' is-on' : ''}`}
              aria-pressed={!seedCustomOpen && seed === 0}
              onClick={() => {
                setSeedCustomOpen(false);
                setSeed(0);
              }}
            >
              none
            </button>
            {SEED_PRESETS.map(n => (
              <button
                key={n}
                type="button"
                className={`jobform-window${!seedCustomOpen && seed === n ? ' is-on' : ''}`}
                aria-pressed={!seedCustomOpen && seed === n}
                onClick={() => {
                  setSeedCustomOpen(false);
                  setSeed(n);
                }}
              >
                {n.toLocaleString()}
              </button>
            ))}
            <button
              type="button"
              className={`jobform-window${seedCustomOpen ? ' is-on' : ''}`}
              aria-pressed={seedCustomOpen}
              aria-label="custom amount"
              onClick={() => {
                setSeedCustomOpen(true);
                setSeed(parseInt(seedCustom, 10) || 0);
              }}
            >
              custom
            </button>
            {seedCustomOpen && (
              <>
                <input
                  className="jobform-line jobform-line--n jobform-line--cr"
                  inputMode="numeric"
                  value={seedCustom}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 9);
                    setSeedCustom(raw);
                    setSeed(parseInt(raw, 10) || 0);
                  }}
                  aria-label="Custom liquidity"
                />
                <span className="jobform-count">cr</span>
              </>
            )}
          </div>
          <span className="jobform-count jobform-seed-note">{seedNote}</span>
        </div>

        {seedTooBig && spendable !== null && (
          <p className="ticket-err">You hold {Math.floor(spendable).toLocaleString()} cr: pick a smaller amount.</p>
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
                seed > 0 ? (
                  <>Adds {seed.toLocaleString()}&nbsp;cr of yours to its markets.</>
                ) : (
                  'The markets keep their prices and every position. The edit is public.'
                )
              ) : (
                <>
                  {/* The bounty is the workspace's own proposalReward: a
                      hardcoded 500 cr promised what most floors do not pay. */}
                  {seed > 0 ? <>Puts {seed.toLocaleString()}&nbsp;cr of yours in its markets.</> : 'Free to post.'}{' '}
                  Approved means you are paid in real money
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
