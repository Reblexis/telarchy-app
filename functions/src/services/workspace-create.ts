import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { metrics, proposals } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { getStarterProposal, getTemplate, type TemplateParams } from '../lib/templates';
import { parseVisibility } from '../lib/validation';
import { ensureMarketsForTimePreference } from './metrics';
import { createConditionalMarkets } from './proposals';

/** Validation failure while creating a workspace; maps to an HTTP 400. */
export class WorkspaceCreateError extends Error {}

export interface CreateWorkspaceResult {
  id: string;
  name: string;
  slug: string;
  visibility: 'public' | 'unlisted' | 'private';
  template: string;
  metricsCreated: number;
  starterProposalId: string | null;
}

/**
 * Create a workspace from a template: provision (slug, groups), seed the
 * template metrics with time preference, create their markets, and file the
 * starter proposal. Shared by POST /api/workspaces and POST /api/onboard so
 * both front doors produce identical workspaces.
 */
export async function createWorkspaceFromTemplate(input: {
  /** Identity string stored as workspaces.createdBy (uid, agentId, or 'admin'). */
  identity: string;
  /** Participant id of the owner, when known; seeds the Admin group and authors the starter proposal. */
  ownerAgentId?: string;
  name: unknown;
  templateId?: unknown;
  templateParams?: unknown;
  visibility?: unknown;
}): Promise<CreateWorkspaceResult> {
  const { identity, ownerAgentId } = input;

  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new WorkspaceCreateError('name is required');
  }
  const name = input.name.trim();

  let visibility: 'public' | 'unlisted' | 'private' = 'private';
  if (input.visibility !== undefined) {
    const parsed = parseVisibility(input.visibility);
    if (!parsed.ok) throw new WorkspaceCreateError(parsed.error);
    visibility = parsed.value;
  }

  let template;
  try {
    template = getTemplate(input.templateId as string | undefined);
  } catch (err) {
    throw new WorkspaceCreateError((err as Error).message);
  }

  const params: TemplateParams =
    input.templateParams && typeof input.templateParams === 'object' ? (input.templateParams as TemplateParams) : {};
  const templateMetrics = template.metrics(params);

  const wsId = randomUUID();
  const metricIdsWithTP: Array<{ id: string; halfLife: number }> = [];

  let slug = '';
  await db.transaction(async tx => {
    slug = await provisionWorkspace(tx, {
      wsId,
      name,
      createdBy: identity,
      ownerAgentId,
      visibility,
    });

    const now = new Date();
    for (let i = 0; i < templateMetrics.length; i++) {
      const spec = templateMetrics[i];
      const id = randomUUID();
      await tx.insert(metrics).values({
        id,
        workspaceId: wsId,
        name: spec.name,
        value: spec.initialValue,
        formula: '0',
        description: spec.description,
        order: i,
        timePreference: { enabled: true, halfLife: spec.timePreferenceHalfLifeYears },
        marketRangeMax: spec.marketRangeMax,
        createdAt: now,
        updatedAt: now,
      });
      metricIdsWithTP.push({ id, halfLife: spec.timePreferenceHalfLifeYears });
    }
  });

  // Market creation touches multiple tables and emits events; keep it outside the provisioning transaction.
  for (const { id, halfLife } of metricIdsWithTP) {
    await ensureMarketsForTimePreference(id, { enabled: true, halfLife }, wsId);
  }

  // Seed one starter proposal so the workspace is non-empty on first land.
  // The product tour points at this proposal; without it, a brand new
  // workspace cannot demonstrate the proposal -> market -> approval flow.
  let starterProposalId: string | null = null;
  if (ownerAgentId) {
    try {
      const starter = getStarterProposal(template);
      const propId = randomUUID();
      await db.insert(proposals).values({
        id: propId,
        workspaceId: wsId,
        proposedBy: ownerAgentId,
        title: starter.title,
        description: starter.description,
        status: 'pending',
        conditionalMarketIds: [],
        liquiditySubsidy: 0,
        createdAt: new Date(),
      });
      const conditionalMarketIds = await createConditionalMarkets(propId, wsId, {});
      if (conditionalMarketIds.length > 0) {
        await db
          .update(proposals)
          .set({ conditionalMarketIds })
          .where(and(eq(proposals.id, propId), eq(proposals.workspaceId, wsId)));
      }
      starterProposalId = propId;
    } catch (err) {
      // Starter proposal is non-fatal: workspace creation must still succeed.
      console.error(`Failed to seed starter proposal for workspace ${wsId}:`, err);
    }
  }

  return {
    id: wsId,
    name,
    slug,
    visibility,
    template: template.id,
    metricsCreated: templateMetrics.length,
    starterProposalId,
  };
}
