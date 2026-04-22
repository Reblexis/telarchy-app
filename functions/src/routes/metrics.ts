import { Router } from 'express';
import { db } from '../db/client';
import { metrics, markets, updates, metricLogs } from '../db/schema';
import { eq, and, sql, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import {
  getAffectedMetrics, extractMetricReferences, getTransitiveDependencyNames,
  detectCircularDependency,
} from '../lib/metrics-engine';
import { sampleTimePoints, getLeafDescendantNames } from '../lib/time-preference';
import * as svc from '../services/metrics';
import { voidOpenMarketsForMetrics, recreateMarketsForMetric } from '../services/markets';
import { emitEvent } from '../services/events';
import type { TimePreference } from '../types';

export const metricsRouter = Router();

metricsRouter.get('/', requireCapability('read'), wrap(async (req, res) => {
  res.json(await svc.getAllMetrics(req.auth!.workspaceId));
}));

metricsRouter.get('/:id', requireCapability('read'), wrap(async (req, res) => {
  const metric = await svc.getMetricById(req.params.id as string, req.auth!.workspaceId);
  if (!metric) { res.status(404).json({ error: 'Metric not found' }); return; }
  res.json(metric);
}));

metricsRouter.get('/:id/logs', requireCapability('read'), wrap(async (req, res) => {
  res.json(await svc.getMetricLogs(req.params.id as string, req.auth!.workspaceId));
}));

// Purge metric_logs. Useful as a one-off reset when the logging semantic
// changes (e.g. we switched leaf logs from total → value). Body { metricId }
// scopes the purge to one metric; omit to wipe every log in the workspace.
// Returns { deleted: number }. Admin-only.
metricsRouter.post('/logs/purge', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const metricId = typeof req.body?.metricId === 'string' ? req.body.metricId : undefined;
  const whereClause = metricId
    ? and(eq(metricLogs.workspaceId, workspaceId), eq(metricLogs.metricId, metricId))
    : eq(metricLogs.workspaceId, workspaceId);
  const result = await db.delete(metricLogs).where(whereClause);
  res.json({ deleted: result.rowCount ?? 0, scope: metricId ? 'metric' : 'workspace' });
}));

metricsRouter.post('/', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { name, description = '', value = 0, formula = '0', timePreference, marketRangeMax } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  if (marketRangeMax !== undefined && (typeof marketRangeMax !== 'number' || marketRangeMax <= 0)) {
    res.status(400).json({ error: 'marketRangeMax must be a positive number' }); return;
  }

  const tp = parseTimePreference(timePreference);
  if (tp instanceof Error) { res.status(400).json({ error: tp.message }); return; }
  // Default TP to enabled (half-life 1 year) unless explicitly provided
  const effectiveTP: TimePreference | null = tp !== undefined
    ? (tp?.enabled ? tp : null)
    : { enabled: true, halfLife: 1 };

  const isLeaf = !formula || formula.trim() === '0';
  if (marketRangeMax !== undefined && !isLeaf) {
    res.status(400).json({ error: 'marketRangeMax can only be set on leaf metrics (no formula)' }); return;
  }

  const isDefinition = formula && formula.trim() !== '0';
  const id = randomUUID();

  await db.insert(metrics).values({
    id, workspaceId, name,
    value: isDefinition ? 0 : (value || 0),
    formula, description, order: 999,
    timePreference: effectiveTP,
    marketRangeMax: marketRangeMax ?? 1000,
    createdAt: new Date(), updatedAt: new Date(),
  });

  const warnings: string[] = [];

  // If ancestor already has TP, suppress this metric's TP (parent overrides)
  if (effectiveTP?.enabled) {
    const ancestorConflict = await findTPAncestorConflict(id, workspaceId);
    if (ancestorConflict) {
      await db.update(metrics).set({ timePreference: null, updatedAt: new Date() })
        .where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));
    } else {
      // Parent overrides: remove TP from descendants
      const removed = await removeTPFromDescendants(name, workspaceId);
      if (removed.length > 0) {
        warnings.push(`Time preference removed from ${removed.join(', ')} (now covered by ${name})`);
      }
      await svc.ensureMarketsForTimePreference(id, effectiveTP.halfLife, workspaceId);
    }
  }

  const allMetrics = await svc.getAllMetrics(workspaceId);
  await svc.logSpecificMetrics(getAffectedMetrics([id], allMetrics), allMetrics, workspaceId);

  res.status(201).json({ ok: true, id, warnings });
}));

metricsRouter.put('/:id', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const id = req.params.id as string;
  const { oldValue, updateNote = '', timePreference: rawTP, ...fields } = req.body;

  const newTP = parseTimePreference(rawTP);
  if (newTP instanceof Error) { res.status(400).json({ error: newTP.message }); return; }

  if (fields.marketRangeMax !== undefined && (typeof fields.marketRangeMax !== 'number' || fields.marketRangeMax <= 0)) {
    res.status(400).json({ error: 'marketRangeMax must be a positive number' }); return;
  }
  // marketRangeMax leaf-only check happens after oldRow is fetched (effectiveFormula needed)

  const allowed = ['name', 'description', 'value', 'formula', 'marketRangeMax'] as const;
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) update[key] = fields[key];
  }
  if (Object.keys(update).length === 0 && rawTP === undefined) {
    res.status(400).json({ error: 'No fields to update' }); return;
  }

  const [oldRow] = await db.select().from(metrics)
    .where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));
  if (!oldRow) { res.status(404).json({ error: 'Metric not found' }); return; }

  const oldTP = (oldRow.timePreference as TimePreference | null)?.enabled
    ? oldRow.timePreference as TimePreference
    : undefined;

  const effectiveFormula = (update.formula as string | undefined) ?? oldRow.formula ?? '0';
  const effectiveName = (update.name as string | undefined) ?? oldRow.name;

  const effectiveIsLeaf = !effectiveFormula || effectiveFormula.trim() === '0';
  if (update.marketRangeMax !== undefined && !effectiveIsLeaf) {
    res.status(400).json({ error: 'marketRangeMax can only be set on leaf metrics (no formula)' }); return;
  }

  if (update.formula) {
    const allMetrics = await svc.getAllMetrics(workspaceId);
    if (detectCircularDependency(id, update.formula as string, allMetrics)) {
      res.status(400).json({ error: 'This formula would create a circular dependency' }); return;
    }
  }

  const wasTPEnabled = oldTP?.enabled ?? false;
  const isTPEnabled = newTP !== undefined ? (newTP?.enabled ?? false) : wasTPEnabled;
  if (isTPEnabled && !wasTPEnabled) {
    const ancestorConflict = await findTPAncestorConflict(id, workspaceId);
    if (ancestorConflict) {
      res.status(400).json({ error: `Cannot enable time preference: ancestor "${ancestorConflict}" already has time preference on this path` });
      return;
    }
  }

  if (effectiveFormula && effectiveFormula.trim() !== '0') update.value = 0;

  if (rawTP !== undefined) {
    update.timePreference = newTP?.enabled ? newTP : null;
  }
  update.updatedAt = new Date();

  const dbUpdate: Partial<typeof metrics.$inferInsert> = {};
  if (update.name !== undefined) dbUpdate.name = update.name as string;
  if (update.description !== undefined) dbUpdate.description = update.description as string;
  if (update.value !== undefined) dbUpdate.value = update.value as number;
  if (update.formula !== undefined) dbUpdate.formula = update.formula as string;
  if (update.marketRangeMax !== undefined) dbUpdate.marketRangeMax = (update.marketRangeMax as number | null) ?? 1000;
  if (update.timePreference !== undefined) dbUpdate.timePreference = update.timePreference as TimePreference | null;
  dbUpdate.updatedAt = new Date();

  const isLeafMetric = !effectiveFormula || effectiveFormula.trim() === '0';

  await db.transaction(async tx => {
    await tx.update(metrics).set(dbUpdate)
      .where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));

    if (isLeafMetric && oldValue !== undefined && update.value !== undefined && oldValue !== update.value) {
      await tx.insert(updates).values({
        id: randomUUID(), workspaceId,
        metricName: effectiveName, oldValue, newValue: update.value as number,
        description: updateNote || 'Value updated', timestamp: new Date(),
      });
    }
  });

  const [updated] = await db.select().from(metrics)
    .where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));

  // Parent overrides: remove TP from descendants when enabling TP
  const warnings: string[] = [];
  if (isTPEnabled && !wasTPEnabled) {
    const removed = await removeTPFromDescendants(effectiveName, workspaceId);
    if (removed.length > 0) {
      warnings.push(`Time preference removed from ${removed.join(', ')} (now covered by ${effectiveName})`);
    }
  }

  res.json({ ...updated, warnings });

  const effectiveHalfLife = newTP?.halfLife ?? oldTP?.halfLife ?? 1;

  if (newTP !== undefined) {
    if (newTP?.enabled && !wasTPEnabled) {
      await svc.ensureMarketsForTimePreference(id, newTP.halfLife, workspaceId);
    } else if (!newTP?.enabled && wasTPEnabled) {
      await deactivateLeafMarketsForTPMetric(id, oldTP!.halfLife, workspaceId);
    } else if (newTP?.enabled && wasTPEnabled && newTP.halfLife !== oldTP!.halfLife) {
      await svc.respawnMarketsForTimePreference(id, newTP.halfLife, workspaceId);
    }
  }

  // Invariant: a market may only exist while its metric's definition (name, description,
  // formula, marketRangeMax) is unchanged from when the market was created. Any change to
  // those fields voids all open markets for this metric (refunding positions at cost), and
  // new markets are respawned with the updated definition via the TP/ensure logic below.
  const definitionChanged = isDefinitionChange(oldRow, update, effectiveFormula);
  let voidedTargetDates: string[] = [];
  if (definitionChanged) {
    const openForMetric = await db.select({ targetDate: markets.targetDate })
      .from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.metricId, id), eq(markets.resolved, false)));
    voidedTargetDates = openForMetric.map(m => m.targetDate);
    if (voidedTargetDates.length > 0) {
      await voidOpenMarketsForMetrics(new Set([id]), workspaceId);
    }
  }

  if (definitionChanged && !isTPEnabled) {
    const tpAncestorIds = await findTPAncestors(id, workspaceId);
    if (tpAncestorIds.length > 0) {
      for (const tpId of tpAncestorIds) {
        const [tpRow] = await db.select({ timePreference: metrics.timePreference }).from(metrics)
          .where(and(eq(metrics.id, tpId), eq(metrics.workspaceId, workspaceId)));
        const tpHalfLife = (tpRow?.timePreference as TimePreference | null)?.halfLife;
        if (tpHalfLife) await svc.respawnMarketsForTimePreference(tpId, tpHalfLife, workspaceId);
      }
    } else if (voidedTargetDates.length > 0) {
      // Standalone leaf metric with no TP ancestors: recreate voided markets with the new definition.
      const newRangeMax = (update.marketRangeMax as number | undefined) ?? oldRow.marketRangeMax ?? 1000;
      const metricName = (update.name as string | undefined) ?? oldRow.name;
      await recreateMarketsForMetric(id, metricName, voidedTargetDates, newRangeMax, workspaceId);
    }
  }

  if (definitionChanged && isTPEnabled) {
    await svc.respawnMarketsForTimePreference(id, effectiveHalfLife, workspaceId);
  }

  const allMetrics = await svc.getAllMetrics(workspaceId);
  await svc.logSpecificMetrics(getAffectedMetrics([id], allMetrics), allMetrics, workspaceId);
  if (update.value !== undefined) {
    const metric = allMetrics.find(m => m.id === id);
    if (!metric) { console.error(`emitEvent: metric ${id} not found after update`); }
    else emitEvent('metric:updated', { metricId: id, metricName: metric.name, oldValue: oldValue ?? null, newValue: update.value }, workspaceId)
      .catch(e => console.error('emitEvent failed:', e));
  }
}));

metricsRouter.delete('/:id', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const id = req.params.id as string;
  const [row] = await db.select().from(metrics)
    .where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));
  if (!row) { res.status(404).json({ error: 'Metric not found' }); return; }

  const tpAncestorIds = await findTPAncestors(id, workspaceId);
  await svc.deleteMetric(id, workspaceId);
  res.status(204).send();

  // The deleted metric's definition no longer exists, so any open markets for it must be
  // voided (refund at cost). Descendant markets under a deleted non-leaf TP metric are
  // handled separately: their own definitions are unchanged, so they stay open and close
  // naturally via the daily refresh, resolving against the descendant's live value.
  await voidOpenMarketsForMetrics(new Set([id]), workspaceId);

  const tp = row.timePreference as TimePreference | null;
  if (!tp?.enabled) {
    for (const tpId of tpAncestorIds) {
      const [tpRow] = await db.select({ timePreference: metrics.timePreference }).from(metrics)
        .where(and(eq(metrics.id, tpId), eq(metrics.workspaceId, workspaceId)));
      const tpHalfLife = (tpRow?.timePreference as TimePreference | null)?.halfLife;
      if (tpHalfLife) await svc.respawnMarketsForTimePreference(tpId, tpHalfLife, workspaceId);
    }
  }
}));

metricsRouter.post('/migrate-leaf-types', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const rows = await db.select().from(metrics).where(eq(metrics.workspaceId, workspaceId));
  let updated = 0;
  for (const row of rows) {
    if ((row.formula ?? '0').trim() !== '0' && row.value !== 0) {
      await db.update(metrics).set({ value: 0 })
        .where(and(eq(metrics.id, row.id), eq(metrics.workspaceId, workspaceId)));
      updated++;
    }
  }
  res.json({ updated });
}));

// --- Helpers ---

function parseTimePreference(raw: unknown): TimePreference | undefined | Error {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') return new Error('timePreference must be an object');
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return new Error('timePreference.enabled must be a boolean');
  if (obj.enabled && (typeof obj.halfLife !== 'number' || obj.halfLife <= 0)) {
    return new Error('timePreference.halfLife must be a positive number (years)');
  }
  return { enabled: obj.enabled, halfLife: (obj.halfLife as number) ?? 1 };
}

function isDefinitionChange(
  oldRow: typeof metrics.$inferSelect,
  update: Record<string, unknown>,
  effectiveFormula: string,
): boolean {
  if (update.name !== undefined && update.name !== oldRow.name) return true;
  if (update.description !== undefined && update.description !== oldRow.description) return true;
  if (update.formula !== undefined && update.formula !== (oldRow.formula ?? '0')) return true;
  if (update.marketRangeMax !== undefined && update.marketRangeMax !== oldRow.marketRangeMax) return true;
  const isLeaf = !effectiveFormula || effectiveFormula.trim() === '0';
  if (!isLeaf && update.value !== undefined && update.value !== oldRow.value) return true;
  return false;
}

async function getAllMetricRows(workspaceId: string) {
  return db.select().from(metrics).where(eq(metrics.workspaceId, workspaceId)).orderBy(asc(metrics.order), asc(metrics.createdAt));
}

async function findTPAncestors(metricId: string, workspaceId: string): Promise<string[]> {
  const rows = await getAllMetricRows(workspaceId);
  const referencedBy: Record<string, string[]> = {};
  for (const row of rows) referencedBy[row.id] = [];
  for (const row of rows) {
    for (const refName of extractMetricReferences(row.formula || '0')) {
      const refRow = rows.find(r => r.name === refName);
      if (refRow) referencedBy[refRow.id].push(row.id);
    }
  }

  const tpAncestors: string[] = [];
  const visited = new Set<string>();
  const queue = [...(referencedBy[metricId] || [])];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const row = rows.find(r => r.id === currentId);
    const tp = row?.timePreference as TimePreference | null;
    if (tp?.enabled) {
      tpAncestors.push(currentId);
    } else {
      queue.push(...(referencedBy[currentId] || []));
    }
  }

  return tpAncestors;
}

/** Check if any ancestor already has TP (returns ancestor name, or null). */
async function findTPAncestorConflict(metricId: string, workspaceId: string): Promise<string | null> {
  const ancestorIds = await findTPAncestors(metricId, workspaceId);
  if (ancestorIds.length === 0) return null;
  const rows = await getAllMetricRows(workspaceId);
  const row = rows.find(r => r.id === ancestorIds[0]);
  return row?.name ?? null;
}

/** Find TP-enabled descendants and remove their TP (parent overrides). Returns removed metric names. */
async function removeTPFromDescendants(metricName: string, workspaceId: string): Promise<string[]> {
  const rows = await getAllMetricRows(workspaceId);
  const nameToFormula: Record<string, string> = {};
  for (const row of rows) nameToFormula[row.name] = row.formula || '0';

  const descNames = getTransitiveDependencyNames(metricName, nameToFormula);
  const removed: string[] = [];

  for (const name of descNames) {
    const row = rows.find(r => r.name === name);
    const tp = row?.timePreference as TimePreference | null;
    if (tp?.enabled) {
      await db.update(metrics).set({ timePreference: null, updatedAt: new Date() })
        .where(and(eq(metrics.id, row!.id), eq(metrics.workspaceId, workspaceId)));
      await deactivateLeafMarketsForTPMetric(row!.id, tp.halfLife, workspaceId);
      removed.push(name);
    }
  }

  return removed;
}

async function deactivateLeafMarketsForTPMetric(tpMetricId: string, oldHalfLife: number, workspaceId: string): Promise<void> {
  const rows = await getAllMetricRows(workspaceId);
  const nameToFormula: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  let tpMetricName = '';

  for (const row of rows) {
    nameToFormula[row.name] = row.formula || '0';
    nameToId.set(row.name, row.id);
    if (row.id === tpMetricId) tpMetricName = row.name;
  }

  if (!tpMetricName) return;

  let leafNames = getLeafDescendantNames(tpMetricName, nameToFormula);
  const tpIsLeaf = !nameToFormula[tpMetricName] || nameToFormula[tpMetricName].trim() === '0';
  if (tpIsLeaf) {
    leafNames = [tpMetricName];
  } else if (leafNames.length === 0) {
    return;
  }

  const leafIds = new Set(leafNames.map(n => nameToId.get(n)).filter(Boolean) as string[]);
  const oldDates = new Set(sampleTimePoints(oldHalfLife).map(p => p.date));

  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  for (const m of openMarkets) {
    if (leafIds.has(m.metricId) && oldDates.has(m.targetDate) && m.active !== false) {
      await db.update(markets).set({ active: false })
        .where(and(eq(markets.id, m.id), eq(markets.workspaceId, workspaceId)));
    }
  }
}
