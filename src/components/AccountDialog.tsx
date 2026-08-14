import { useEffect, useRef, useState } from 'react';
import { FloorModal } from './FloorModal';
import { api, type PayoutMethod } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

/**
 * The account, as a real dialog (owner direction 2026-08-10: the corner
 * menu got too cramped for management; spawn a whole dialog like the
 * proposal one). Everything a public trader owns lives here: picture
 * (file pick, resized client-side), username, structured payment
 * details (pick a provider, fill its fields), and the Manifold import.
 * Styled with the floor's ticket language: quiet left labels, underline
 * inputs, one neutral confirm per section.
 */

interface Participant {
  nickname: string | null;
  balance: number | null;
  earnedBetting: number | null;
  payoutHandle: string | null;
  payoutMethod: PayoutMethod | null;
}

const PROVIDERS: Array<{ id: PayoutMethod['provider']; label: string }> = [
  { id: 'paypal', label: 'PayPal' },
  { id: 'bank', label: 'Bank' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'revolut', label: 'Revolut' },
  { id: 'wise', label: 'Wise' },
  { id: 'other', label: 'Other' },
];

/** Chain is stored explicitly and never inferred from the address: every EVM
 *  chain shares the same 0x shape, so Ethereum and Base are indistinguishable
 *  from an address alone, and paying the right address on the wrong chain can
 *  put the money somewhere the recipient does not control. */
const NETWORKS = [
  { id: 'ethereum' as const, label: 'Ethereum' },
  { id: 'base' as const, label: 'Base' },
  { id: 'arbitrum' as const, label: 'Arbitrum' },
  { id: 'optimism' as const, label: 'Optimism' },
  { id: 'polygon' as const, label: 'Polygon' },
  { id: 'solana' as const, label: 'Solana' },
  { id: 'bitcoin' as const, label: 'Bitcoin' },
];

/** Mirrors CRYPTO_ASSETS in functions/src/lib/payout.ts. USDC first where it
 *  exists, because that is what people ask to be paid in. */
const ASSETS: Record<string, readonly string[]> = {
  ethereum: ['USDC', 'USDT', 'ETH'],
  base: ['USDC', 'ETH'],
  arbitrum: ['USDC', 'USDT', 'ETH'],
  optimism: ['USDC', 'ETH'],
  polygon: ['USDC', 'USDT', 'POL'],
  solana: ['USDC', 'SOL'],
  bitcoin: ['BTC'],
};

function fmtCr(v: number): string {
  return v >= 10_000
    ? `${Math.round(v / 1000).toLocaleString('en-US')}k`
    : Math.round(v).toLocaleString('en-US');
}

function initials(name: string | null, email: string | null): string {
  const source = (name ?? email ?? '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map(p => p[0]).join('');
  return (letters || source[0] || '?').toUpperCase();
}

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [savedImage, setSavedImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [nick, setNick] = useState('');
  const [nickSaved, setNickSaved] = useState('');

  // Payment details: the provider picked and one draft object per field.
  const [provider, setProvider] = useState<PayoutMethod['provider']>('paypal');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [payDirty, setPayDirty] = useState(false);

  const [busy, setBusy] = useState<string | null>(null); // which section is saving
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  // The Manifold import, moved here from the corner menu.
  const [manifold, setManifold] = useState<null | 'ask' | { code: string; username: string }>(null);
  const [manifoldName, setManifoldName] = useState('');
  const [manifoldMsg, setManifoldMsg] = useState('');

  const image = savedImage ?? user?.image ?? null;

  useEffect(() => {
    api.getParticipant()
      .then(p => {
        const part = p as Participant;
        setParticipant(part);
        setNick(part.nickname ?? '');
        setNickSaved(part.nickname ?? '');
        if (part.payoutMethod) {
          setProvider(part.payoutMethod.provider);
          const { provider: _p, ...rest } = part.payoutMethod as unknown as Record<string, string>;
          setFields(rest);
        }
      })
      .catch(e => console.error('participant fetch failed:', e));
  }, []);

  const sectionErr = (key: string, message: string) => setErrors(e => ({ ...e, [key]: message }));
  const clearErr = (key: string) => setErrors(({ [key]: _gone, ...rest }) => rest);
  const flashSaved = (key: string) => {
    setSaved(s => ({ ...s, [key]: true }));
    setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 1200);
  };

  const pickPicture = async (file: File) => {
    clearErr('picture');
    setBusy('picture');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const SIZE = 256;
            const canvas = document.createElement('canvas');
            canvas.width = SIZE; canvas.height = SIZE;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Your browser blocked image processing')); return; }
            const side = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          } finally { URL.revokeObjectURL(url); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file does not look like an image')); };
        img.src = url;
      });
      await api.upsertProfile({ image: dataUrl });
      setSavedImage(dataUrl);
      flashSaved('picture');
    } catch (e) {
      sectionErr('picture', (e as Error).message || 'Could not save that picture');
    } finally {
      setBusy(null);
    }
  };

  const saveNick = async () => {
    clearErr('nick');
    setBusy('nick');
    try {
      await api.upsertProfile({ nickname: nick.trim() });
      setNickSaved(nick.trim());
      setParticipant(p => (p ? { ...p, nickname: nick.trim() } : p));
      flashSaved('nick');
    } catch (e) {
      sectionErr('nick', (e as Error).message || 'Could not change the username');
    } finally {
      setBusy(null);
    }
  };

  const savePayment = async () => {
    clearErr('pay');
    setBusy('pay');
    try {
      const method = { provider, ...fields } as unknown as PayoutMethod;
      await api.upsertProfile({ payoutMethod: method });
      setParticipant(p => (p ? { ...p, payoutMethod: method } : p));
      setPayDirty(false);
      flashSaved('pay');
    } catch (e) {
      sectionErr('pay', (e as Error).message || 'Could not save payment details');
    } finally {
      setBusy(null);
    }
  };

  const manifoldStart = async () => {
    setBusy('manifold'); clearErr('manifold'); setManifoldMsg('');
    try {
      const r = await fetch('/api/import/manifold/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: manifoldName }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not start');
      setManifold({ code: d.code, username: d.username });
    } catch (e) {
      sectionErr('manifold', (e as Error).message);
    } finally { setBusy(null); }
  };

  const manifoldClaim = async () => {
    setBusy('manifold'); clearErr('manifold'); setManifoldMsg('');
    try {
      const r = await fetch('/api/import/manifold/claim', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not verify');
      setManifoldMsg(`Imported @${d.username}: +${d.granted.toLocaleString('en-US')} cr`);
      setManifold(null);
      api.getParticipant().then(p => setParticipant(p as Participant)).catch(() => {});
    } catch (e) {
      sectionErr('manifold', (e as Error).message);
    } finally { setBusy(null); }
  };

  const setField = (k: string, v: string) => { setFields(f => ({ ...f, [k]: v })); setPayDirty(true); };
  const switchProvider = (p: PayoutMethod['provider']) => {
    setProvider(p);
    // Re-hydrate the stored fields when returning to the saved provider;
    // start clean otherwise.
    if (participant?.payoutMethod?.provider === p) {
      const { provider: _p, ...rest } = participant.payoutMethod as unknown as Record<string, string>;
      setFields(rest);
      setPayDirty(false);
    } else {
      setFields(p === 'crypto' ? { network: 'base', asset: 'USDC' } : {});
      setPayDirty(true);
    }
    clearErr('pay');
  };

  const line = (key: string, label: string, placeholder: string, ariaLabel?: string) => (
    <input
      className="jobform-line"
      value={fields[key] ?? ''}
      onChange={e => setField(key, e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel ?? label}
    />
  );

  return (
    <FloorModal onClose={onClose} label="Account">
      <div className="acctdlg">
        <div className="ticket-head acctdlg-head">
          <button
            className="acctdlg-avatar"
            aria-label={image ? 'Change picture' : 'Set a picture'}
            disabled={busy === 'picture'}
            onClick={() => fileRef.current?.click()}
          >
            {image ? <img src={image} alt="" /> : <span>{initials(user?.name ?? null, user?.email ?? null)}</span>}
            <span className="acctdlg-avatar-hint">{busy === 'picture' ? '…' : 'edit'}</span>
          </button>
          <div className="acctdlg-who">
            <span className="acctdlg-name">{participant?.nickname || user?.name || user?.email || 'Account'}</span>
            {user?.email && <span className="acctdlg-email">{user.email}</span>}
            <span className="acctdlg-stats">
              {participant?.balance != null ? `${fmtCr(participant.balance)} cr to trade` : ''}
              {participant?.earnedBetting != null ? ` · ${participant.earnedBetting > 0 ? '+' : ''}${fmtCr(participant.earnedBetting)} cr earned` : ''}
            </span>
          </div>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void pickPicture(f); e.target.value = ''; }}
        />
        {errors.picture && <p className="ticket-err">{errors.picture}</p>}

        <label className="jobform-field">
          <span className="ticket-label">Username</span>
          <input
            className="jobform-line"
            value={nick}
            onChange={e => setNick(e.target.value)}
            placeholder="your-username"
            maxLength={30}
            aria-label="Username"
          />
        </label>
        {nick.trim() !== nickSaved && nick.trim() !== '' && (
          <button className="ticket-go acctdlg-save" disabled={busy === 'nick'} onClick={() => void saveNick()}>
            {busy === 'nick' ? 'Saving…' : saved.nick ? 'Saved' : 'Save username'}
          </button>
        )}
        {errors.nick && <p className="ticket-err">{errors.nick}</p>}

        {/* Payment details: pick a provider, fill its own fields. What is
            stored is a typed method the owner can pay against; the fields
            are validated server-side per provider (IBAN checksum, address
            shapes) and errors land right here. */}
        <div className="jobform-field">
          <span className="ticket-label">Paid through</span>
          <div className="acctdlg-pills" role="tablist" aria-label="Payment provider">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                role="tab"
                aria-selected={provider === p.id}
                className={`acctdlg-pill${provider === p.id ? ' is-active' : ''}`}
                onClick={() => switchProvider(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {provider === 'paypal' && (
          <label className="jobform-field"><span className="ticket-label">PayPal email</span>{line('email', 'PayPal email', 'you@example.com')}</label>
        )}
        {provider === 'bank' && (
          <>
            <label className="jobform-field"><span className="ticket-label">IBAN</span>{line('iban', 'IBAN', 'CZ65 0800 0000 1920 0014 5399')}</label>
            <label className="jobform-field"><span className="ticket-label">Account holder</span>{line('holder', 'Account holder', 'Name as the bank knows it')}</label>
          </>
        )}
        {provider === 'crypto' && (
          <>
            <div className="jobform-field">
              <span className="ticket-label">Network</span>
              <div className="acctdlg-pills">
                {NETWORKS.map(n => (
                  <button
                    key={n.id}
                    className={`acctdlg-pill${(fields.network ?? 'ethereum') === n.id ? ' is-active' : ''}`}
                    onClick={() => {
                      setField('network', n.id);
                      // Assets differ per chain, so a stale pick from the
                      // previous chain must not survive the switch.
                      const first = ASSETS[n.id]?.[0];
                      if (first && !ASSETS[n.id].includes(fields.asset ?? '')) setField('asset', first);
                    }}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="jobform-field">
              <span className="ticket-label">Paid in</span>
              <div className="acctdlg-pills">
                {(ASSETS[fields.network ?? 'base'] ?? ['USDC']).map(a => (
                  <button
                    key={a}
                    className={`acctdlg-pill${(fields.asset ?? '') === a ? ' is-active' : ''}`}
                    onClick={() => setField('asset', a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <label className="jobform-field"><span className="ticket-label">Address</span>{line('address', 'Address', (fields.network ?? 'base') === 'solana' ? 'Solana address' : (fields.network ?? 'base') === 'bitcoin' ? 'bc1…' : '0x…')}</label>
          </>
        )}
        {provider === 'revolut' && (
          <label className="jobform-field"><span className="ticket-label">Revtag or phone</span>{line('handle', 'Revtag or phone', '@yourtag')}</label>
        )}
        {provider === 'wise' && (
          <label className="jobform-field"><span className="ticket-label">Wise email</span>{line('email', 'Wise email', 'you@example.com')}</label>
        )}
        {provider === 'other' && (
          <label className="jobform-field"><span className="ticket-label">How to pay you</span>{line('details', 'How to pay you', 'Say exactly how the money reaches you')}</label>
        )}

        <label className="jobform-field">
          <span className="ticket-label">Note (optional)</span>
          {line('note', 'Note', 'Reference, exchange memo or tag, anything I need to know when sending')}
        </label>

        {(payDirty || saved.pay) && (
          <button className={`ticket-go acctdlg-save${saved.pay ? ' is-placed' : ''}`} disabled={busy === 'pay'} onClick={() => void savePayment()}>
            {busy === 'pay' ? 'Saving…' : saved.pay ? 'Saved' : 'Save payment details'}
          </button>
        )}
        {errors.pay && <p className="ticket-err">{errors.pay}</p>}

        {/* Bring a Manifold record: proven calibration converts once. */}
        <div className="jobform-field">
          <span className="ticket-label">Manifold</span>
          {manifold === null && !manifoldMsg && (
            <button className="acctdlg-ghost" onClick={() => { setManifold('ask'); clearErr('manifold'); }}>
              Import Manifold balance
            </button>
          )}
          {manifold === 'ask' && (
            <div className="acctdlg-inline">
              <input
                className="jobform-line"
                value={manifoldName}
                onChange={e => setManifoldName(e.target.value)}
                placeholder="your Manifold username"
                aria-label="Manifold username"
              />
              <button className="acctdlg-ghost" disabled={busy === 'manifold' || !manifoldName.trim()} onClick={() => void manifoldStart()}>
                {busy === 'manifold' ? 'Checking…' : 'Next'}
              </button>
            </div>
          )}
          {manifold !== null && manifold !== 'ask' && (
            <div className="acctdlg-inline acctdlg-inline--col">
              <p className="acctdlg-hint">
                Add <code>{manifold.code}</code> to @{manifold.username}&rsquo;s bio on
                manifold.markets, then verify. You can remove it right after.
              </p>
              <button className="acctdlg-ghost" disabled={busy === 'manifold'} onClick={() => void manifoldClaim()}>
                {busy === 'manifold' ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          )}
          {manifoldMsg && <p className="acctdlg-ok">{manifoldMsg}</p>}
        </div>
        {errors.manifold && <p className="ticket-err">{errors.manifold}</p>}
      </div>
    </FloorModal>
  );
}
