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
import { getLeafDescendantNames, desiredMarketDates, generatesMarkets } from '../lib/time-preference';
import { isValidCalendarDate, periodEndInstant } from '../lib/date-utils';
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
    ? storableTP(tp)
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

  // If ancestor already has TP, suppress this metric's curve (parent overrides).
  // Custom horizons are explicit user choices and survive the demotion.
  if (effectiveTP?.enabled) {
    const ancestorConflict = await findTPAncestorConflict(id, workspaceId);
    if (ancestorConflict) {
      const demoted = storableTP({ ...effectiveTP, enabled: false });
      await db.update(metrics).set({ timePreference: demoted, updatedAt: new Date() })
        .where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));
      if (demoted) await svc.ensureMarketsForTimePreference(id, demoted, workspaceId);
    } else {
      // Parent overrides: remove curve TP from descendants
      const removed = await removeTPFromDescendants(name, workspaceId);
      if (removed.length > 0) {
        warnings.push(`Time preference removed from ${removed.join(', ')} (now covered by ${name})`);
      }
      await svc.ensureMarketsForTimePreference(id, effectiveTP, workspaceId);
    }
  } else if (generatesMarkets(effectiveTP)) {
    // Custom horizons only, no curve: no ancestor conflict applies.
    await svc.ensureMarketsForTimePreference(id, effectiveTP, workspaceId);
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

  const oldTP = (oldRow.timePreference as TimePreference | null) ?? undefined;

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
    update.timePreference = storableTP(newTP);
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

  // The TP record in effect after this request (stored form, or unchanged old).
  const effectiveTPRecord: TimePreference | null = rawTP !== undefined
    ? storableTP(newTP)
    : (oldTP ?? null);

  // Unified reconcile: deactivate dates the old config wanted but the new one
  // doesn't, then ensure the new desired set (creates missing markets and
  // reactivates inactive-but-desired ones). Covers enable, disable, curve
  // parameter changes, custom horizon edits, and explicit clear alike.
  if (rawTP !== undefined) {
    const oldDesired = generatesMarkets(oldTP) ? desiredMarketDates(oldTP) : [];
    const newDesired = generatesMarkets(effectiveTPRecord) ? new Set(desiredMarketDates(effectiveTPRecord)) : new Set<string>();
    const staleDates = oldDesired.filter(d => !newDesired.has(d));
    if (staleDates.length > 0) {
      await deactivateLeafMarketsForTPMetric(id, staleDates, workspaceId);
    }
    if (generatesMarkets(effectiveTPRecord)) {
      await svc.ensureMarketsForTimePreference(id, effectiveTPRecord, workspaceId);
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

  const isManaged = generatesMarkets(effectiveTPRecord);
  if (definitionChanged && !isManaged) {
    const tpAncestorIds = await findTPAncestors(id, workspaceId);
    if (tpAncestorIds.length > 0) {
      for (const tpId of tpAncestorIds) {
        const [tpRow] = await db.select({ timePreference: metrics.timePreference }).from(metrics)
          .where(and(eq(metrics.id, tpId), eq(metrics.workspaceId, workspaceId)));
        const tpRecord = tpRow?.timePreference as TimePreference | null;
        if (generatesMarkets(tpRecord)) await svc.respawnMarketsForTimePreference(tpId, tpRecord, workspaceId);
      }
    } else if (voidedTargetDates.length > 0) {
      // Standalone leaf metric with no TP config and no TP ancestors: recreate
      // voided markets at the same dates with the new definition.
      const newRangeMax = (update.marketRangeMax as number | undefined) ?? oldRow.marketRangeMax ?? 1000;
      const metricName = (update.name as string | undefined) ?? oldRow.name;
      await recreateMarketsForMetric(id, metricName, voidedTargetDates, newRangeMax, workspaceId);
    }
  }

  if (definitionChanged && isManaged) {
    // Respawn from the current desired set only; horizons removed in this same
    // request stay removed.
    await svc.respawnMarketsForTimePreference(id, effectiveTPRecord!, workspaceId);
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
  // voided (refunding each participant the net cash still at stake). Descendant markets under a deleted non-leaf TP metric are
  // handled separately: their own definitions are unchanged, so they stay open and close
  // naturally via the daily refresh, resolving against the descendant's live value.
  await voidOpenMarketsForMetrics(new Set([id]), workspaceId);

  const tp = row.timePreference as TimePreference | null;
  if (!tp?.enabled) {
    for (const tpId of tpAncestorIds) {
      const [tpRow] = await db.select({ timePreference: metrics.timePreference }).from(metrics)
        .where(and(eq(metrics.id, tpId), eq(metrics.workspaceId, workspaceId)));
      const tpRecord = tpRow?.timePreference as TimePreference | null;
      if (generatesMarkets(tpRecord)) await svc.respawnMarketsForTimePreference(tpId, tpRecord, workspaceId);
    }
  }
}));

// Reorder metrics within their depth level. Body: { ids: string[] } — an
// ordered list of metric ids belonging to the same depth. The metric at index 0
// gets `order = 0`, index 1 gets `order = 1`, etc. Ids that don't belong to the
// workspace are ignored. Returns { updated: number }. Admin-only because order
// is a workspace-level setting, not a per-participant view.
metricsRouter.post('/reorder', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
    res.status(400).json({ error: 'ids must be an array of metric id strings' });
    return;
  }
  if (ids.length === 0) { res.json({ updated: 0 }); return; }

  const rows = await db.select({ id: metrics.id }).from(metrics)
    .where(eq(metrics.workspaceId, workspaceId));
  const known = new Set(rows.map(r => r.id));
  const filtered = ids.filter(id => known.has(id));

  // 1-based: existing sort sites use `order || 999`, so order=0 would silently
  // sort to the bottom. Index from 1 to dodge that legacy falsy-zero trap.
  await db.transaction(async tx => {
    for (let i = 0; i < filtered.length; i++) {
      await tx.update(metrics)
        .set({ order: i + 1, updatedAt: new Date() })
        .where(and(eq(metrics.id, filtered[i]), eq(metrics.workspaceId, workspaceId)));
    }
  });

  res.json({ updated: filtered.length });
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

const MAX_CUSTOM_HORIZONS = 24;
const RELATIVE_HORIZON_RE = /^\+(\d+)(h|d|w|m|y)$/;

/**
 * Parse the timePreference request field. `undefined` = field absent (no
 * change); `null` = explicit clear. Expired absolute custom horizons are
 * pruned silently so re-saving an old config never fails.
 * Exported for unit tests.
 */
export function parseTimePreference(raw: unknown): TimePreference | null | undefined | Error {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'object') return new Error('timePreference must be an object');
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return new Error('timePreference.enabled must be a boolean');
  if (obj.enabled && (typeof obj.halfLife !== 'number' || obj.halfLife <= 0)) {
    return new Error('timePreference.halfLife must be a positive number (years)');
  }
  let density: number | undefined;
  if (obj.density !== undefined && obj.density !== null) {
    if (typeof obj.density !== 'number' || !Number.isFinite(obj.density) || obj.density < 1) {
      return new Error('timePreference.density must be a positive integer');
    }
    density = Math.floor(obj.density);
  }
  let customHorizons: string[] | undefined;
  if (obj.customHorizons !== undefined && obj.customHorizons !== null) {
    if (!Array.isArray(obj.customHorizons)) {
      return new Error('timePreference.customHorizons must be an array of date strings');
    }
    const now = new Date();
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const rawEntry of obj.customHorizons) {
      if (typeof rawEntry !== 'string') {
        return new Error('timePreference.customHorizons entries must be strings');
      }
      const entry = rawEntry.trim();
      // A relative entry is accepted as written. "+0w" is the CURRENT period
      // and the only way to say it: a pulse metric named "revenue this week"
      // must target this week, and an absolute "2026-W33" is one-shot and
      // stops rolling. The offset used to be required to be >= 1, which forced
      // LookPilot's weekly pulse onto a week that had not started, so the
      // floor showed a forecast for one week beside a running total from
      // another (owner report 2026-08-16). A negative offset needs no check:
      // RELATIVE_HORIZON_RE matches digits only, so "-1d" is not relative at
      // all and falls to the format error below.
      if (!RELATIVE_HORIZON_RE.test(entry)) {
        if (!isValidCalendarDate(entry)) {
          return new Error(`invalid custom horizon "${entry}": use +Nh / +Nd / +Nw / +Nm / +Ny or YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD, YYYY-MM-DDTHH (UTC)`);
        }
        if (periodEndInstant(entry) <= now) continue; // expired absolute: prune, don't reject
      }
      if (seen.has(entry)) continue;
      seen.add(entry);
      cleaned.push(entry);
    }
    if (cleaned.length > MAX_CUSTOM_HORIZONS) {
      return new Error(`timePreference.customHorizons supports at most ${MAX_CUSTOM_HORIZONS} entries`);
    }
    if (cleaned.length > 0) customHorizons = cleaned;
  }
  const tp: TimePreference = { enabled: obj.enabled, halfLife: (obj.halfLife as number) ?? 1 };
  if (density !== undefined) tp.density = density;
  if (customHorizons !== undefined) tp.customHorizons = customHorizons;
  return tp;
}

/** Storage rule: a TP record is kept only when it can generate markets later. */
function storableTP(tp: TimePreference | null | undefined): TimePreference | null {
  if (!tp) return null;
  return (tp.enabled || (tp.customHorizons?.length ?? 0) > 0) ? tp : null;
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

/**
 * Find curve-enabled descendants and demote their curve (parent overrides).
 * Custom horizons are explicit user choices and survive: the descendant keeps
 * a TP record with enabled=false when it has custom dates, and only the
 * curve-derived market dates are deactivated. Returns demoted metric names.
 */
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
      const demoted = storableTP({ ...tp, enabled: false });
      await db.update(metrics).set({ timePreference: demoted, updatedAt: new Date() })
        .where(and(eq(metrics.id, row!.id), eq(metrics.workspaceId, workspaceId)));
      const oldDesired = desiredMarketDates(tp);
      const keep = new Set(demoted ? desiredMarketDates(demoted) : []);
      const staleDates = oldDesired.filter(d => !keep.has(d));
      await deactivateLeafMarketsForTPMetric(row!.id, staleDates, workspaceId);
      removed.push(name);
    }
  }

  return removed;
}

/** Deactivate open markets at the given target dates on the TP metric's leaves. */
async function deactivateLeafMarketsForTPMetric(tpMetricId: string, staleDates: string[], workspaceId: string): Promise<void> {
  if (staleDates.length === 0) return;
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
  const staleSet = new Set(staleDates);

  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  for (const m of openMarkets) {
    if (leafIds.has(m.metricId) && staleSet.has(m.targetDate) && m.active !== false) {
      await db.update(markets).set({ active: false })
        .where(and(eq(markets.id, m.id), eq(markets.workspaceId, workspaceId)));
    }
  }
}
