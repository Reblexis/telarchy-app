import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { earnRuleHistory, earnRules } from '../db/schema';
import { AppError } from '../lib/errors';
import { AGENT_SIGNUP_CREDITS, SIGNUP_CREDITS } from '../lib/validation';

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

export type EarnKey = 'signup_user' | 'signup_email' | 'signup_oauth' | 'signup_agent' | 'manifold_link';

export interface EarnRule {
  key: string;
  label: string;
  credits: number;
  kind: 'flat' | 'cap';
  enabled: boolean;
  note: string;
  updatedAt: Date;
}

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
        kind: (r.kind === 'cap' ? 'cap' : 'flat') as 'flat' | 'cap',
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
  patch: { credits?: number; enabled?: boolean; note?: string; label?: string },
  changedBy: string | null,
): Promise<EarnRule> {
  const [existing] = await db.select().from(earnRules).where(eq(earnRules.key, key)).limit(1);
  if (!existing) throw new AppError(`No earn rule named ${key}`, 404);

  if (patch.credits !== undefined && (!Number.isFinite(patch.credits) || patch.credits < 0)) {
    throw new AppError('credits must be a non-negative number', 400);
  }
  const next = {
    credits: patch.credits ?? existing.credits,
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
    kind: (existing.kind === 'cap' ? 'cap' : 'flat') as 'flat' | 'cap',
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
      enabled: r.enabled,
      note: r.note,
      changedAt: r.changedAt,
      changedBy: r.changedBy,
    }))
    .sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
}
