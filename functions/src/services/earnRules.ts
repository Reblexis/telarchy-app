import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, earnClaims, earnRuleHistory, earnRules, trades } from '../db/schema';
import { AppError } from '../lib/errors';
import { AGENT_SIGNUP_CREDITS, SIGNUP_CREDITS, toUnits } from '../lib/validation';
import { applyCredits, PLATFORM_SCOPE } from './credits';

/**
 * The earn table: what each way of receiving free credits is worth
 * (owner decision 2026-08-30, "I will have a table of all the ways that
 * people can earn credits ... whenever I feel like something gives me
 * less value for a task, I will just edit it in the table").
 *
 * WHY THIS IS THE ANTI-FARMING MECHANISM, and not a settings page: a
 * grant is bankroll, bankroll becomes settled profit, settled profit
 * becomes prize money. Price a signal above what it costs to fake and it
 * funds a sybil farm; price it at the value the account genuinely brings
 * and farming becomes a purchase in the currency the platform wants.
 * Every lever lives here rather than in market mechanics on purpose:
 * changing a price changes nobody's trade, so the instrument is never
 * distorted (design record: telarchy umbrella,
 * notes/earn-table-design-2026-08-30.md).
 *
 * Editable at any time, mid-season included (owner: "season 0 is
 * esxperimental and we should nto be afraid to change rules during"),
 * which is why every write appends to `earn_rule_history`.
 */

export type EarnKey =
  | 'signup_user'
  | 'signup_email'
  | 'signup_oauth'
  | 'signup_agent'
  | 'manifold_link'
  | 'link_oauth'
  | 'daily_trade'
  | 'trade_profit'
  | 'polymarket_link';

/**
 * How a row pays. `flat` is a fixed one-time grant, `cap` an "up to" that
 * a check decides, `daily` recurs once a UTC day, and `open` has no
 * number at all (trading profit, which is the only earn with no ceiling).
 * A row that is not `flat` or `cap` counts toward no tally, because
 * "still available to you" has to mean a number somebody can finish.
 */
export type EarnKind = 'flat' | 'cap' | 'daily' | 'open';

export interface EarnRule {
  key: string;
  label: string;
  credits: number;
  /** Walled pool credits paid beside the trading ones. Zero everywhere the
   *  earn recurs: a rule that pays depth every day is a faucet, and the
   *  matched amount is what one identity can extract through its own market
   *  (notes/matched-liquidity-grants-2026-09-01.md). */
  liquidityCredits: number;
  kind: EarnKind;
  enabled: boolean;
  note: string;
  updatedAt: Date;
}

const KINDS: ReadonlySet<string> = new Set<EarnKind>(['flat', 'cap', 'daily', 'open']);
const asKind = (k: string): EarnKind => (KINDS.has(k) ? (k as EarnKind) : 'flat');

/** Rows that count toward "earned so far" and "still available". */
export const isCountable = (kind: EarnKind): boolean => kind === 'flat' || kind === 'cap';

/**
 * The env constants remain the FALLBACK, not the source of truth: a
 * database that has not been migrated, or a self-hosted instance that
 * never seeded the table, still grants exactly what it granted before.
 */
const FALLBACK: Record<EarnKey, number> = {
  signup_user: SIGNUP_CREDITS,
  signup_email: SIGNUP_CREDITS,
  signup_oauth: SIGNUP_CREDITS,
  signup_agent: AGENT_SIGNUP_CREDITS,
  manifold_link: 10_000,
  link_oauth: 0,
  daily_trade: 0,
  trade_profit: 0,
  polymarket_link: 5_000,
};

/**
 * Cached for a minute. The table is read on every signup and every
 * import, and an operator editing a price does not need it live to the
 * millisecond; a minute is short enough that a change announced and then
 * made is true by the time anyone checks.
 */
const TTL_MS = 60_000;
let cache: { at: number; rows: Map<string, EarnRule> } | null = null;

export function clearEarnRuleCache(): void {
  cache = null;
}

async function load(): Promise<Map<string, EarnRule>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = new Map<string, EarnRule>();
  try {
    for (const r of await db.select().from(earnRules)) {
      rows.set(r.key, {
        key: r.key,
        label: r.label,
        credits: r.credits,
        liquidityCredits: r.liquidityCredits ?? 0,
        kind: asKind(r.kind),
        enabled: r.enabled,
        note: r.note,
        updatedAt: new Date(r.updatedAt),
      });
    }
  } catch (e) {
    // An unmigrated database must not break signup: fall back silently to
    // the constants, which is what the code granted before this table.
    console.error('earn table read failed; falling back to constants:', e);
    return new Map();
  }
  cache = { at: Date.now(), rows };
  return rows;
}

/**
 * What this task grants right now. A disabled rule grants zero; an
 * unknown key falls back to the constant it replaced, so adding a reader
 * before its row exists cannot mint or withhold credits by surprise.
 */
export async function earnCredits(key: EarnKey): Promise<number> {
  const rows = await load();
  const rule = rows.get(key);
  if (!rule) return FALLBACK[key];
  if (!rule.enabled) return 0;
  return Math.max(0, rule.credits);
}

/**
 * What a browser signup earns, by the provider the account actually came
 * through. An email address and an aged Google account do not cost the
 * same to farm, so they are priced apart (owner decision 2026-08-30).
 * Falls back to the single `signup_user` row when a provider-specific row
 * is missing, so an instance that never ran migration 0086 keeps working.
 */
export async function signupCreditsFor(providerId: string | null): Promise<number> {
  const rows = await load();
  const key: EarnKey = providerId && providerId !== 'credential' ? 'signup_oauth' : 'signup_email';
  const rule = rows.get(key);
  if (rule) return rule.enabled ? Math.max(0, rule.credits) : 0;
  return earnCredits('signup_user');
}

/** The liquidity this task grants beside its credits, right now. */
export async function earnLiquidityCredits(key: EarnKey): Promise<number> {
  const rows = await load();
  const rule = rows.get(key);
  if (!rule || !rule.enabled) return 0;
  return Math.max(0, rule.liquidityCredits ?? 0);
}

/** The whole table, for the public page and the admin editor. */
export async function listEarnRules(): Promise<EarnRule[]> {
  const rows = await load();
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Edit one rule. Appends the new state to the history before returning,
 * so "what did the table say when this account was funded?" always has an
 * answer, which is what makes changing prices mid-season defensible
 * rather than merely allowed.
 */
export async function setEarnRule(
  key: string,
  patch: { credits?: number; liquidityCredits?: number; enabled?: boolean; note?: string; label?: string },
  changedBy: string | null,
): Promise<EarnRule> {
  const [existing] = await db.select().from(earnRules).where(eq(earnRules.key, key)).limit(1);
  if (!existing) throw new AppError(`No earn rule named ${key}`, 404);

  if (patch.credits !== undefined && (!Number.isFinite(patch.credits) || patch.credits < 0)) {
    throw new AppError('credits must be a non-negative number', 400);
  }
  if (
    patch.liquidityCredits !== undefined &&
    (!Number.isFinite(patch.liquidityCredits) || patch.liquidityCredits < 0)
  ) {
    throw new AppError('liquidityCredits must be a non-negative number', 400);
  }
  const next = {
    credits: patch.credits ?? existing.credits,
    liquidityCredits: patch.liquidityCredits ?? existing.liquidityCredits ?? 0,
    enabled: patch.enabled ?? existing.enabled,
    note: patch.note ?? existing.note,
    label: patch.label ?? existing.label,
  };

  await db.transaction(async tx => {
    await tx
      .update(earnRules)
      .set({ ...next, updatedAt: new Date(), updatedBy: changedBy })
      .where(eq(earnRules.key, key));
    await tx.insert(earnRuleHistory).values({
      id: randomUUID(),
      key,
      credits: next.credits,
      liquidityCredits: next.liquidityCredits,
      kind: existing.kind,
      enabled: next.enabled,
      note: next.note,
      changedBy,
    });
  });
  clearEarnRuleCache();
  return {
    key,
    label: next.label,
    credits: next.credits,
    liquidityCredits: next.liquidityCredits,
    kind: asKind(existing.kind),
    enabled: next.enabled,
    note: next.note,
    updatedAt: new Date(),
  };
}

/** Every version of one rule, oldest first. */
export async function earnRuleHistoryFor(key: string) {
  const rows = await db.select().from(earnRuleHistory).where(eq(earnRuleHistory.key, key));
  return rows
    .map(r => ({
      credits: r.credits,
      liquidityCredits: r.liquidityCredits ?? 0,
      enabled: r.enabled,
      note: r.note,
      changedAt: r.changedAt,
      changedBy: r.changedBy,
    }))
    .sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
}

/** Postgres 23505, wherever the driver hid it. */
function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth++) {
    const err = cur as { code?: string; message?: string; cause?: unknown };
    if (err.code === '23505') return true;
    if (typeof err.message === 'string' && /duplicate key value|unique constraint/i.test(err.message)) return true;
    cur = err.cause;
  }
  return false;
}

/**
 * Claim one earn for one participant, paying today's price.
 *
 * Idempotent by construction rather than by checking first: the two
 * unique indexes on `earn_claims` are what stop a double payment, so two
 * link requests racing each other end with one claim and one grant. A
 * conflict is the normal answer, not an error - it means either this
 * participant already earned it, or (the important one) that external
 * account already paid out on some other Telarchy account.
 *
 * Returns what was granted, or null when the earn was already taken.
 */
export async function claimEarn(params: {
  agentId: string;
  key: EarnKey;
  /** The external account being proved, when there is one. */
  refId?: string | null;
  /** Which occurrence of a recurring earn; '' for the one-time ones. */
  period?: string;
  /** Overrides today's price. Only the streak uses it, because what the
   *  streak pays depends on the run, not on the row alone. */
  credits?: number;
}): Promise<{ granted: number } | null> {
  const credits = params.credits ?? (await earnCredits(params.key));
  // Paid beside the credits and never instead of them: depth for a floor of
  // your own, walled so it can only ever go behind a market
  // (notes/matched-liquidity-grants-2026-09-01.md). Read before the
  // transaction, like the price, because it is the same cached table.
  const liquidity = await earnLiquidityCredits(params.key);
  try {
    return await db.transaction(async tx => {
      await tx.insert(earnClaims).values({
        id: randomUUID(),
        agentId: params.agentId,
        key: params.key,
        refId: params.refId ?? null,
        period: params.period ?? '',
        credits,
      });
      if (credits > 0) {
        await applyCredits(tx, {
          agentId: params.agentId,
          workspaceId: PLATFORM_SCOPE,
          deltaUnits: toUnits(credits),
          reason: 'signup_grant',
          refId: `earn:${params.key}`,
        });
      }
      // Inside the same transaction as the claim row, so the uniqueness that
      // stops a second payment stops a second wallet grant with it. The
      // wallet has no ledger of its own; the claim row is its record.
      if (liquidity > 0) {
        await tx
          .update(agents)
          .set({ liquidityBalance: sql`${agents.liquidityBalance} + ${toUnits(liquidity)}` })
          .where(eq(agents.id, params.agentId));
      }
      return { granted: credits };
    });
  } catch (e) {
    // A unique violation is the rule working. Anything else is a real
    // failure and must not be swallowed into a silent "already claimed".
    // The driver wraps its error, so the check walks the cause chain:
    // matching only the outer message missed it and paid twice.
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

/**
 * The daily streak (owner ask 2026-08-30: "i think there should be daily
 * reward for streaks").
 *
 * It is paid for TRADING on a new day, never for arriving: a visit brings
 * nothing the platform can price, and an earn that pays for a page load is
 * exactly the farm the rest of this file exists to prevent. The run is
 * derived from the trades themselves rather than stored, so it cannot
 * drift from what somebody actually did.
 *
 * The row's `credits` is day one's price and the operator owns it; the
 * multiplier is fixed at 1x, 2x, 3x, then 4x a day from day four, which is
 * short enough to read off the page and small enough that a month of
 * perfect attendance is worth about three dollars at the platform's rate.
 */
export const STREAK_MAX_MULTIPLIER = 4;

/**
 * Far enough back to measure any run worth showing, and bounded so a
 * participant with a long history cannot make this query expensive.
 */
const STREAK_LOOKBACK_DAYS = 120;

export interface DailyStreak {
  /** Consecutive UTC days traded, counting today when today counts. */
  days: number;
  /** Whether today's reward is already in the balance. */
  earnedToday: boolean;
  /** What today paid, zero until it is earned. */
  todayCredits: number;
  /** What the next new day of trading pays. */
  nextCredits: number;
}

const dayOf = (at: Date): string => at.toISOString().slice(0, 10);

function previousDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return dayOf(d);
}

/** The UTC days this participant traded on, most recent first. */
async function tradedDays(agentId: string, limit: number): Promise<string[]> {
  const res = await db.execute(sql`
    select distinct to_char(${trades.createdAt}, 'YYYY-MM-DD') as day
      from ${trades}
     where ${trades.agentId} = ${agentId}
     order by day desc
     limit ${limit}`);
  return (res.rows ?? []).map(r => String((r as { day: string }).day));
}

/**
 * Whether this participant is a person: `auth_user_id` is set only by a
 * browser signup, and is unique per account, so it is the platform's one
 * durable "there is a human behind this" bit. A participant created
 * through `POST /api/agents/register` or `POST /api/agents` never has it.
 */
async function hasBrowserAccount(agentId: string): Promise<boolean> {
  const [row] = await db.select({ authUserId: agents.authUserId }).from(agents).where(eq(agents.id, agentId)).limit(1);
  return !!row?.authUserId;
}

/**
 * Pay the streak if today's first trade has happened and has not been paid
 * for, and report where the run stands either way. Safe to call as often
 * as anything likes: the claim's unique index is what makes it once a day,
 * so a trade and a page load racing each other pay once.
 *
 * Returns null when the operator has disabled or removed the row, which is
 * the signal to render no streak at all rather than a zero.
 */
export async function settleDailyStreak(agentId: string, now: Date = new Date()): Promise<DailyStreak | null> {
  const rule = (await load()).get('daily_trade');
  if (!rule || !rule.enabled) return null;
  // The streak pays a person, never a key (market-integrity I5, owner
  // direction 2026-08-31: "you cannot farm credit just by spawning
  // agents"). A spawned participant can trade the moment its owner sends
  // it one credit, so without this the streak was a faucet that scaled
  // with how many bots somebody registered: 25 credits a day rising to
  // 100, indefinitely, per bot, and nothing caps the number of bots.
  // Rendered as no streak at all rather than a zero, same as a row the
  // operator has disabled, because a streak that pays nothing is not a
  // streak.
  if (!(await hasBrowserAccount(agentId))) return null;

  const today = dayOf(now);
  const days = await tradedDays(agentId, STREAK_LOOKBACK_DAYS);
  const tradedToday = days[0] === today;

  // Walk back from today (or from yesterday, when today has no trade yet)
  // and count the unbroken run. A day with no trade ends it.
  let run = 0;
  let cursor = tradedToday ? today : previousDay(today);
  for (const day of days) {
    if (day > cursor) continue;
    if (day !== cursor) break;
    run += 1;
    cursor = previousDay(cursor);
  }

  const priceFor = (streakDay: number) =>
    Math.round(Math.max(0, rule.credits) * Math.min(Math.max(streakDay, 1), STREAK_MAX_MULTIPLIER));
  const nextCredits = priceFor(run + 1);

  if (!tradedToday) return { days: run, earnedToday: false, todayCredits: 0, nextCredits };

  const [already] = await db
    .select({ credits: earnClaims.credits })
    .from(earnClaims)
    .where(and(eq(earnClaims.agentId, agentId), eq(earnClaims.key, 'daily_trade'), eq(earnClaims.period, today)))
    .limit(1);
  if (already) return { days: run, earnedToday: true, todayCredits: already.credits, nextCredits };

  const claim = await claimEarn({ agentId, key: 'daily_trade', period: today, credits: priceFor(run) });
  // A null claim means another request paid it a millisecond ago, which is
  // the index doing its job; the run is unchanged either way.
  return { days: run, earnedToday: true, todayCredits: claim?.granted ?? priceFor(run), nextCredits };
}

/** Which earns this participant has already taken. */
export async function claimedKeys(agentId: string): Promise<Set<string>> {
  const rows = await db.select({ key: earnClaims.key }).from(earnClaims).where(eq(earnClaims.agentId, agentId));
  return new Set(rows.map(r => r.key));
}

/**
 * Whether an external account has already paid out anywhere: used to tell
 * somebody WHY a link earned nothing, which is the difference between a
 * rule and a bug in the reader's mind.
 */
export async function refAlreadyClaimed(key: EarnKey, refId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: earnClaims.id })
    .from(earnClaims)
    .where(and(eq(earnClaims.key, key), eq(earnClaims.refId, refId)))
    .limit(1);
  return !!row;
}
