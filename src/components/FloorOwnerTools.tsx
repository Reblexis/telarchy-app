import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * The two things a floor's owner can do to their own floor, on the floor
 * itself (owner direction 2026-08-22, `docs/operator-setup.md`).
 *
 * It is NOT the console's create-workspace wizard reborn. That flow asked a
 * stranger to configure a product they had not seen work yet, on a page that
 * was not the product. This is the opposite: it only appears to someone who
 * already has a live floor, in the place they are already looking at it, and
 * it does the two things the owner side was actually missing.
 *
 *  1. **Add a number.** The API could always do it; there was no screen. Four
 *     fields, because a market cannot open without them: what the number is,
 *     where its value comes from (that text IS what the market settles on),
 *     the ceiling it prices inside, and when it lands. A metric with no
 *     horizon opens no market, which is how you end up owning a settings page
 *     instead of a floor.
 *  2. **Deepen the market.** Liquidity is the owner's steering wheel
 *     (vision.md, "Decision quality scales with capital"): a pool is how an
 *     owner says which question is worth answering well. The primitive was
 *     there (`POST /api/predictions/markets/:id/liquidity`) with no
 *     owner-facing control, so the only lever was one blunt per-workspace
 *     auto-fund number applied evenly to markets they did not care about.
 *
 * Both go through the documented endpoints an outside participant would use
 * (AGENTS.md, "Frontend goes through the public API").
 */

/** Pool credits behind an LMSR market, from its `b`. The market row stores
 *  both and the floor payload publishes only `b`; the relation is exact
 *  (`b = pool / ln 2`), so deriving it here beats widening the public payload
 *  for one owner-only line. */
function poolCredits(b: number): number {
  return b * Math.LN2;
}

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** The month after the current one, the earliest horizon that is fully ahead
 *  of whoever is reading. */
function defaultHorizon(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function FloorOwnerTools({ market, onChanged }: {
  /** The clock currently on screen. Funding follows the market the owner is
   *  looking at, never "the first one", so the control cannot deepen a
   *  different question than the page is showing. */
  market: { marketId: string; label: string; liquidity: number } | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<'none' | 'metric' | 'liquidity'>('none');
  const [balance, setBalance] = useState<number | null>(null);

  // Adding a number.
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [horizon, setHorizon] = useState(defaultHorizon());

  // Deepening the market.
  const [amount, setAmount] = useState('');

  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    api.getParticipant()
      .then((p: { balance?: number }) => setBalance(typeof p.balance === 'number' ? p.balance : null))
      .catch(e => console.error('owner balance fetch failed:', e));
  }, [done]);

  const addNumber = async () => {
    setErr(''); setDone('');
    const max = Number(ceiling.replace(/[^0-9.]/g, ''));
    if (!name.trim()) { setErr('The number needs a name.'); return; }
    if (!Number.isFinite(max) || max <= 0) { setErr('The ceiling has to be a number above zero.'); return; }
    if (!/^\d{4}-\d{2}$/.test(horizon)) { setErr('Pick the month it lands in.'); return; }
    setBusy('Opening the market…');
    try {
      // A custom horizon rather than the default time-preference curve: one
      // number the owner named, one market, one settle date. The curve would
      // open several markets they did not ask for.
      await api.createMetric({
        name: name.trim(),
        description: source.trim(),
        value: 0,
        formula: '',
        marketRangeMax: max,
        timePreference: { enabled: false, halfLife: 1, customHorizons: [horizon] },
      });
      setName(''); setSource(''); setCeiling(''); setHorizon(defaultHorizon());
      setOpen('none');
      setDone('Market open. It is on the clock arrows above.');
      onChanged();
    } catch (e) {
      setErr((e as Error).message || 'Could not open the market');
    } finally {
      setBusy('');
    }
  };

  const deepen = async () => {
    if (!market) return;
    setErr(''); setDone('');
    const credits = Number(amount.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(credits) || credits <= 0) { setErr('Enter how many credits to add.'); return; }
    setBusy('Adding…');
    try {
      // Debits the caller's own balance; the endpoint's `agentId` form (paying
      // out of someone else's) is an admin action and deliberately not offered
      // here.
      await api.injectLiquidity(market.marketId, credits);
      setAmount('');
      setOpen('none');
      setDone(`${money(credits)} credits added to ${market.label}.`);
      onChanged();
    } catch (e) {
      setErr((e as Error).message || 'Could not add liquidity');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="pubws-know pubws-enter pubws-enter--3" aria-label="Yours to run">
      <div className="pubws-know-headrow">
        <h2 className="pubws-know-head">Yours to run</h2>
        {balance !== null && (
          <span className="pubws-know-edit" aria-label="Your balance">{money(balance)} credits</span>
        )}
      </div>

      <p className="pubws-know-what">
        {market
          ? <>This market holds <strong>{money(poolCredits(market.liquidity))} credits</strong> of subsidy. Deeper markets cost more to move, so a price you read off one is worth more.</>
          : <>This floor has no open market yet. Add a number to open one.</>}
      </p>

      {open === 'none' && (
        <div className="pubws-know-editor-actions">
          <button className="pubws-decide" onClick={() => { setErr(''); setDone(''); setOpen('metric'); }}>
            Add a number
          </button>
          {market && (
            <button className="pubws-decide" onClick={() => { setErr(''); setDone(''); setOpen('liquidity'); }}>
              Deepen this market
            </button>
          )}
        </div>
      )}

      {open === 'metric' && (
        <div className="pubws-know-editor">
          <label className="pubws-field" htmlFor="own-metric-name">
            <span className="pubws-field-label">The number</span>
            <input
              id="own-metric-name" className="pubws-field-line" value={name} maxLength={80}
              onChange={e => setName(e.target.value)} placeholder="Monthly disputes arbitrated"
            />
          </label>
          <label className="pubws-field" htmlFor="own-metric-source">
            <span className="pubws-field-label">Where its value comes from</span>
            <textarea
              id="own-metric-source" className="pubws-field-line" value={source} rows={3} maxLength={4000}
              onChange={e => setSource(e.target.value)}
              placeholder="Counted on-chain from the arbitrator contract, read on the first of the month."
            />
            <span className="pubws-field-hint">
              This is what the market settles on. Say it the way you would have
              to defend it to someone who bet against you.
            </span>
          </label>
          <label className="pubws-field" htmlFor="own-metric-ceiling">
            <span className="pubws-field-label">The highest it could plausibly reach</span>
            <input
              id="own-metric-ceiling" className="pubws-field-line" value={ceiling} inputMode="numeric"
              onChange={e => setCeiling(e.target.value)} placeholder="5000"
            />
            <span className="pubws-field-hint">
              The market prices between zero and this. Too low and it pins at the
              top; too high and every forecast looks the same.
            </span>
          </label>
          <label className="pubws-field" htmlFor="own-metric-horizon">
            <span className="pubws-field-label">The month it lands in</span>
            <input
              id="own-metric-horizon" className="pubws-field-line" type="month" value={horizon}
              onChange={e => setHorizon(e.target.value)}
            />
          </label>
          {err && <p className="ticket-err">{err}</p>}
          <div className="pubws-know-editor-actions">
            <button className="pubws-decide" onClick={addNumber} disabled={!!busy}>
              {busy || 'Open the market'}
            </button>
            <button className="pubws-decide" onClick={() => setOpen('none')} disabled={!!busy}>Cancel</button>
          </div>
        </div>
      )}

      {open === 'liquidity' && market && (
        <div className="pubws-know-editor">
          <label className="pubws-field" htmlFor="own-liq-amount">
            <span className="pubws-field-label">Credits to add to {market.label}</span>
            <input
              id="own-liq-amount" className="pubws-field-line" value={amount} inputMode="decimal"
              onChange={e => setAmount(e.target.value)} placeholder="500"
            />
            <span className="pubws-field-hint">
              Out of your own balance. It stays in the market until it resolves,
              and traders who are right take it from you: that is the price of a
              number worth reading.
            </span>
          </label>
          {err && <p className="ticket-err">{err}</p>}
          <div className="pubws-know-editor-actions">
            <button className="pubws-decide" onClick={deepen} disabled={!!busy}>
              {busy || 'Add'}
            </button>
            <button className="pubws-decide" onClick={() => setOpen('none')} disabled={!!busy}>Cancel</button>
          </div>
        </div>
      )}

      {done && <p className="pubws-field-hint">{done}</p>}
    </section>
  );
}
