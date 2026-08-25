import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { type DepositAddressInfo, TopUpCreditsInstructions } from './TopUpCreditsInstructions';

/**
 * Money in and money out, in the account dialog's own language.
 *
 * This is the one part of the deleted console `/account` page that a public
 * trader genuinely needed (owner decision 2026-08-19: the old GUI goes, and
 * what the floor reaches gets rebuilt here rather than left behind a URL
 * nobody links). It renders NOTHING unless the instance has USDC settlement
 * switched on, because on a simulation instance a deposit box is an
 * invitation to send real money into a game.
 */
export interface CreditsAccount {
  balance: number | null;
  walletAddress?: string;
  earnedBetting: number | null;
  spentBetting: number | null;
}

/** `me` is the dialog's own participant row, passed down rather than
 *  re-fetched, and `onChanged` re-reads it after money moves. */
export function AccountCredits({ me, onChanged }: { me: CreditsAccount | null; onChanged: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [deposit, setDeposit] = useState<DepositAddressInfo | null>(null);

  const [txHash, setTxHash] = useState('');
  const [amount, setAmount] = useState('');
  const [wallet, setWallet] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const [status, dep] = await Promise.all([
        api.getStatus().catch(e => {
          console.error('status fetch failed:', e);
          return null;
        }),
        api.getDepositAddress().catch(() => null),
      ]);
      setEnabled(Boolean((status as { usdcSettlementEnabled?: boolean } | null)?.usdcSettlementEnabled));
      setDeposit(
        dep?.address && dep.usdcContract
          ? { address: dep.address, usdcContract: dep.usdcContract, chain: dep.chain, asset: dep.asset }
          : null,
      );
    })();
  }, []);

  useEffect(() => {
    if (me?.walletAddress) setWallet(me.walletAddress);
  }, [me?.walletAddress]);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setErrors(({ [key]: _gone, ...rest }) => rest);
    setNotes(({ [key]: _also, ...rest }) => rest);
    try {
      const note = await fn();
      setNotes(n => ({ ...n, [key]: note }));
      onChanged();
    } catch (e) {
      setErrors(er => ({ ...er, [key]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const onDeposit = (e: FormEvent) => {
    e.preventDefault();
    void run('deposit', async () => {
      const r = (await api.depositForMe(txHash.trim())) as { credits: number };
      setTxHash('');
      return `Deposited ${r.credits} credits.`;
    });
  };

  const onWithdraw = (e: FormEvent) => {
    e.preventDefault();
    const value = parseFloat(amount);
    if (isNaN(value) || value <= 0) return;
    void run('withdraw', async () => {
      const r = (await api.withdrawFromMe(value)) as { usdcAmount: number; txHash: string };
      setAmount('');
      return `Withdrew ${r.usdcAmount} USDC. Tx ${r.txHash}`;
    });
  };

  const onWallet = (e: FormEvent) => {
    e.preventDefault();
    void run('wallet', async () => {
      await api.setMyWallet(wallet.trim());
      return 'Wallet saved.';
    });
  };

  if (!enabled || !me) return null;

  return (
    <>
      <div className="jobform-field">
        <span className="ticket-label">Credits</span>
        <p className="acctdlg-hint">
          {(me.balance ?? 0).toFixed(2)} to trade
          {me.earnedBetting || me.spentBetting
            ? ` · +${(me.earnedBetting ?? 0).toFixed(2)} earned · -${(me.spentBetting ?? 0).toFixed(2)} spent`
            : ''}
        </p>
      </div>

      <div className="jobform-field">
        <span className="ticket-label">Top up</span>
        <TopUpCreditsInstructions deposit={deposit} />
        <form className="acctdlg-inline" onSubmit={onDeposit}>
          <input
            className="jobform-line"
            value={txHash}
            onChange={e => setTxHash(e.target.value)}
            placeholder="0x… transaction hash"
            aria-label="Deposit transaction hash"
          />
          <button className="acctdlg-ghost" disabled={busy === 'deposit' || !txHash.trim()}>
            {busy === 'deposit' ? 'Verifying…' : 'Verify'}
          </button>
        </form>
        {notes.deposit && <p className="acctdlg-ok">{notes.deposit}</p>}
        {errors.deposit && <p className="ticket-err">{errors.deposit}</p>}
      </div>

      <div className="jobform-field">
        <span className="ticket-label">Payout wallet</span>
        <form className="acctdlg-inline" onSubmit={onWallet}>
          <input
            className="jobform-line"
            value={wallet}
            onChange={e => setWallet(e.target.value)}
            placeholder="0x… Base address"
            aria-label="Base wallet address"
          />
          <button className="acctdlg-ghost" disabled={busy === 'wallet' || !wallet.trim()}>
            {busy === 'wallet' ? 'Saving…' : me.walletAddress ? 'Update' : 'Save'}
          </button>
        </form>
        {notes.wallet && <p className="acctdlg-ok">{notes.wallet}</p>}
        {errors.wallet && <p className="ticket-err">{errors.wallet}</p>}
      </div>

      <div className="jobform-field">
        <span className="ticket-label">Withdraw</span>
        <form className="acctdlg-inline" onSubmit={onWithdraw}>
          <input
            className="jobform-line"
            type="number"
            min="0.000001"
            step="any"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="credits"
            aria-label="Credits to withdraw"
          />
          <button className="acctdlg-ghost" disabled={busy === 'withdraw' || !amount || !me.walletAddress}>
            {busy === 'withdraw' ? 'Sending…' : 'Withdraw'}
          </button>
        </form>
        {!me.walletAddress && <p className="acctdlg-hint">Save a wallet address first.</p>}
        {notes.withdraw && <p className="acctdlg-ok">{notes.withdraw}</p>}
        {errors.withdraw && <p className="ticket-err">{errors.withdraw}</p>}
      </div>
    </>
  );
}
