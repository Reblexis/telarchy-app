import { FloorModal } from './FloorModal';
import { useState } from 'react';
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
  onPropose: (title: string, description: string, askUsd: number, payoutHandle: string) => Promise<void>;
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

export function JobsBoard({ proposals, unit, selectedId, onSelect, onPropose }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [ask, setAsk] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [payout, setPayout] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  // The ballot is a ranking: the owner acts on it, so the biggest priced
  // impact belongs at the top and the unpriced ones below.
  const ranked = [...proposals].sort((a, b) => {
    const da = headlineDelta(a) ?? 0;
    const db = headlineDelta(b) ?? 0;
    return db - da;
  });

  const submit = async () => {
    if (!title.trim()) { setFormErr('Say what you will do.'); return; }
    const askNum = Math.max(0, Math.floor(parseFloat(ask) || 0));
    // Every proposal is a job with a price (charter, 2026-08-09): the ask
    // is required. The round-1 convention composes it into the title.
    if (askNum <= 0) { setFormErr('Name your price in USD. Every job has one.'); return; }
    // A paid job needs somewhere for the money to go, or approval is a
    // promise the owner cannot keep. Enforced server-side too.
    if (payout.trim().length < 5) { setFormErr('Say where the money should go: a PayPal email, IBAN, or crypto address.'); return; }
    // The title still carries the price because it reads well and travels
    // (activity log, share text); the number is also sent separately, and
    // that copy is the one anything financial reads.
    const fullTitle = `$${askNum}: ${title.trim()}`;
    setFormErr('');
    setFormBusy(true);
    try {
      await onPropose(fullTitle, desc.trim(), askNum, payout.trim());
      setAsk(''); setTitle(''); setDesc(''); setPayout(''); setFormOpen(false);
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
                      {p.proposedByName && <span>by {p.proposedByName}</span>}
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
      <button className="pubws-ghost pubws-propose-open" onClick={() => setFormOpen(true)}>
        + Suggest a job
      </button>
      {/* The form is a dialog, not a rail squeeze (owner direction
          2026-08-10, reworked same day after a review: one field skin, a
          label over every field, the counter on the label line instead of
          dangling, one full-width primary, and the close lives in the
          corner like every dialog; Escape and the backdrop also close). */}
      {formOpen && (
        <FloorModal onClose={() => setFormOpen(false)} label="Suggest a job">
          <div className="jobform">
            <div className="jobform-head">
              <h3 className="floor-modal-title">Suggest a job</h3>
              <button className="jobform-x" aria-label="Close" onClick={() => setFormOpen(false)}>×</button>
            </div>
            {/* The ticket's technique, verbatim (owner direction 2026-08-10:
                same styling as the betting UI): centered quiet labels, bare
                inputs on underlines, no boxes anywhere, the one filled
                element is the confirm. */}
            <p className="ticket-label">
              What will you do? <span className={`jobform-count${title.length >= 60 ? ' is-near' : ''}`}>{title.length}/70</span>
            </p>
            <input
              className="jobform-line jobform-line--title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Stream LookPilot to my viewers for an hour"
              maxLength={70}
              aria-label="Job title"
            />
            <p className="ticket-label">Your price, paid on approval</p>
            <label className="jobform-price">
              <span aria-hidden="true">$</span>
              <input
                value={ask}
                style={{ width: `${Math.max(1, ask.length)}ch` }}
                onChange={e => setAsk(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0"
                inputMode="numeric"
                aria-label="Your price in USD (required)"
                required
              />
            </label>
            <p className="ticket-label">Where the money goes if approved</p>
            <input
              className="jobform-line jobform-line--title"
              value={payout}
              onChange={e => setPayout(e.target.value)}
              placeholder="PayPal email, IBAN, or crypto address"
              maxLength={200}
              aria-label="Payout handle"
            />
            <p className="ticket-label">Why you, and why it moves the number</p>
            <textarea
              className="jobform-line jobform-line--desc"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Links to your channel, portfolio, prior work. Payment handle here or after approval."
              rows={4}
              aria-label="Job description"
            />
            <button className="jobform-go" disabled={formBusy} onClick={() => void submit()}>
              {formBusy ? 'Submitting…' : 'Put it on the ballot · 500 cr stake'}
            </button>
            <p className="ticket-foot jobform-fine">
              The stake seeds your job&rsquo;s two markets and comes back in
              full when the owner decides. Approval pays your ask and grants
              nothing else.
            </p>
            {formErr && <p className="ticket-err">{formErr}</p>}
          </div>
        </FloorModal>
      )}
    </section>
  );
}
