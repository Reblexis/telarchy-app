import { AppError } from '../lib/errors';
import type { EarnKey } from './earnRules';

/**
 * The forecasting-record providers a participant can link, and the one
 * shape all of them satisfy (contract: docs/record-links.md).
 *
 * WHY A REGISTRY: a record from somewhere that already scores forecasters
 * is the most valuable thing the earn table buys, because it predicts
 * whether this account can price a question, which is what the platform
 * is short of. Adding another place forecasters keep a record should
 * therefore be adding an object here plus a price row, and nothing else.
 *
 * WHAT QUALIFIES IS NEVER THE MONEY. Balance, volume and profit all move
 * between accounts on every one of these platforms, so a wealth-shaped
 * signal is exactly the one input a farmer can pool into a fresh account
 * and sell back to us (the 2026-08-30 Manifold decision, generalised).
 * Age and sustained use cannot be pooled, so they are what the gates
 * read.
 */

/** One public record, reduced to the three things the flow needs. */
export interface RecordProfile {
  /** Stable external identity. Goes into `earn_claims.ref_id`, whose
   *  unique index is what stops one external account funding two
   *  Telarchy accounts. Never the handle: handles are renamed and sold. */
  id: string;
  /** The provider's canonical spelling of the handle, for copy. */
  handle: string;
  /** The public, self-editable text the proof code is searched for. */
  proofText: string;
}

export interface RecordProvider {
  /** URL segment, and the stem of the earn key. */
  key: string;
  /** What a reader is told this is. */
  label: string;
  /** The earn table row this provider claims. */
  earnKey: EarnKey;
  /** What the participant is told to edit, in their words. */
  proofField: string;
  /** A public, unauthenticated read. Throws AppError for "no such
   *  account" and for a record that could never be proved. */
  lookup(handle: string): Promise<RecordProfile>;
  /** Whether this record is worth paying for. The refusal is shown to a
   *  person, so it says what is wrong in one actionable sentence. */
  qualifies(profile: RecordProfile, now: number): Promise<{ ok: true } | { ok: false; why: string }>;
}

/** Handles are letters, digits and a few separators on every provider
 *  here. Checked before any network call, so a typo costs nothing. */
export const HANDLE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** Shared by every provider: what an established record means here. */
const MIN_ACCOUNT_AGE_DAYS = 90;

async function getJson(url: string, what: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new AppError(`${what} is unreachable right now; try again in a minute`, 502);
  return res.json();
}

// ---------------------------------------------------------------------------
// Manifold
// ---------------------------------------------------------------------------

const MANIFOLD_API = 'https://api.manifold.markets/v0';
const RECENT_BET_DAYS = 60;

interface ManifoldUser {
  id?: string;
  username?: string;
  bio?: string;
  createdTime?: number;
  lastBetTime?: number;
  isBot?: boolean;
  creatorTraders?: number | { allTime?: number };
}

/** Kept on the profile between lookup and qualification, so the gates do
 *  not re-fetch what the lookup already read. */
const manifoldExtras = new WeakMap<RecordProfile, ManifoldUser>();

export const manifoldProvider: RecordProvider = {
  key: 'manifold',
  label: 'Manifold',
  earnKey: 'manifold_link',
  proofField: 'bio',
  async lookup(handle) {
    const res = await fetch(`${MANIFOLD_API}/user/${encodeURIComponent(handle)}`);
    if (res.status === 404) throw new AppError(`No Manifold user named "${handle}"`, 404);
    if (!res.ok) throw new AppError('Manifold is unreachable right now; try again in a minute', 502);
    const u = (await res.json()) as ManifoldUser;
    if (!u.id) throw new AppError('Manifold returned an unexpected shape', 502);
    const profile: RecordProfile = { id: u.id, handle: u.username ?? handle, proofText: u.bio ?? '' };
    manifoldExtras.set(profile, u);
    return profile;
  },
  async qualifies(profile, now) {
    const u = manifoldExtras.get(profile);
    if (!u) throw new AppError('Manifold record was not read', 500);
    if (u.isBot === true) return { ok: false, why: 'That Manifold account is flagged as a bot.' };
    const ageDays = u.createdTime ? (now - u.createdTime) / 86_400_000 : 0;
    if (ageDays < MIN_ACCOUNT_AGE_DAYS) {
      return {
        ok: false,
        why: `That Manifold account is ${Math.floor(ageDays)} days old; the import needs ${MIN_ACCOUNT_AGE_DAYS}.`,
      };
    }
    const ct = u.creatorTraders;
    const creatorTraders = typeof ct === 'number' ? ct : (ct?.allTime ?? 0);
    const betDays = u.lastBetTime ? (now - u.lastBetTime) / 86_400_000 : Number.POSITIVE_INFINITY;
    if (betDays > RECENT_BET_DAYS && creatorTraders <= 0) {
      return {
        ok: false,
        why: `That Manifold account has not traded in ${RECENT_BET_DAYS} days and has no markets others traded.`,
      };
    }
    return { ok: true };
  },
};

// ---------------------------------------------------------------------------
// Polymarket
// ---------------------------------------------------------------------------

const POLYMARKET_GAMMA = 'https://gamma-api.polymarket.com';
const POLYMARKET_DATA = 'https://data-api.polymarket.com';
/** Enough trades that the account was used rather than merely opened. */
const MIN_MARKETS_TRADED = 10;

/** The wallet, carried from lookup to the gates. */
const polymarketWallet = new WeakMap<RecordProfile, { wallet: string; createdAt: string }>();

export const polymarketProvider: RecordProvider = {
  key: 'polymarket',
  label: 'Polymarket',
  earnKey: 'polymarket_link',
  proofField: 'bio',
  async lookup(handle) {
    const search = (await getJson(
      `${POLYMARKET_GAMMA}/public-search?q=${encodeURIComponent(handle)}&search_profiles=true`,
      'Polymarket',
    )) as { profiles?: Array<{ name?: string; proxyWallet?: string; displayUsernamePublic?: boolean }> };
    // The search is fuzzy, so only an exact handle counts: otherwise a
    // near-match would hand somebody a code for a stranger's account.
    const hit = (search.profiles ?? []).find(p => (p.name ?? '').toLowerCase() === handle.toLowerCase());
    if (!hit?.proxyWallet) throw new AppError(`No Polymarket user named "${handle}"`, 404);
    // A private profile withholds its bio from the public read, so there
    // is no way to prove ownership. Say so now rather than issuing a code
    // that could never verify.
    if (hit.displayUsernamePublic === false) {
      throw new AppError(
        `That Polymarket profile is private, so its bio cannot be read. Make the username public and try again.`,
        409,
      );
    }
    const wallet = hit.proxyWallet;
    const prof = (await getJson(
      `${POLYMARKET_GAMMA}/public-profile?address=${encodeURIComponent(wallet)}`,
      'Polymarket',
    )) as { createdAt?: string; bio?: string; name?: string; displayUsernamePublic?: boolean };
    if (prof.displayUsernamePublic === false) {
      throw new AppError(
        `That Polymarket profile is private, so its bio cannot be read. Make the username public and try again.`,
        409,
      );
    }
    const profile: RecordProfile = {
      id: wallet,
      handle: prof.name ?? hit.name ?? handle,
      proofText: prof.bio ?? '',
    };
    polymarketWallet.set(profile, { wallet, createdAt: prof.createdAt ?? '' });
    return profile;
  },
  async qualifies(profile, now) {
    const extra = polymarketWallet.get(profile);
    if (!extra) throw new AppError('Polymarket record was not read', 500);
    const created = Date.parse(extra.createdAt);
    const ageDays = Number.isFinite(created) ? (now - created) / 86_400_000 : 0;
    if (ageDays < MIN_ACCOUNT_AGE_DAYS) {
      return {
        ok: false,
        why: `That Polymarket account is ${Math.floor(ageDays)} days old; the import needs ${MIN_ACCOUNT_AGE_DAYS}.`,
      };
    }
    // Markets traded, never volume or PnL: USDC and positions move
    // between wallets, a count of distinct markets does not.
    const traded = (await getJson(
      `${POLYMARKET_DATA}/traded?user=${encodeURIComponent(extra.wallet)}`,
      'Polymarket',
    )) as { traded?: number };
    const n = typeof traded.traded === 'number' ? traded.traded : 0;
    if (n < MIN_MARKETS_TRADED) {
      return {
        ok: false,
        why: `That Polymarket account has traded ${n} markets; the import needs ${MIN_MARKETS_TRADED}.`,
      };
    }
    return { ok: true };
  },
};

const PROVIDERS: readonly RecordProvider[] = [manifoldProvider, polymarketProvider];

/** The provider for a url segment, or null when there is no such thing. */
export function recordProvider(key: string): RecordProvider | null {
  return PROVIDERS.find(p => p.key === key) ?? null;
}

export function allRecordProviders(): readonly RecordProvider[] {
  return PROVIDERS;
}
