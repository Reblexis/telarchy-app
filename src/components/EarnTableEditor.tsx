import { useEffect, useState } from 'react';
import { api, type EarnRule } from '../lib/api';

/**
 * The earn table, editable on /admin (owner ask 2026-08-30). Every way to
 * receive free credits is a row with a price the operator changes in
 * place, mid-season included.
 *
 * Why this screen exists at all: a grant is bankroll, bankroll becomes
 * settled profit, and settled profit becomes prize money, so the price of
 * each signal IS the anti-farming lever. Priced above what a signal costs
 * to fake it funds a sybil farm; priced at what the account genuinely
 * brings, farming becomes a purchase. Nothing here touches market
 * mechanics, which is the point: re-pricing a signal changes nobody's
 * trade (docs/agent-economy.md; design record in the telarchy umbrella,
 * notes/earn-table-design-2026-08-30.md).
 *
 * One row edits at a time, Save per row, because these are prices that
 * decide money and a bulk-save form invites a slip on a row nobody meant
 * to touch.
 */
export function EarnTableEditor() {
  const [rules, setRules] = useState<EarnRule[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [liqDrafts, setLiqDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = () => {
    api
      .getAdminEarnTable()
      .then(r => {
        setRules(r.rules);
        setDrafts(Object.fromEntries(r.rules.map(x => [x.key, String(x.credits)])));
        setLiqDrafts(Object.fromEntries(r.rules.map(x => [x.key, String(x.liquidityCredits ?? 0)])));
      })
      .catch(e => setErr((e as Error).message || 'Could not read the earn table'));
  };

  useEffect(load, []);

  const save = async (rule: EarnRule) => {
    const raw = drafts[rule.key];
    const credits = Number(raw);
    if (!Number.isFinite(credits) || credits < 0) {
      setErr(`${rule.label}: credits must be a number, zero or more`);
      return;
    }
    const liquidityCredits = Number(liqDrafts[rule.key]);
    if (!Number.isFinite(liquidityCredits) || liquidityCredits < 0) {
      setErr(`${rule.label}: liquidity must be a number, zero or more`);
      return;
    }
    setBusy(rule.key);
    setErr('');
    try {
      await api.setEarnRule(rule.key, { credits, liquidityCredits });
      setSaved(rule.key);
      setTimeout(() => setSaved(null), 2000);
      load();
    } catch (e) {
      setErr((e as Error).message || 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (rule: EarnRule) => {
    setBusy(rule.key);
    setErr('');
    try {
      await api.setEarnRule(rule.key, { enabled: !(rule.enabled ?? true) });
      load();
    } catch (e) {
      setErr((e as Error).message || 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="adm-block">
      <h2 className="pubws-h2">Earn table</h2>
      <p className="adm-note">
        What every way of receiving free credits is worth, right now. Changes take effect on the next grant, are
        published at <code>/api/earn</code>, and are kept in an append-only history, so a price changed mid-season stays
        reconstructable. Price each one at what it costs somebody to fake against what it actually brings.
      </p>
      {err && <p className="adm-err">{err}</p>}
      {rules === null ? null : rules.length === 0 ? (
        <p className="adm-empty">No earn rules yet.</p>
      ) : (
        <ul className="adm-earnlist">
          {rules.map(r => {
            const enabled = r.enabled ?? true;
            return (
              <li key={r.key} className={`adm-earnrow${enabled ? '' : ' is-off'}`}>
                <div className="adm-earnhead">
                  <span className="adm-earnlabel">{r.label}</span>
                  <span className="adm-earnkey">{r.key}</span>
                  {r.kind === 'cap' && (
                    <span className="adm-earnkind" title="Grants up to this much from a measured signal">
                      cap
                    </span>
                  )}
                </div>
                {r.note && <p className="adm-earnnote">{r.note}</p>}
                <div className="adm-earnedit">
                  <input
                    className="adm-earnamt"
                    inputMode="numeric"
                    value={drafts[r.key] ?? ''}
                    onChange={e => setDrafts(d => ({ ...d, [r.key]: e.target.value.replace(/[^0-9.]/g, '') }))}
                    aria-label={`Credits for ${r.label}`}
                  />
                  <span className="adm-earnunit">cr</span>
                  {/* The wallet half of the same rule, priced beside it and
                    never summed with it: one purse trades, the other can
                    only go behind a market (owner decision 2026-09-01). */}
                  <input
                    className="adm-earnamt"
                    inputMode="numeric"
                    value={liqDrafts[r.key] ?? ''}
                    onChange={e => setLiqDrafts(d => ({ ...d, [r.key]: e.target.value.replace(/[^0-9.]/g, '') }))}
                    aria-label={`Liquidity for ${r.label}`}
                  />
                  <span className="adm-earnunit">liq</span>
                  <button
                    type="button"
                    className="adm-paygo"
                    disabled={
                      busy === r.key ||
                      (String(r.credits) === (drafts[r.key] ?? '') &&
                        String(r.liquidityCredits ?? 0) === (liqDrafts[r.key] ?? ''))
                    }
                    onClick={() => void save(r)}
                  >
                    {busy === r.key ? 'Saving…' : saved === r.key ? 'Saved' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="adm-earntoggle"
                    disabled={busy === r.key}
                    onClick={() => void toggle(r)}
                  >
                    {enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
