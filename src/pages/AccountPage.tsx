import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { authClient } from '../lib/auth-client';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { TopUpCreditsInstructions, type DepositAddressInfo } from '../components/TopUpCreditsInstructions';

interface MyAgent {
  id: string;
  balance: number;
  walletAddress?: string;
  earnedBetting: number;
  spentBetting: number;
}

export function AccountPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [agent, setAgent] = useState<MyAgent | null>(null);
  const [depositMeta, setDepositMeta] = useState<DepositAddressInfo | null>(null);
  const [usdcEnabled, setUsdcEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [txHash, setTxHash] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [depositMsg, setDepositMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [walletAddr, setWalletAddr] = useState('');
  const [savingWallet, setSavingWallet] = useState(false);
  const [walletMsg, setWalletMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [copied, setCopied] = useState(false);
  const copyUid = () => {
    if (!user) return;
    navigator.clipboard.writeText(user.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    await api.getProfile().catch((e: Error) => {
      setError(e.message);
      return null;
    });
    const [participant, dep, status] = await Promise.all([
      api.getParticipant().catch((e: Error) => { setError(e.message); return null; }),
      api.getDepositAddress().catch(() => null),
      api.getStatus().catch(() => null),
    ]);
    setAgent((participant as MyAgent | null) ?? null);
    if (participant) setWalletAddr((participant as MyAgent).walletAddress ?? '');
    setUsdcEnabled(Boolean((status as { usdcSettlementEnabled?: boolean } | null)?.usdcSettlementEnabled));
    if (dep?.address && dep.usdcContract) {
      setDepositMeta({
        address: dep.address,
        usdcContract: dep.usdcContract,
        chain: dep.chain,
        asset: dep.asset,
      });
    } else {
      setDepositMeta(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (loading || location.hash !== '#top-up-credits') return;
    const el = document.getElementById('top-up-credits');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, location.hash]);

  const handleDeposit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    setDepositing(true);
    setDepositMsg(null);
    const result = await api.depositForMe(txHash.trim())
      .catch((e: Error) => { setDepositMsg({ ok: false, text: e.message }); return null; });
    if (result) {
      setDepositMsg({ ok: true, text: `Deposited ${(result as { credits: number }).credits} credits.` });
      setTxHash('');
      load();
    }
    setDepositing(false);
  };

  const handleWithdraw = async (e: FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) return;
    setWithdrawing(true);
    setWithdrawMsg(null);
    const result = await api.withdrawFromMe(amount)
      .catch((e: Error) => { setWithdrawMsg({ ok: false, text: e.message }); return null; });
    if (result) {
      const r = result as { usdcAmount: number; txHash: string };
      setWithdrawMsg({ ok: true, text: `Withdrew ${r.usdcAmount} USDC. Tx: ${r.txHash}` });
      setWithdrawAmount('');
      load();
    }
    setWithdrawing(false);
  };

  const handleSaveWallet = async (e: FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    setSavingWallet(true);
    setWalletMsg(null);
    const result = await api.setMyWallet(walletAddr.trim())
      .catch((e: Error) => { setWalletMsg({ ok: false, text: e.message }); return null; });
    if (result) {
      setWalletMsg({ ok: true, text: 'Wallet address saved.' });
      load();
    }
    setSavingWallet(false);
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setChangingPassword(true);
    setPasswordMsg(null);
    const { error: pwError } = await authClient.changePassword({
      currentPassword,
      newPassword,
    });
    if (pwError) {
      setPasswordMsg({ ok: false, text: pwError.message || 'Failed to update password.' });
    } else {
      setPasswordMsg({ ok: true, text: 'Password updated.' });
      setCurrentPassword('');
      setNewPassword('');
    }
    setChangingPassword(false);
  };

  if (!user) return null;

  const inputStyle = {
    padding: '0.45rem 0.6rem',
    borderRadius: '0.375rem',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: '0.875rem',
  } as const;

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Account</h1>

      {/* Identity */}
      <div className="section" style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem' }}>
          Identity
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Email</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{user.email}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>User ID</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <code style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{user.id}</code>
              <button
                onClick={copyUid}
                style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          {agent && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Participant ID</span>
              <code style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{agent.id}</code>
            </div>
          )}
        </div>
      </div>

      {/* Change password */}
      <div className="section" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>Change password</h2>
        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            required
            style={inputStyle}
          />
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="New password"
            required
            minLength={8}
            style={inputStyle}
          />
          <button type="submit" disabled={changingPassword || !currentPassword || !newPassword} style={{ alignSelf: 'flex-start' }}>
            {changingPassword ? 'Updating…' : 'Update password'}
          </button>
        </form>
        {passwordMsg && (
          <div className={`message ${passwordMsg.ok ? 'success' : 'error'} show`} style={{ marginTop: '0.5rem' }}>
            {passwordMsg.text}
          </div>
        )}
      </div>

      {error && <div className="message error show" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : !agent ? (
        <div className="section">
          <p style={{ color: 'var(--text-secondary)' }}>No participant account found. Refresh the page or contact support if this persists.</p>
        </div>
      ) : (
        <>
          {/* Balance */}
          <div className="section">
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
                  Credit balance
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                  {agent.balance.toFixed(2)}
                  <span style={{ fontSize: '1rem', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '0.4rem' }}>credits</span>
                </div>
              </div>
              {usdcEnabled && (
                <a
                  href="#top-up-credits"
                  style={{
                    display: 'inline-block',
                    padding: '0.45rem 0.85rem',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                    color: 'var(--text-primary)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '0.375rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Top up with USDC
                </a>
              )}
            </div>
            {!usdcEnabled && (
              <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Credits on this instance are for simulation and have no redemption value.
              </p>
            )}
            {(agent.earnedBetting !== 0 || agent.spentBetting !== 0) && (
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <span>Earned: <span style={{ color: 'var(--success-text)', fontFamily: 'monospace' }}>+{agent.earnedBetting.toFixed(2)}</span></span>
                <span>Spent: <span style={{ color: 'var(--error-text)', fontFamily: 'monospace' }}>-{agent.spentBetting.toFixed(2)}</span></span>
              </div>
            )}
          </div>

          {/* Add credits */}
          {usdcEnabled && (
          <div className="section" id="top-up-credits">
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>Top up credits (USDC on Base)</h2>
            <TopUpCreditsInstructions deposit={depositMeta} />
            <form onSubmit={handleDeposit} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={txHash}
                onChange={e => setTxHash(e.target.value)}
                placeholder="0x… transaction hash"
                required
                style={{ ...inputStyle, flex: 1, minWidth: 220 }}
              />
              <button type="submit" disabled={depositing || !txHash.trim()} style={{ whiteSpace: 'nowrap' }}>
                {depositing ? 'Verifying…' : 'Verify & deposit'}
              </button>
            </form>
            {depositMsg && (
              <div className={`message ${depositMsg.ok ? 'success' : 'error'} show`} style={{ marginTop: '0.5rem' }}>
                {depositMsg.text}
              </div>
            )}
          </div>
          )}

          {/* Withdraw */}
          {usdcEnabled && (
          <div className="section">
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>Withdraw credits</h2>

            <div style={{ marginBottom: '1rem' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Register your Base wallet address to receive USDC withdrawals.
              </p>
              <form onSubmit={handleSaveWallet} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={walletAddr}
                  onChange={e => setWalletAddr(e.target.value)}
                  placeholder="0x… Base wallet address"
                  required
                  style={{ ...inputStyle, flex: 1, minWidth: 220 }}
                />
                <button type="submit" disabled={savingWallet || !walletAddr.trim()} style={{ whiteSpace: 'nowrap' }}>
                  {savingWallet ? 'Saving…' : agent.walletAddress ? 'Update wallet' : 'Save wallet'}
                </button>
              </form>
              {walletMsg && (
                <div className={`message ${walletMsg.ok ? 'success' : 'error'} show`} style={{ marginTop: '0.5rem' }}>
                  {walletMsg.text}
                </div>
              )}
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Convert credits to USDC sent to your registered wallet.
              {!agent.walletAddress && <strong> Register a wallet address first.</strong>}
            </p>
            <form onSubmit={handleWithdraw} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="number"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                placeholder="Amount in credits"
                min="0.000001"
                step="any"
                required
                style={{ ...inputStyle, width: 180 }}
              />
              <button type="submit" disabled={withdrawing || !withdrawAmount || !agent.walletAddress} style={{ whiteSpace: 'nowrap' }}>
                {withdrawing ? 'Withdrawing…' : 'Withdraw'}
              </button>
            </form>
            {withdrawMsg && (
              <div className={`message ${withdrawMsg.ok ? 'success' : 'error'} show`} style={{ marginTop: '0.5rem' }}>
                {withdrawMsg.text}
              </div>
            )}
          </div>
          )}
        </>
      )}
    </div>
  );
}
