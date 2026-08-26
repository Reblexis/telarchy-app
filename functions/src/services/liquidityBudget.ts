/**
 * The workspace liquidity budget (docs/liquidity.md): credits an owner
 * bought that can only ever become market liquidity on that workspace.
 *
 * These two functions are the only writers of workspaces.liquidity_budget,
 * the way services/credits.ts is the only writer of agents.balance
 * (credit-ledger-ownership.test.ts guards both). Every movement lands in
 * liquidity_budget_ledger.
 */

import { randomUUID } from 'crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { db } from '../db/client';
import { liquidityBudgetLedger, workspaces } from '../db/schema';

type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export type BudgetReason = 'purchase' | 'injection' | 'auto_fund' | 'lp_leftover' | 'admin_adjustment';

export interface BudgetMove {
  workspaceId: string;
  deltaUnits: number;
  reason: BudgetReason;
  refType?: 'market' | 'purchase' | 'proposal' | null;
  refId?: string | null;
}

/**
 * Move budget and record why. Returns null, applying nothing, when the move
 * is a debit the budget cannot cover (the debit is its own balance check, no
 * read-then-write race), or when the workspace does not exist.
 */
export async function applyBudgetIfSufficient(
  tx: DbOrTx,
  params: BudgetMove,
): Promise<{ balanceAfterUnits: number } | null> {
  const { workspaceId, deltaUnits, reason, refType = null, refId = null } = params;
  const where =
    deltaUnits < 0
      ? and(eq(workspaces.id, workspaceId), gte(workspaces.liquidityBudget, -deltaUnits))
      : eq(workspaces.id, workspaceId);
  const [row] = await tx
    .update(workspaces)
    .set({ liquidityBudget: sql`${workspaces.liquidityBudget} + ${deltaUnits}` })
    .where(where)
    .returning({ liquidityBudget: workspaces.liquidityBudget });
  if (!row) return null;
  const balanceAfterUnits = Number(row.liquidityBudget);
  await tx.insert(liquidityBudgetLedger).values({
    id: randomUUID(),
    workspaceId,
    deltaUnits,
    balanceAfterUnits,
    reason,
    refType,
    refId,
  });
  return { balanceAfterUnits };
}

/** The unconditional form for credits and admin adjustments. */
export async function applyBudget(tx: DbOrTx, params: BudgetMove): Promise<{ balanceAfterUnits: number }> {
  const result = await applyBudgetIfSufficient(tx, params);
  if (!result)
    throw new Error(`applyBudget: workspace ${params.workspaceId} missing or budget short (${params.reason})`);
  return result;
}

export async function readBudgetUnits(tx: DbOrTx, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ liquidityBudget: workspaces.liquidityBudget })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return row ? Number(row.liquidityBudget) : 0;
}

/** Per-metric auto-fund weight (default 1). */
export function metricWeight(weights: unknown, metricId: string): number {
  if (!weights || typeof weights !== 'object') return 1;
  const w = (weights as Record<string, unknown>)[metricId];
  if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) return 1;
  return w;
}

/** Marks a subsidy contributor slot as "the workspace budget" in spawn plans. */
export const BUDGET_CONTRIBUTOR = '\u0000budget';
