import { useState } from 'react';
import type { PublicProposal } from '../lib/api';

/**
 * The jobs board: the proposal side of the trading floor, rendered for
 * signed-in participants (paid-jobs round 1, charter of 2026-08-09).
 * A proposal is a job with a price ("$80: I will ..."); its conditional
 * pair prices what happens to the metric if the money is sent. Rows are
 * hairline list items (ui-conventions): title, the priced gap, and on
 * expand the pitch plus per-branch quick trades. The form asks for the
 * USD ask separately and composes it into the title, so the API stays
 * untouched (round 1 encodes the ask as a text convention).
 */

const BRANCH_TRADE_CR = 25;

interface Props {
  proposals: PublicProposal[];
  unit: string;
  metricName: string;
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

function headlineDelta(p: PublicProposal): number | null {
  const deltas = p.markets.map(m => m.delta).filter((d): d is number => d !== null);
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), deltas[0]);
}

export function JobsBoard({ proposals, unit, metricName, onBranchTrade, onPropose }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tradeErr, setTradeErr] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [ask, setAsk] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

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
    // The charter's round-1 convention: the ask lives in the proposal text.
    const fullTitle = askNum > 0 ? `$${askNum}: ${title.trim()}` : title.trim();
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
      <h2 className="pubws-h2">
        Jobs on the ballot
        <span className="pubws-h2-context"> · priced impact on {metricName}</span>
      </h2>

      {proposals.length === 0 ? (
        <p className="pubws-empty">Nothing on the ballot yet. Yours could be first.</p>
      ) : (
        <ul className="pubws-ballot">
          {proposals.map(p => {
            const delta = headlineDelta(p);
            const expanded = open === p.id;
            const pair = p.markets[0];
            return (
              <li key={p.id} className={expanded ? 'is-open' : ''}>
                <button className="pubws-ballot-row" onClick={() => setOpen(expanded ? null : p.id)}>
                  <span className="pubws-ballot-title">{p.title}</span>
                  {delta === null || delta === 0
                    ? <span className="pubws-ballot-delta pubws-ballot-delta--open">open</span>
                    : <span className={`pubws-ballot-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>{fmtDelta(delta, unit)}</span>}
                </button>
                {expanded && (
                  <div className="pubws-ballot-detail">
                    {p.description && <p className="pubws-proposal-desc">{p.description}</p>}
                    {pair && (
                      <div className="pubws-branches">
                        <BranchRow
                          label="if paid"
                          value={pair.approvedConsensus}
                          unit={unit}
                          busyPrefix={`${p.id}-approved`}
                          busy={busy}
                          onTrade={dir => void trade(p, 'approved', dir)}
                        />
                        <BranchRow
                          label="if not"
                          value={pair.declinedConsensus}
                          unit={unit}
                          busyPrefix={`${p.id}-declined`}
                          busy={busy}
                          onTrade={dir => void trade(p, 'declined', dir)}
                        />
                        <p className="pubws-proposal-meta">each tap trades {BRANCH_TRADE_CR} cr</p>
                      </div>
                    )}
                    {p.proposedByName && <p className="pubws-proposal-meta">proposed by {p.proposedByName}</p>}
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
              aria-label="Your price in USD"
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
            The stake seeds your job&rsquo;s own market so it is priceable immediately; it is a liquidity position, refunded pro-rata at resolution, not a fee. Read the charter before asking for money: approval pays your ask, and nothing else is granted.
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

function BranchRow({ label, value, unit, busyPrefix, busy, onTrade }: {
  label: string;
  value: number | null;
  unit: string;
  busyPrefix: string;
  busy: string | null;
  onTrade: (dir: 'higher' | 'lower') => void;
}) {
  return (
    <div className="pubws-branch">
      <span className="pubws-branch-label">{label}</span>
      <span className="pubws-branch-value">{value !== null ? fmtVal(value, unit) : '–'}</span>
      <span className="pubws-branch-btns">
        <button className="pubws-dir pubws-dir--lower pubws-dir--mini" disabled={busy !== null} onClick={() => onTrade('lower')}>
          {busy === `${busyPrefix}-lower` ? '…' : '▼'}
        </button>
        <button className="pubws-dir pubws-dir--higher pubws-dir--mini" disabled={busy !== null} onClick={() => onTrade('higher')}>
          {busy === `${busyPrefix}-higher` ? '…' : '▲'}
        </button>
      </span>
    </div>
  );
}
