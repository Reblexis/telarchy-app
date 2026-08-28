import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { agentPrompt, type FloorRef } from '../lib/agent-prompt';
import {
  api,
  type NotificationChannel,
  type NotificationKindId,
  type NotificationMatrix,
  type NotificationPrefs,
  type PayoutMethod,
} from '../lib/api';
import { AccountCredits } from './AccountCredits';
import { AccountPassword } from './AccountPassword';
import { FloorModal } from './FloorModal';
import { LiquidityWallet } from './LiquidityWallet';
import { SeasonEntryPanel } from './SeasonEntryPanel';

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
  bio: string | null;
  walletAddress?: string;
  spentBetting: number | null;
  balance: number | null;
  /** The second currency: bought liquidity credits, spendable only as
   *  market-pool injections (owner decision 2026-08-28). */
  liquidityBalance?: number | null;
  earnedBetting: number | null;
  payoutHandle: string | null;
  payoutMethod: PayoutMethod | null;
  notifications: NotificationPrefs | null;
}

/**
 * The notification matrix's rows, in the order a trader meets them: the
 * answers addressed to you first, the firehoses last. Labels say what LANDS,
 * not what the column is called (docs/vision.md, "Participant notifications").
 * Each row is one kind, deliverable over three channels: Web is the bell,
 * Email is mail, Mobile is a browser push (owner ask 2026-08-24).
 */
const NOTIFICATION_ROWS: Array<{ kind: NotificationKindId; label: string }> = [
  { kind: 'comment', label: 'Someone comments on my contract' },
  { kind: 'reply', label: 'Someone replies in a thread I am in' },
  { kind: 'settled', label: 'A market I traded settles' },
  { kind: 'decision', label: 'A contract I traded or commented on is decided' },
  { kind: 'contract', label: 'A new contract goes on the ballot' },
  { kind: 'anyComment', label: 'Any comment, under any contract or market' },
];
const CHANNEL_LABELS: Array<{ channel: NotificationChannel; label: string }> = [
  { channel: 'web', label: 'Web' },
  { channel: 'email', label: 'Email' },
  { channel: 'mobile', label: 'Mobile' },
];

/** The browser's base64url VAPID key as the byte array subscribe() wants. */
function vapidKeyBytes(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * The account is filed, not stacked (owner report 2026-08-19: the dialog
 * scrolled and nobody could tell). Four named sections, one on screen at a
 * time, in the order a trader needs them: who you are, where the money goes,
 * what reaches your inbox, and the password. The rail doubles as the table of
 * contents the long form never had, so a setting is now something you can see
 * exists rather than something you have to scroll into.
 */
type AccountTab = 'profile' | 'money' | 'emails' | 'ai' | 'security';

const TABS: Array<{ id: AccountTab; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'money', label: 'Money' },
  { id: 'emails', label: 'Notifications' },
  { id: 'ai', label: 'Your AI' },
  { id: 'security', label: 'Security' },
];

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
export const NETWORKS = [
  { id: 'ethereum' as const, label: 'Ethereum' },
  { id: 'base' as const, label: 'Base' },
  { id: 'arbitrum' as const, label: 'Arbitrum' },
  { id: 'optimism' as const, label: 'Optimism' },
  { id: 'polygon' as const, label: 'Polygon' },
  { id: 'solana' as const, label: 'Solana' },
  { id: 'bitcoin' as const, label: 'Bitcoin' },
];

/** The chain assumed when a stored method does not name one. Every fallback
 *  in this component reads it, so the pills, the asset list and the address
 *  placeholder cannot disagree (they did: the pill highlighted Ethereum while
 *  the asset list offered Base's, and an Ethereum-shaped save then failed
 *  validation). */
const DEFAULT_NETWORK = 'base' as const;

/** Mirrors CRYPTO_ASSETS in functions/src/lib/payout.ts. USDC first where it
 *  exists, because that is what people ask to be paid in. */
export const ASSETS: Record<string, readonly string[]> = {
  ethereum: ['USDC', 'USDT', 'ETH'],
  base: ['USDC', 'ETH'],
  arbitrum: ['USDC', 'USDT', 'ETH'],
  optimism: ['USDC', 'ETH'],
  polygon: ['USDC', 'USDT', 'POL'],
  solana: ['USDC', 'SOL'],
  bitcoin: ['BTC'],
};

/**
 * The stored method as editable fields, with the chain and asset filled in
 * when they are missing. Crypto methods saved before assets existed carry
 * only { network, address }; without this backfill no "Paid in" pill reads
 * active and the next save 400s with "Pick what to be paid in", an error
 * about a field the user never touched.
 */
function storedFields(method: PayoutMethod): Record<string, string> {
  const { provider, ...rest } = method as unknown as Record<string, string>;
  void provider;
  if (method.provider !== 'crypto') return rest;
  const network = rest.network || DEFAULT_NETWORK;
  const assets = ASSETS[network] ?? ASSETS[DEFAULT_NETWORK];
  return {
    ...rest,
    network,
    asset: assets.includes(rest.asset) ? rest.asset : assets[0],
  };
}

/* The framing step's geometry. FRAME is the on-screen circle; OUT_SIZE the
   square that gets stored. zoom=1 puts the picture's short side exactly
   across the frame (a cover fit), so every zoom keeps the frame covered as
   long as the offset stays within the overhang, which clampCrop enforces. */
const FRAME = 220;
const OUT_SIZE = 256;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

type Crop = {
  url: string;
  img: HTMLImageElement;
  w: number;
  h: number;
  zoom: number;
  /** Picture centre minus frame centre, in frame pixels. */
  x: number;
  y: number;
};

/** Scale from picture pixels to frame pixels at this zoom. */
function cropScale(c: Pick<Crop, 'w' | 'h' | 'zoom'>): number {
  return (FRAME / Math.min(c.w, c.h)) * c.zoom;
}

export function clampCrop(c: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, c.zoom));
  const s = cropScale({ ...c, zoom });
  const maxX = (c.w * s - FRAME) / 2;
  const maxY = (c.h * s - FRAME) / 2;
  return {
    ...c,
    zoom,
    x: Math.min(maxX, Math.max(-maxX, c.x)),
    y: Math.min(maxY, Math.max(-maxY, c.y)),
  };
}

/** The picture-pixel square the frame shows: what drawImage reads. */
export function sourceRect(c: Crop): { sx: number; sy: number; side: number } {
  const s = cropScale(c);
  return {
    sx: ((c.w * s) / 2 - FRAME / 2 - c.x) / s,
    sy: ((c.h * s) / 2 - FRAME / 2 - c.y) / s,
    side: FRAME / s,
  };
}

/** The picture on the stage: anchored at the stage centre (left/top 50%),
    shifted so its own centre lands at the offset. */
function imgStyle(c: Crop): CSSProperties {
  const s = cropScale(c);
  return {
    width: c.w * s,
    height: c.h * s,
    transform: `translate(${-(c.w * s) / 2 + c.x}px, ${-(c.h * s) / 2 + c.y}px)`,
  };
}

function fmtCr(v: number): string {
  return v >= 10_000 ? `${Math.round(v / 1000).toLocaleString('en-US')}k` : Math.round(v).toLocaleString('en-US');
}

function initials(name: string | null, email: string | null): string {
  const source = (name ?? email ?? '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map(p => p[0])
    .join('');
  return (letters || source[0] || '?').toUpperCase();
}

export function AccountDialog({
  onClose,
  initialTab = 'profile',
  floor = null,
}: {
  onClose: () => void;
  /** Which section to open on. Notification emails link straight to 'emails'. */
  initialTab?: AccountTab;
  /** The floor this was opened from, so "Your AI" hands out a prompt for the
   *  page the person is standing on rather than a generic one. */
  floor?: FloorRef | null;
}) {
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const { user } = useAuth();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [savedImage, setSavedImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // The framing step (owner ask 2026-08-25): a picked file is not saved
  // until it has been framed. `zoom` is 1 when the short side fills the
  // frame; `x`/`y` are the picture centre's offset from the frame centre in
  // frame pixels, clamped so the frame is never uncovered.
  const [crop, setCrop] = useState<Crop | null>(null);
  const dragRef = useRef<{
    px: number;
    py: number;
    x: number;
    y: number;
  } | null>(null);

  const [nick, setNick] = useState('');
  const [nickSaved, setNickSaved] = useState('');

  // The public one-liner on the participant profile. It came off the deleted
  // console account page (owner decision 2026-08-19); the profile it feeds is
  // public, so the place to write it has to be public too.
  const [bio, setBio] = useState('');
  const [bioSaved, setBioSaved] = useState('');

  // Payment details: the provider picked and one draft object per field.
  const [provider, setProvider] = useState<PayoutMethod['provider']>('paypal');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [payDirty, setPayDirty] = useState(false);

  // The notification matrix. Each cell saves on the click (no separate
  // confirm): a switch that needs a Save button reads as a form, and the
  // state shown is the state stored, rolled back if the server refuses.
  // Null until GET /api/auth/me answers with the resolved matrix.
  const [matrix, setMatrix] = useState<NotificationMatrix | null>(null);

  const [promptCopied, setPromptCopied] = useState(false);

  const [busy, setBusy] = useState<string | null>(null); // which section is saving
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  // The Manifold import, moved here from the corner menu.
  const [manifold, setManifold] = useState<null | 'ask' | { code: string; username: string }>(null);
  const [manifoldName, setManifoldName] = useState('');
  const [manifoldMsg, setManifoldMsg] = useState('');

  const image = savedImage ?? user?.image ?? null;

  /** One participant fetch for the whole dialog. The credits section reads
      the same row rather than fetching its own: two reads of one fact is how
      the balance under the deposit box ends up disagreeing with the balance
      in the header. */
  const loadParticipant = useCallback(() => {
    api
      .getParticipant()
      .then(p => {
        const part = p as Participant;
        setParticipant(part);
        setNick(part.nickname ?? '');
        setNickSaved(part.nickname ?? '');
        setBio(part.bio ?? '');
        setBioSaved(part.bio ?? '');

        if (part.payoutMethod) {
          setProvider(part.payoutMethod.provider);
          setFields(storedFields(part.payoutMethod));
        }
      })
      .catch(e => console.error('participant fetch failed:', e));
    api
      .getProfile()
      .then(p => {
        const m = (p as { notificationChannels?: NotificationMatrix }).notificationChannels;
        if (m) setMatrix(m);
      })
      .catch(e => console.error('notification matrix fetch failed:', e));
  }, []);

  useEffect(loadParticipant, [loadParticipant]);

  const sectionErr = (key: string, message: string) => setErrors(e => ({ ...e, [key]: message }));
  const clearErr = (key: string) => setErrors(({ [key]: _gone, ...rest }) => rest);
  const flashSaved = (key: string) => {
    setSaved(s => ({ ...s, [key]: true }));
    setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 1200);
  };

  const pickPicture = (file: File) => {
    clearErr('picture');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (!img.width || !img.height) {
        URL.revokeObjectURL(url);
        sectionErr('picture', 'That file does not look like an image');
        return;
      }
      setCrop(c => {
        if (c) URL.revokeObjectURL(c.url);
        return { url, img, w: img.width, h: img.height, zoom: 1, x: 0, y: 0 };
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      sectionErr('picture', 'That file does not look like an image');
    };
    img.src = url;
  };

  const cancelCrop = () => {
    setCrop(c => {
      if (c) URL.revokeObjectURL(c.url);
      return null;
    });
  };

  const moveCrop = (dx: number, dy: number) => setCrop(c => (c ? clampCrop({ ...c, x: c.x + dx, y: c.y + dy }) : c));

  const zoomCrop = (zoom: number) => setCrop(c => (c ? clampCrop({ ...c, zoom }) : c));

  const saveCrop = async () => {
    if (!crop) return;
    clearErr('picture');
    setBusy('picture');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUT_SIZE;
      canvas.height = OUT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Your browser blocked image processing');
      const { sx, sy, side } = sourceRect(crop);
      ctx.drawImage(crop.img, sx, sy, side, side, 0, 0, OUT_SIZE, OUT_SIZE);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      await api.upsertProfile({ image: dataUrl });
      setSavedImage(dataUrl);
      cancelCrop();
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

  const saveBio = async () => {
    clearErr('bio');
    setBusy('bio');
    try {
      await api.upsertProfile({ bio: bio.trim() });
      setBioSaved(bio.trim());
      setParticipant(p => (p ? { ...p, bio: bio.trim() } : p));
      flashSaved('bio');
    } catch (e) {
      sectionErr('bio', (e as Error).message || 'Could not save the bio');
    } finally {
      setBusy(null);
    }
  };

  const savePayment = async () => {
    clearErr('pay');
    setBusy('pay');
    try {
      // No `as unknown` laundering: PayoutMethod in lib/api.ts mirrors the
      // server contract, so a payload that does not fit is a bug in one of
      // the two, which is exactly what this cast used to hide.
      const method = { provider, ...fields } as PayoutMethod;
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

  /** Make this browser one of my mobile addresses: register the service
   *  worker, ask permission, subscribe, and file the subscription. Ran the
   *  first time any Mobile cell goes on; browsers keep the registration. */
  const ensurePushSubscribed = async () => {
    const { configured, publicKey } = await api.getPushKey();
    if (!configured || !publicKey) throw new Error('Push notifications are not set up on this server yet');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error('This browser does not support push notifications');
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('The browser blocked notifications; allow them in site settings');
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(publicKey) as BufferSource,
      }));
    await api.registerPushSubscription(sub.toJSON());
  };

  const toggleCell = async (kind: NotificationKindId, channel: NotificationChannel) => {
    if (!matrix) return;
    const value = !matrix[kind][channel];
    const previous = matrix;
    clearErr('emails');
    setMatrix({ ...matrix, [kind]: { ...matrix[kind], [channel]: value } });
    setBusy(`cell:${kind}:${channel}`);
    try {
      if (channel === 'mobile' && value) await ensurePushSubscribed();
      await api.upsertProfile({
        notificationChannels: { [kind]: { [channel]: value } },
      });
    } catch (e) {
      setMatrix(previous);
      sectionErr('emails', (e as Error).message || 'Could not change that setting');
    } finally {
      setBusy(null);
    }
  };

  const manifoldStart = async () => {
    setBusy('manifold');
    clearErr('manifold');
    setManifoldMsg('');
    try {
      const d = await api.startManifoldImport(manifoldName);
      setManifold({ code: d.code, username: d.username });
    } catch (e) {
      sectionErr('manifold', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const manifoldClaim = async () => {
    setBusy('manifold');
    clearErr('manifold');
    setManifoldMsg('');
    try {
      const d = await api.claimManifoldImport();
      setManifoldMsg(`Imported @${d.username}: +${d.granted.toLocaleString('en-US')} cr`);
      setManifold(null);
      api
        .getParticipant()
        .then(p => setParticipant(p as Participant))
        .catch(() => {});
    } catch (e) {
      sectionErr('manifold', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setField = (k: string, v: string) => {
    setFields(f => ({ ...f, [k]: v }));
    setPayDirty(true);
  };
  const switchProvider = (p: PayoutMethod['provider']) => {
    setProvider(p);
    // Re-hydrate the stored fields when returning to the saved provider;
    // start clean otherwise.
    if (participant?.payoutMethod?.provider === p) {
      setFields(storedFields(participant.payoutMethod));
      setPayDirty(false);
    } else {
      setFields(p === 'crypto' ? { network: DEFAULT_NETWORK, asset: ASSETS[DEFAULT_NETWORK][0] } : {});
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
        {!crop && (
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
                {participant?.liquidityBalance ? ` · ${fmtCr(participant.liquidityBalance)} liquidity cr` : ''}
                {participant?.earnedBetting != null
                  ? ` · ${participant.earnedBetting > 0 ? '+' : ''}${fmtCr(participant.earnedBetting)} cr earned`
                  : ''}
              </span>
            </div>
            <button className="ticket-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) void pickPicture(f);
            e.target.value = '';
          }}
        />
        {errors.picture && <p className="ticket-err">{errors.picture}</p>}

        {crop && (
          <div className="acctdlg-crop">
            <div className="ticket-head acctdlg-head">
              <span className="acctdlg-name">Frame your picture</span>
              <button className="ticket-close" aria-label="Close" onClick={onClose}>
                ×
              </button>
            </div>
            <div
              className="acctdlg-crop-stage"
              role="group"
              aria-label="Drag to move the picture; arrow keys nudge it"
              tabIndex={0}
              onPointerDown={e => {
                dragRef.current = {
                  px: e.clientX,
                  py: e.clientY,
                  x: crop.x,
                  y: crop.y,
                };
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={e => {
                const d = dragRef.current;
                if (!d) return;
                setCrop(c =>
                  c
                    ? clampCrop({
                        ...c,
                        x: d.x + (e.clientX - d.px),
                        y: d.y + (e.clientY - d.py),
                      })
                    : c,
                );
              }}
              onPointerUp={() => {
                dragRef.current = null;
              }}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
              onKeyDown={e => {
                const step = e.shiftKey ? 20 : 4;
                if (e.key === 'ArrowLeft') moveCrop(-step, 0);
                else if (e.key === 'ArrowRight') moveCrop(step, 0);
                else if (e.key === 'ArrowUp') moveCrop(0, -step);
                else if (e.key === 'ArrowDown') moveCrop(0, step);
                else return;
                e.preventDefault();
              }}
            >
              <img src={crop.url} alt="" draggable={false} style={imgStyle(crop)} />
              <div className="acctdlg-crop-mask" aria-hidden="true" style={{ width: FRAME, height: FRAME }} />
            </div>
            <div className="acctdlg-crop-zoom">
              <button
                type="button"
                className="acctdlg-crop-step"
                aria-label="Zoom out"
                disabled={crop.zoom <= 1}
                onClick={() => zoomCrop(crop.zoom - ZOOM_STEP)}
              >
                −
              </button>
              <input
                type="range"
                className="ticket-slider"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={crop.zoom}
                style={{
                  ['--slider-pct' as string]: `${((crop.zoom - 1) / (MAX_ZOOM - 1)) * 100}%`,
                }}
                onChange={e => zoomCrop(parseFloat(e.target.value))}
                aria-label="Zoom"
              />
              <button
                type="button"
                className="acctdlg-crop-step"
                aria-label="Zoom in"
                disabled={crop.zoom >= MAX_ZOOM}
                onClick={() => zoomCrop(crop.zoom + ZOOM_STEP)}
              >
                +
              </button>
            </div>
            <p className="acctdlg-hint">Drag to place it. The circle is what everyone sees.</p>
            <div className="acctdlg-crop-actions">
              <button className="acctdlg-ghost" disabled={busy === 'picture'} onClick={cancelCrop}>
                Cancel
              </button>
              <button className="ticket-go acctdlg-save" disabled={busy === 'picture'} onClick={() => void saveCrop()}>
                {busy === 'picture' ? 'Saving…' : 'Use this picture'}
              </button>
            </div>
          </div>
        )}

        {!crop && (
          <>
            <div className="acctdlg-tabs" role="tablist" aria-label="Account sections">
              {TABS.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`acctdlg-tab${tab === t.id ? ' is-active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div
              className="acctdlg-panel"
              role="tabpanel"
              aria-label={TABS.find(t => t.id === tab)?.label ?? 'Account'}
            >
              {tab === 'profile' && (
                <>
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
                    <button
                      className="ticket-go acctdlg-save"
                      disabled={busy === 'nick'}
                      onClick={() => void saveNick()}
                    >
                      {busy === 'nick' ? 'Saving…' : saved.nick ? 'Saved' : 'Save username'}
                    </button>
                  )}
                  {errors.nick && <p className="ticket-err">{errors.nick}</p>}

                  <label className="jobform-field">
                    <span className="ticket-label">Bio</span>
                    <textarea
                      className="jobform-line acctdlg-bio"
                      value={bio}
                      onChange={e => setBio(e.target.value)}
                      placeholder="Who are you, and what are you here to do? Shown on your public profile."
                      maxLength={500}
                      rows={2}
                      aria-label="Bio"
                    />
                  </label>
                  {bio.trim() !== bioSaved && (
                    <button className="ticket-go acctdlg-save" disabled={busy === 'bio'} onClick={() => void saveBio()}>
                      {busy === 'bio' ? 'Saving…' : saved.bio ? 'Saved' : 'Save bio'}
                    </button>
                  )}
                  {errors.bio && <p className="ticket-err">{errors.bio}</p>}

                  {/* Bring a Manifold record: proven calibration converts once. */}
                  <div className="jobform-field">
                    <span className="ticket-label">Manifold</span>
                    {manifold === null && !manifoldMsg && (
                      <button
                        className="acctdlg-ghost"
                        onClick={() => {
                          setManifold('ask');
                          clearErr('manifold');
                        }}
                      >
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
                        <button
                          className="acctdlg-ghost"
                          disabled={busy === 'manifold' || !manifoldName.trim()}
                          onClick={() => void manifoldStart()}
                        >
                          {busy === 'manifold' ? 'Checking…' : 'Next'}
                        </button>
                      </div>
                    )}
                    {manifold !== null && manifold !== 'ask' && (
                      <div className="acctdlg-inline acctdlg-inline--col">
                        <p className="acctdlg-hint">
                          Add <code>{manifold.code}</code> to @{manifold.username}&rsquo;s bio on manifold.markets, then
                          verify. You can remove it right after.
                        </p>
                        <button
                          className="acctdlg-ghost"
                          disabled={busy === 'manifold'}
                          onClick={() => void manifoldClaim()}
                        >
                          {busy === 'manifold' ? 'Verifying…' : 'Verify'}
                        </button>
                      </div>
                    )}
                    {manifoldMsg && <p className="acctdlg-ok">{manifoldMsg}</p>}
                  </div>
                  {errors.manifold && <p className="ticket-err">{errors.manifold}</p>}
                </>
              )}

              {tab === 'money' && (
                <>
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
                    <label className="jobform-field">
                      <span className="ticket-label">PayPal email</span>
                      {line('email', 'PayPal email', 'you@example.com')}
                    </label>
                  )}
                  {provider === 'bank' && (
                    <>
                      <label className="jobform-field">
                        <span className="ticket-label">IBAN</span>
                        {line('iban', 'IBAN', 'CZ65 0800 0000 1920 0014 5399')}
                      </label>
                      <label className="jobform-field">
                        <span className="ticket-label">Account holder</span>
                        {line('holder', 'Account holder', 'Name as the bank knows it')}
                      </label>
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
                              className={`acctdlg-pill${(fields.network ?? DEFAULT_NETWORK) === n.id ? ' is-active' : ''}`}
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
                          {(ASSETS[fields.network ?? DEFAULT_NETWORK] ?? ASSETS[DEFAULT_NETWORK]).map(a => (
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
                      <label className="jobform-field">
                        <span className="ticket-label">Address</span>
                        {line(
                          'address',
                          'Address',
                          (fields.network ?? DEFAULT_NETWORK) === 'solana'
                            ? 'Solana address'
                            : (fields.network ?? DEFAULT_NETWORK) === 'bitcoin'
                              ? 'bc1…'
                              : '0x…',
                        )}
                      </label>
                    </>
                  )}
                  {provider === 'revolut' && (
                    <label className="jobform-field">
                      <span className="ticket-label">Revtag or phone</span>
                      {line('handle', 'Revtag or phone', '@yourtag')}
                    </label>
                  )}
                  {provider === 'wise' && (
                    <label className="jobform-field">
                      <span className="ticket-label">Wise email</span>
                      {line('email', 'Wise email', 'you@example.com')}
                    </label>
                  )}
                  {provider === 'other' && (
                    <label className="jobform-field">
                      <span className="ticket-label">How to pay you</span>
                      {line('details', 'How to pay you', 'Say exactly how the money reaches you')}
                    </label>
                  )}

                  <label className="jobform-field">
                    <span className="ticket-label">Note (optional)</span>
                    {line('note', 'Note', 'Reference, exchange memo or tag, anything I need to know when sending')}
                  </label>

                  {(payDirty || saved.pay) && (
                    <button
                      className={`ticket-go acctdlg-save${saved.pay ? ' is-placed' : ''}`}
                      disabled={busy === 'pay'}
                      onClick={() => void savePayment()}
                    >
                      {busy === 'pay' ? 'Saving…' : saved.pay ? 'Saved' : 'Save payment details'}
                    </button>
                  )}
                  {errors.pay && <p className="ticket-err">{errors.pay}</p>}

                  <LiquidityWallet
                    balance={participant?.liquidityBalance ?? 0}
                    workspaceIdOrSlug={floor?.idOrSlug ?? null}
                    floorName={floor?.name ?? null}
                  />
                  <AccountCredits me={participant} onChanged={loadParticipant} />
                  <SeasonEntryPanel />
                </>
              )}

              {tab === 'emails' && (
                <>
                  {/* The matrix: each kind of news, over three channels. Web is the
              bell, Email is mail, Mobile is a browser push. Answers addressed
              to you are on for a new account, the firehoses off (docs/
              vision.md, "Participant notifications"). Each cell saves on the
              click; there is no confirm to forget to press. */}
                  <div className="jobform-field">
                    <span className="ticket-label">Notifications</span>
                    <div className="acctdlg-switches">
                      {matrix === null ? (
                        <p className="acctdlg-hint">Loading your settings…</p>
                      ) : (
                        NOTIFICATION_ROWS.map(row => (
                          <div key={row.kind} className="acctdlg-matrix-row">
                            <span className="acctdlg-matrix-label">{row.label}</span>
                            <span className="acctdlg-matrix-cells">
                              {CHANNEL_LABELS.map(({ channel, label }) => (
                                <button
                                  key={channel}
                                  type="button"
                                  role="switch"
                                  aria-checked={matrix[row.kind][channel]}
                                  aria-label={`${row.label}: ${label}`}
                                  className={`acctdlg-switch acctdlg-switch--cell${matrix[row.kind][channel] ? ' is-on' : ''}`}
                                  disabled={busy === `cell:${row.kind}:${channel}`}
                                  onClick={() => void toggleCell(row.kind, channel)}
                                >
                                  <span className="acctdlg-switch-box" aria-hidden="true">
                                    {matrix[row.kind][channel] ? '✓' : ''}
                                  </span>
                                  <span className="acctdlg-switch-label">{label}</span>
                                </button>
                              ))}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                    <p className="acctdlg-hint">
                      Email goes to {user?.email ?? 'your account email'}; every one says how to turn it off. Mobile is
                      a push notification from this browser: switching one on asks the browser's permission, and works
                      on a phone when Telarchy is installed from the browser menu.
                    </p>
                  </div>
                  {errors.emails && <p className="ticket-err">{errors.emails}</p>}
                </>
              )}

              {tab === 'ai' && (
                <>
                  {/* Moved off the floor (owner direction 2026-08-20: the page's
                job is the market). Everything it points at is public and
                unauthenticated, and it is the SAME brief the floor's own Ask
                field reads, which is the point: your agent and ours should
                work from identical facts. */}
                  <div className="jobform-field">
                    <span className="ticket-label">Point your own AI at Telarchy</span>
                    <p className="acctdlg-hint">
                      {floor
                        ? `Paste this into Claude, ChatGPT or your own agent. It reads ${floor.name}'s public brief: the company, every number with its history, what the markets currently predict, and every contract with its priced impact.`
                        : "Paste this into Claude, ChatGPT or your own agent. It reads a floor's public brief: the company, every number with its history, what the markets currently predict, and every contract with its priced impact."}
                    </p>
                    <pre className="acctdlg-prompt">{agentPrompt(window.location.origin, floor)}</pre>
                    <button
                      type="button"
                      className="acctdlg-ghost"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(agentPrompt(window.location.origin, floor))
                          .then(() => {
                            setPromptCopied(true);
                            setTimeout(() => setPromptCopied(false), 1600);
                          })
                          .catch(e => console.error('copy failed:', e));
                      }}
                    >
                      {promptCopied ? 'Copied' : 'Copy prompt'}
                    </button>
                  </div>
                </>
              )}

              {tab === 'security' && <AccountPassword />}
            </div>
          </>
        )}
      </div>
    </FloorModal>
  );
}
