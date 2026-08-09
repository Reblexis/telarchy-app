import { useState } from 'react';
import type { PublicProposal } from '../lib/api';

/**
 * The jobs board: the proposal side of the trading floor, rendered for
 * signed-in participants (paid-jobs round 1, charter of 2026-08-09).
 * A proposal is a job with a price ("$80: I will ..."); its conditional
 * pair prices what happens to the metric if the money is sent.
 *
 * One number per job (owner decision 2026-08-09: as few numbers as
 * possible): the impact, which IS if-done minus if-not-done. The two
 * branch values are no longer shown, and the expanded row trades the
 * approved branch only, so "bigger/smaller" moves that single number.
 * The declined branch holds the seeded counterfactual; the API still
 * supports trading it directly.
 *
 * The form asks for the USD ask separately and composes it into the title,
 * so the API stays untouched (round 1 encodes the ask as a text
 * convention). The ask is required: every job has a price.
 */

const BRANCH_TRADE_CR = 25;

interface Props {
  proposals: PublicProposal[];
  unit: string;
  onBranchTrade: (p: PublicProposal, branch: 'approved' | 'declined', dir: 'higher' | 'lower', amount: number) => Promise<void>;
  onPropose: (title: string, description: string) => Promise<void>;
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
function splitAsk(title: string): { ask: number | null; rest: string } {
  const m = title.match(/^\$(\d+):\s*(.*)$/s);
  return m ? { ask: parseInt(m[1], 10), rest: m[2] } : { ask: null, rest: title };
}

function headlineDelta(p: PublicProposal): number | null {
  const deltas = p.markets.map(m => m.delta).filter((d): d is number => d !== null);
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), deltas[0]);
}

export function JobsBoard({ proposals, unit, onBranchTrade, onPropose }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tradeErr, setTradeErr] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [ask, setAsk] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  // The ballot is a ranking: the owner acts on it, so the biggest priced
  // impact belongs at the top and the unpriced ones below.
  const ranked = [...proposals].sort((a, b) => {
    const da = headlineDelta(a) ?? 0;
    const db = headlineDelta(b) ?? 0;
    return db - da;
  });

  const trade = async (p: PublicProposal, branch: 'approved' | 'declined', dir: 'higher' | 'lower') => {
    if (busy) return;
    const key = `${p.id}-${branch}-${dir}`;
    setTradeErr('');
    setBusy(key);
    try {
      await onBranchTrade(p, branch, dir, BRANCH_TRADE_CR);
    } catch (e) {
      setTradeErr((e as Error).message || 'Trade failed');
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!title.trim()) { setFormErr('Say what you will do.'); return; }
    const askNum = Math.max(0, Math.floor(parseFloat(ask) || 0));
    // Every proposal is a job with a price (charter, 2026-08-09): the ask
    // is required. The round-1 convention composes it into the title.
    if (askNum <= 0) { setFormErr('Name your price in USD. Every job has one.'); return; }
    const fullTitle = `$${askNum}: ${title.trim()}`;
    setFormErr('');
    setFormBusy(true);
    try {
      await onPropose(fullTitle, desc.trim());
      setAsk(''); setTitle(''); setDesc(''); setFormOpen(false);
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
            const expanded = open === p.id;
            const pair = p.markets[0];
            const { ask: askUsd, rest: titleRest } = splitAsk(p.title);
            return (
              <li key={p.id} className={expanded ? 'is-open' : ''}>
                <button className="pubws-ballot-row" onClick={() => setOpen(expanded ? null : p.id)}>
                  <span className="pubws-ballot-main">
                    <span className="pubws-ballot-title">{titleRest}</span>
                    <span className="pubws-ballot-facts">
                      {p.proposedByName && <span>by {p.proposedByName}</span>}
                      {askUsd !== null && <span>asks ${askUsd}</span>}
                    </span>
                  </span>
                  <span className="pubws-ballot-impact">
                    {delta === null || delta === 0
                      ? <span className="pubws-ballot-delta pubws-ballot-delta--open">open</span>
                      : <span className={`pubws-ballot-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>{fmtDelta(delta, unit)}</span>}
                  </span>
                </button>
                {expanded && (
                  <div className="pubws-ballot-detail">
                    {p.description && <p className="pubws-proposal-desc">{p.description}</p>}
                    {pair && (
                      <div className="pubws-impact-trade">
                        <span className="pubws-impact-ask">Is the impact bigger or smaller?</span>
                        <span className="pubws-branch-btns">
                          <button
                            className="pubws-dir pubws-dir--lower pubws-dir--mini"
                            disabled={busy !== null}
                            onClick={() => void trade(p, 'approved', 'lower')}
                          >
                            {busy === `${p.id}-approved-lower` ? '…' : '▼'}
                          </button>
                          <button
                            className="pubws-dir pubws-dir--higher pubws-dir--mini"
                            disabled={busy !== null}
                            onClick={() => void trade(p, 'approved', 'higher')}
                          >
                            {busy === `${p.id}-approved-higher` ? '…' : '▲'}
                          </button>
                        </span>
                        <span className="pubws-proposal-meta">{BRANCH_TRADE_CR} cr a tap</span>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {tradeErr && <p className="pubws-joinerr">{tradeErr}</p>}

      {formOpen ? (
        <div className="pubws-propose">
          <div className="pubws-propose-row">
            <input
              className="pubws-propose-ask"
              value={ask}
              onChange={e => setAsk(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="$ ask"
              inputMode="numeric"
              aria-label="Your price in USD (required)"
              required
            />
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What will you do?"
              maxLength={110}
              aria-label="Job title"
            />
          </div>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Why it moves the number, and proof you can deliver (links to your channel, portfolio, prior work). Payment handle here or after approval."
            rows={4}
            aria-label="Job description"
          />
          <div className="pubws-propose-row">
            <button className="pubws-cta pubws-cta--small" disabled={formBusy} onClick={() => void submit()}>
              {formBusy ? 'Submitting…' : 'Put it on the ballot · 40 cr stake'}
            </button>
            <button className="pubws-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
          <p className="pubws-proposal-meta">
            The stake seeds your job&rsquo;s market so it is priceable at once; it is refunded at resolution, not a fee. Approval pays your ask and grants nothing else.
          </p>
          {formErr && <p className="pubws-joinerr">{formErr}</p>}
        </div>
      ) : (
        <button className="pubws-ghost pubws-propose-open" onClick={() => setFormOpen(true)}>
          + Suggest a job
        </button>
      )}
    </section>
  );
}
