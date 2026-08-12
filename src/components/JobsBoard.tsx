import { FloorModal } from './FloorModal';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { PublicProposal } from '../lib/api';

/**
 * The jobs board: the proposal side of the trading floor, rendered for
 * signed-in participants (paid-jobs round 1, charter of 2026-08-09).
 * A proposal is a job with a price ("$80: I will ..."); its conditional
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
}

function fmtVal(v: number, unit: string): string {
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return unit + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDelta(d: number, unit: string): string {
  return `${d > 0 ? '+' : d < 0 ? '-' : ''}${fmtVal(Math.abs(d), unit).replace(/^([+-])?/, '')}`;
}

/** Round-1 convention: the USD ask is composed into the title ("$80: ...").
    Parse it back out so the row can show cost as a structured field. */
export function splitAsk(title: string): { ask: number | null; rest: string } {
  const m = title.match(/^\$(\d+):\s*(.*)$/s);
  return m ? { ask: parseInt(m[1], 10), rest: m[2] } : { ask: null, rest: title };
}

function headlineDelta(p: PublicProposal): number | null {
  const deltas = p.markets.map(m => m.delta).filter((d): d is number => d !== null);
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), deltas[0]);
}

export function JobsBoard({ proposals, unit, selectedId, onSelect, onPropose, signedIn, onRequireSignup }: Props) {
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
    api.getParticipant()
      .then(p => setAccountPayout((p as { payoutHandle?: string | null }).payoutHandle ?? null))
      .catch(e => { console.error('participant fetch failed:', e); setAccountPayout(null); });
  }, [formOpen]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // The ballot is a ranking: the owner acts on it, so the biggest priced
  // impact belongs at the top and the unpriced ones below.
  const ranked = [...proposals].sort((a, b) => {
    const da = headlineDelta(a) ?? 0;
    const db = headlineDelta(b) ?? 0;
    return db - da;
  });

  // The confirm stays disabled until these hold, so the short errors
  // below are a fallback for the server, not the primary guardrail. A $0
  // job needs no payment details (owner decision 2026-08-10); a paid one
  // is blocked, with a warning, until the account has them.
  const askNum = Math.max(0, Math.floor(parseFloat(ask) || 0));
  const needsPayout = askNum > 0 && accountPayout === null;
  const formValid = title.trim().length > 0 && !needsPayout;

  const submit = async () => {
    if (!title.trim()) { setFormErr('Add a job.'); return; }
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
        setAsk(''); setTitle(''); setDesc(''); setPlaced(false); setFormOpen(false);
      }, 900);
    } catch (e) {
      setFormErr((e as Error).message || 'Failed to submit');
    } finally {
      setFormBusy(false);
    }
  };

  return (
    <section className="pubws-section" aria-label="Jobs">
      <h2 className="pubws-h2">Jobs</h2>

      {proposals.length === 0 ? (
        <p className="pubws-empty">Nothing on the ballot yet. Yours could be first.</p>
      ) : (
        <ul className="pubws-ballot">
          {/* One column label for the whole list instead of one per row. */}
          <li className="pubws-ballot-head" aria-hidden="true"><span>impact if done</span></li>
          {ranked.map(p => {
            const delta = headlineDelta(p);
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
                    <span className="pubws-ballot-title">{titleRest}</span>
                    <span className="pubws-ballot-facts">
                      {/* A link cannot nest inside the row button, so the
                          name is a span that navigates; stopPropagation
                          keeps the row from also selecting. */}
                      {p.proposedByName && (
                        p.proposedByHandle
                          ? (
                            <span>by{' '}
                              <span
                                className="pubws-name-link"
                                role="link"
                                tabIndex={0}
                                onClick={ev => { ev.stopPropagation(); window.location.href = `/participants/${encodeURIComponent(p.proposedByHandle!)}`; }}
                                onKeyDown={ev => { if (ev.key === 'Enter') { ev.stopPropagation(); window.location.href = `/participants/${encodeURIComponent(p.proposedByHandle!)}`; } }}
                              >
                                {p.proposedByName}
                              </span>
                            </span>
                          )
                          : <span>by {p.proposedByName}</span>
                      )}
                      {askUsd !== null && <span>asks ${askUsd}</span>}
                    </span>
                  </span>
                  <span className="pubws-ballot-impact">
                    {/* "open" = nobody has priced it yet; a hard 0 means the
                        two worlds are priced the same, which is a statement,
                        not an absence. */}
                    {delta === null
                      ? <span className="pubws-ballot-delta pubws-ballot-delta--open">open</span>
                      : delta === 0
                        ? <span className="pubws-ballot-delta pubws-ballot-delta--open">±{unit}0</span>
                        : <span className={`pubws-ballot-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>{fmtDelta(delta, unit)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="pubws-propose">
        <button
          className="pubws-propose-cta"
          onClick={() => (signedIn ? setFormOpen(true) : onRequireSignup())}
        >
          {signedIn ? '+ Suggest a job' : 'Sign up to suggest a job'}
        </button>
        {/* Surface the stake on the board itself, not only inside the form:
            posting costs 500 cr and pays 1,000 cr back if the owner approves,
            so a new signup (1,000 free cr) can afford it and see the upside. */}
        <p className="pubws-propose-cost">500&nbsp;cr to post&nbsp;· 1,000&nbsp;cr back if approved</p>
      </div>
      {/* The form is the ticket's structure, not just its underlines
          (Codex redesign 2026-08-10): the ask is the hero numeric at the
          top like the bet amount, the consequences live in the same ruled
          facts table, and color only speaks as state, red for errors and
          green for the placed flash. Escape and the backdrop close. */}
      {formOpen && (
        <FloorModal onClose={() => setFormOpen(false)} label="Suggest a job">
          <div className="jobform">
            <div className="ticket-head jobform-head">
              <div className="jobform-askblock">
                <p className="ticket-label">Ask</p>
                <label className="ticket-amt ticket-amt--price jobform-ask">
                  <span className="ticket-amt-unit">$</span>
                  <input
                    value={ask}
                    style={{ width: `${Math.max(2, ask.length)}ch` }}
                    onChange={e => setAsk(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="0"
                    inputMode="numeric"
                    aria-label="Price in USD (required)"
                    required
                  />
                </label>
              </div>
              <button className="ticket-close" aria-label="Close" onClick={() => setFormOpen(false)}>×</button>
            </div>

            <label className="jobform-field">
              <span className="ticket-label">
                Job <span className={`jobform-count${title.length >= 70 ? ' is-max' : title.length >= 60 ? ' is-near' : ''}`}>{title.length}/70</span>
              </span>
              <input
                className="jobform-line jobform-line--title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Stream LookPilot to my viewers for an hour"
                maxLength={70}
                aria-label="Job title"
              />
            </label>

            <label className="jobform-field">
              <span className="ticket-label">Pitch</span>
              <textarea
                className="jobform-line jobform-line--desc"
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="Links: channel, portfolio, prior work."
                rows={3}
                aria-label="Job description"
              />
            </label>

            {/* The whole deal in one quiet line (owner direction
                2026-08-10: no facts table): what it costs, what approval
                pays. */}
            <p className="jobform-terms">Costs 500 cr to post. 1,000 cr back if approved.</p>

            {/* A paid job cannot go up without somewhere for the money to
                go; the warning names the fix and the confirm stays off. */}
            {needsPayout && <p className="ticket-err">Paid jobs need payment details first: add them in your account menu.</p>}
            {formErr && <p className="ticket-err">{formErr}</p>}
            <button
              className={`ticket-go${placed ? ' is-placed' : ''}`}
              disabled={formBusy || (!placed && !formValid)}
              onClick={() => void submit()}
            >
              {placed ? 'Added to ballot' : formBusy ? 'Submitting…' : formValid && askNum > 0 ? `Suggest job for $${askNum}` : 'Suggest job'}
            </button>
          </div>
        </FloorModal>
      )}
    </section>
  );
}
