import { randomUUID } from 'crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { agents, markets, metricDefinitionRevisions, metricLogs, metrics, trades, updates } from '../db/schema';
import { isValidCalendarDate, periodEndInstant } from '../lib/date-utils';
import { assertMetricMarketsUntraded } from '../lib/market-freeze';
import {
  detectCircularDependency,
  extractMetricReferences,
  getAffectedMetrics,
  getTransitiveDependencyNames,
} from '../lib/metrics-engine';
import { resolveWorkspaceOwnerAgentId } from '../lib/participants';
import { desiredMarketDates, generatesMarkets, getLeafDescendantNames } from '../lib/time-preference';
import { fromUnits, liquiditySpendableUnits } from '../lib/validation';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { emitEvent } from '../services/events';
import { voidOpenMarketsForMetrics } from '../services/markets';
import * as svc from '../services/metrics';
import type { TimePreference } from '../types';

export const metricsRouter = Router();

metricsRouter.get(
  '/',
  requireCapability('read'),
  wrap(async (req, res) => {
    res.json(await svc.getAllMetrics(req.auth!.workspaceId));
  }),
);

metricsRouter.get(
  '/:id',
  requireCapability('read'),
  wrap(async (req, res) => {
    const metric = await svc.getMetricById(req.params.id as string, req.auth!.workspaceId);
    if (!metric) {
      res.status(404).json({ error: 'Metric not found' });
      return;
    }
    res.json(metric);
  }),
);

metricsRouter.get(
  '/:id/logs',
  requireCapability('read'),
  wrap(async (req, res) => {
    res.json(await svc.getMetricLogs(req.params.id as string, req.auth!.workspaceId));
  }),
);

/**
 * Dated readings for a past you can prove (docs/guides/sources.md,
 * "Backfilling a past you can prove").
 *
 * Every other write stamps a reading with the moment it arrived, which is
 * right: a reading is a measurement, and its timestamp is when it was taken.
 * That leaves a metric on an already-published statistic with a single point
 * and no trend, which is what this route fixes.
 *
 * Readings are what resolution reads, so dated writes are the one place that
 * could rewrite a payout. Three refusals keep it away from settlement: every
 * instant must be strictly OLDER than the metric's oldest existing reading
 * (so a backfilled point can never be the "last reading at or before" any
 * instant a market resolves on), the metric must have no resolved market, and
 * a batch is capped and must be internally unique. The value itself never
 * moves and no change-log row is written, because nobody measured these today.
 */
export const BACKFILL_MAX_READINGS = 2000;

metricsRouter.post(
  '/:id/logs/backfill',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const metricId = req.params.id as string;

    const raw = req.body?.readings;
    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ error: 'readings must be a non-empty array of { at, value }' });
      return;
    }
    if (raw.length > BACKFILL_MAX_READINGS) {
      res.status(400).json({ error: `at most ${BACKFILL_MAX_READINGS} readings per call` });
      return;
    }

    const parsed: { at: Date; value: number }[] = [];
    for (const entry of raw) {
      const at = new Date(entry?.at);
      if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
        res.status(400).json({ error: `unparseable instant: ${JSON.stringify(entry?.at)}` });
        return;
      }
      const value = entry?.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        res.status(400).json({ error: `value must be a finite number, got ${JSON.stringify(value)}` });
        return;
      }
      parsed.push({ at, value });
    }

    const instants = new Set(parsed.map(r => r.at.getTime()));
    if (instants.size !== parsed.length) {
      res.status(400).json({ error: 'two readings at the same instant' });
      return;
    }

    const [metric] = await db
      .select({ id: metrics.id, name: metrics.name })
      .from(metrics)
      .where(and(eq(metrics.id, metricId), eq(metrics.workspaceId, workspaceId)));
    if (!metric) {
      res.status(404).json({ error: 'Metric not found' });
      return;
    }

    const [settled] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(and(eq(markets.metricId, metricId), eq(markets.workspaceId, workspaceId), eq(markets.resolved, true)))
      .limit(1);
    if (settled) {
      res
        .status(409)
        .json({ error: 'this metric has a resolved market; its history is evidence and takes no backfill' });
      return;
    }

    const [oldest] = await db
      .select({ timestamp: metricLogs.timestamp })
      .from(metricLogs)
      .where(and(eq(metricLogs.metricId, metricId), eq(metricLogs.workspaceId, workspaceId)))
      .orderBy(asc(metricLogs.timestamp))
      .limit(1);
    if (oldest) {
      const boundary = new Date(oldest.timestamp).getTime();
      const tooRecent = parsed.filter(r => r.at.getTime() >= boundary);
      if (tooRecent.length > 0) {
        res.status(400).json({
          error: `every reading must be older than this metric's oldest reading (${new Date(boundary).toISOString()}); ${tooRecent.length} of ${parsed.length} were not`,
        });
        return;
      }
    }

    await db.insert(metricLogs).values(
      parsed.map(r => ({
        id: randomUUID(),
        workspaceId,
        metricId,
        metricName: metric.name,
        value: r.value,
        outlook: r.value,
        timestamp: r.at,
      })),
    );

    const times = parsed.map(r => r.at.getTime()).sort((a, b) => a - b);
    res.json({
      written: parsed.length,
      oldest: new Date(times[0]).toISOString(),
      newest: new Date(times[times.length - 1]).toISOString(),
    });
  }),
);

// Purge metric_logs. Useful as a one-off reset when the logging semantic
// changes (e.g. we switched leaf logs from total → value). Body { metricId }
// scopes the purge to one metric; omit to wipe every log in the workspace.
// Returns { deleted: number }. Admin-only.
metricsRouter.post(
  '/logs/purge',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const metricId = typeof req.body?.metricId === 'string' ? req.body.metricId : undefined;
    const whereClause = metricId
      ? and(eq(metricLogs.workspaceId, workspaceId), eq(metricLogs.metricId, metricId))
      : eq(metricLogs.workspaceId, workspaceId);
    const result = await db.delete(metricLogs).where(whereClause);
    res.json({ deleted: result.rowCount ?? 0, scope: metricId ? 'metric' : 'workspace' });
  }),
);

metricsRouter.post(
  '/',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const {
      name,
      description = '',
      value = 0,
      formula = '0',
      timePreference,
      marketRangeMax,
      resetsEvery,
      resolvesNaUntilMeasured,
    } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const naUntilMeasured = parseNaUntilMeasured(resolvesNaUntilMeasured);
    if (naUntilMeasured instanceof Error) {
      res.status(400).json({ error: naUntilMeasured.message });
      return;
    }
    const resets = parseResetsEvery(resetsEvery);
    if (resets instanceof Error) {
      res.status(400).json({ error: resets.message });
      return;
    }
    if (marketRangeMax !== undefined && (typeof marketRangeMax !== 'number' || marketRangeMax <= 0)) {
      res.status(400).json({ error: 'marketRangeMax must be a positive number' });
      return;
    }

    const tp = parseTimePreference(timePreference);
    if (tp instanceof Error) {
      res.status(400).json({ error: tp.message });
      return;
    }
    // Default TP to enabled (half-life 1 year) unless explicitly provided
    const effectiveTP: TimePreference | null = tp !== undefined ? storableTP(tp) : { enabled: true, halfLife: 1 };

    const isLeaf = !formula || formula.trim() === '0';
    if (marketRangeMax !== undefined && !isLeaf) {
      res.status(400).json({ error: 'marketRangeMax can only be set on leaf metrics (no formula)' });
      return;
    }

    const isDefinition = formula && formula.trim() !== '0';
    const id = randomUUID();

    await db.insert(metrics).values({
      id,
      workspaceId,
      name,
      value: isDefinition ? 0 : value || 0,
      formula,
      description,
      order: 999,
      timePreference: effectiveTP,
      marketRangeMax: marketRangeMax ?? 1000,
      resetsEvery: resets ?? null,
      resolvesNaUntilMeasured: naUntilMeasured ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const warnings: string[] = [];

    // If ancestor already has TP, suppress this metric's curve (parent overrides).
    // Custom horizons are explicit user choices and survive the demotion.
    if (effectiveTP?.enabled) {
      const ancestorConflict = await findTPAncestorConflict(id, workspaceId);
      if (ancestorConflict) {
        const demoted = storableTP({ ...effectiveTP, enabled: false });
        await db
          .update(metrics)
          .set({ timePreference: demoted, updatedAt: new Date() })
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
    // A metric that resolves N/A until measured has no reading at creation:
    // its markets must void, not settle on the default 0 (the creation log
    // counted as a reading on 2026-08-25 and would have paid "$0 valuation").
    if (!naUntilMeasured) {
      await svc.logSpecificMetrics(getAffectedMetrics([id], allMetrics), allMetrics, workspaceId);
    }

    res.status(201).json({ ok: true, id, warnings });
  }),
);

metricsRouter.put(
  '/:id',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const id = req.params.id as string;
    const {
      oldValue,
      updateNote = '',
      timePreference: rawTP,
      resetsEvery: rawResets,
      resolvesNaUntilMeasured: rawNa,
      ...fields
    } = req.body;
    const newNa = parseNaUntilMeasured(rawNa);
    if (newNa instanceof Error) {
      res.status(400).json({ error: newNa.message });
      return;
    }

    const newTP = parseTimePreference(rawTP);
    if (newTP instanceof Error) {
      res.status(400).json({ error: newTP.message });
      return;
    }
    const newResets = parseResetsEvery(rawResets);
    if (newResets instanceof Error) {
      res.status(400).json({ error: newResets.message });
      return;
    }

    if (
      fields.marketRangeMax !== undefined &&
      (typeof fields.marketRangeMax !== 'number' || fields.marketRangeMax <= 0)
    ) {
      res.status(400).json({ error: 'marketRangeMax must be a positive number' });
      return;
    }
    // marketRangeMax leaf-only check happens after oldRow is fetched (effectiveFormula needed)

    // What a NEW market on this metric opens with (docs/owner-on-the-floor.md). null
    // puts the metric back on the workspace default; it never touches a market
    // that is already open, which is what the page tells the owner.
    const hasCredits = Object.prototype.hasOwnProperty.call(fields, 'liquidityCredits');
    if (hasCredits && fields.liquidityCredits !== null) {
      const v = fields.liquidityCredits;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        res
          .status(400)
          .json({ error: 'liquidityCredits must be a non-negative number, or null for the workspace default' });
        return;
      }
      // The add-date dialog promises "leaves your balance the moment it
      // opens". When the balance cannot keep that promise, refuse HERE with
      // both numbers rather than opening an unfunded market that answers
      // every trade with "no liquidity" (owner report 2026-08-28: "why cant
      // i trade on it?"). Lowering the number is always allowed.
      if (v > 0) {
        const ownerId = await resolveWorkspaceOwnerAgentId(workspaceId);
        const [owner] = ownerId
          ? await db
              .select({ balance: agents.balance, liquidityBalance: agents.liquidityBalance })
              .from(agents)
              .where(eq(agents.id, ownerId))
          : [];
        // What can go into a POOL: the bought liquidity wallet plus the
        // tradeable balance, in the order an injection spends them
        // (lib/validation, two currencies since 2026-08-28). Reading
        // `balance` alone refused an owner sitting on a funded wallet.
        const balance = fromUnits(owner ? liquiditySpendableUnits(owner) : 0);
        if (balance < v) {
          res.status(400).json({
            error: `You hold ${Math.floor(balance).toLocaleString('en-US')} credits and this market would open with ${Math.round(v).toLocaleString('en-US')}. Lower the liquidity, or top up first.`,
          });
          return;
        }
      }
    }

    const allowed = ['name', 'description', 'value', 'formula', 'marketRangeMax'] as const;
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (fields[key] !== undefined) update[key] = fields[key];
    }
    if (hasCredits) update.liquidityCredits = fields.liquidityCredits;
    if (Object.keys(update).length === 0 && rawTP === undefined && newResets === undefined && newNa === undefined) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const [oldRow] = await db
      .select()
      .from(metrics)
      .where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));
    if (!oldRow) {
      res.status(404).json({ error: 'Metric not found' });
      return;
    }

    const oldTP = (oldRow.timePreference as TimePreference | null) ?? undefined;

    const effectiveFormula = (update.formula as string | undefined) ?? oldRow.formula ?? '0';
    const effectiveName = (update.name as string | undefined) ?? oldRow.name;

    const effectiveIsLeaf = !effectiveFormula || effectiveFormula.trim() === '0';
    if (update.marketRangeMax !== undefined && !effectiveIsLeaf) {
      res.status(400).json({ error: 'marketRangeMax can only be set on leaf metrics (no formula)' });
      return;
    }

    if (update.formula) {
      const allMetrics = await svc.getAllMetrics(workspaceId);
      if (detectCircularDependency(id, update.formula as string, allMetrics)) {
        res.status(400).json({ error: 'This formula would create a circular dependency' });
        return;
      }
    }

    const wasTPEnabled = oldTP?.enabled ?? false;
    const isTPEnabled = newTP !== undefined ? (newTP?.enabled ?? false) : wasTPEnabled;
    if (isTPEnabled && !wasTPEnabled) {
      const ancestorConflict = await findTPAncestorConflict(id, workspaceId);
      if (ancestorConflict) {
        res.status(400).json({
          error: `Cannot enable time preference: ancestor "${ancestorConflict}" already has time preference on this path`,
        });
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
    // hasOwnProperty, not !== undefined: null is the meaningful value here
    // (back to the workspace default), and it must reach the column.
    if (Object.prototype.hasOwnProperty.call(update, 'liquidityCredits'))
      dbUpdate.liquidityCredits = update.liquidityCredits as number | null;
    if (newResets !== undefined) dbUpdate.resetsEvery = newResets;
    if (newNa !== undefined) dbUpdate.resolvesNaUntilMeasured = newNa;
    dbUpdate.updatedAt = new Date();

    const isLeafMetric = !effectiveFormula || effectiveFormula.trim() === '0';

    // The machinery half of the definition (owner decision 2026-08-18): the
    // formula that computes the number, and the range the price lives inside.
    // A market stores its own rangeMin/rangeMax and prices inside them, so
    // changing the metric's range while a market is open makes the floor's
    // stated range and the traded range disagree with nothing on screen saying
    // so. Rather than void-and-respawn (the old behaviour) or sync-and-hope,
    // the edit is simply refused while a market is open. Nothing is destroyed
    // and nothing silently diverges; get the range right before opening, or
    // wait for the market to settle.
    const settlementFields = settlementFieldChanges(oldRow, update, effectiveFormula);
    // Refused while anyone is in the market, respawned while nobody is
    // (docs/market-integrity.md). A traded market's range cannot move under
    // its positions; an untraded book protects nobody, so it is voided (its
    // pool refunds to its funders) and respawned below at the new machinery.
    // This is what lets a metric be created from a name and a description
    // alone and get its range right before the first trade.
    let respawnAfterMachineryChange = false;
    if (settlementFields.length > 0) {
      const openMarkets = await db
        .select({ id: markets.id, targetDate: markets.targetDate })
        .from(markets)
        .where(and(eq(markets.workspaceId, workspaceId), eq(markets.metricId, id), eq(markets.resolved, false)));
      if (openMarkets.length > 0) {
        const [traded] = await db
          .select({ id: trades.id, marketId: trades.marketId })
          .from(trades)
          .where(
            and(
              eq(trades.workspaceId, workspaceId),
              inArray(
                trades.marketId,
                openMarkets.map(m => m.id),
              ),
            ),
          )
          .limit(1);
        if (traded) {
          const openMarket = openMarkets.find(m => m.id === traded.marketId) ?? openMarkets[0];
          res.status(409).json({
            error:
              `Cannot change ${settlementFields.join(' or ')} while a market on this metric has trades: ` +
              'that is what the open market settles on. Wait for it to resolve, or void it deliberately first.',
            fields: settlementFields,
            openMarketId: openMarket.id,
            targetDate: openMarket.targetDate,
          });
          return;
        }
        await voidOpenMarketsForMetrics(new Set([id]), workspaceId);
        respawnAfterMachineryChange = true;
      }
    }

    await db.transaction(async tx => {
      await tx
        .update(metrics)
        .set(dbUpdate)
        .where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));

      if (isLeafMetric && oldValue !== undefined && update.value !== undefined && oldValue !== update.value) {
        await tx.insert(updates).values({
          id: randomUUID(),
          workspaceId,
          metricName: effectiveName,
          oldValue,
          newValue: update.value as number,
          description: updateNote || 'Value updated',
          timestamp: new Date(),
        });
      }
    });

    const [updated] = await db
      .select()
      .from(metrics)
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
    const effectiveTPRecord: TimePreference | null = rawTP !== undefined ? storableTP(newTP) : (oldTP ?? null);

    // Unified reconcile: deactivate dates the old config wanted but the new one
    // doesn't, then ensure the new desired set (creates missing markets and
    // reactivates inactive-but-desired ones). Covers enable, disable, curve
    // parameter changes, custom horizon edits, and explicit clear alike.
    if (rawTP !== undefined || respawnAfterMachineryChange) {
      const oldDesired = generatesMarkets(oldTP) ? desiredMarketDates(oldTP) : [];
      const newDesired = generatesMarkets(effectiveTPRecord)
        ? new Set(desiredMarketDates(effectiveTPRecord))
        : new Set<string>();
      const staleDates = oldDesired.filter(d => !newDesired.has(d));
      if (staleDates.length > 0) {
        await deactivateLeafMarketsForTPMetric(id, staleDates, workspaceId);
      }
      if (generatesMarkets(effectiveTPRecord)) {
        await svc.ensureMarketsForTimePreference(id, effectiveTPRecord, workspaceId);
      }
    }

    // Editing a definition no longer voids the market it settles (owner
    // direction 2026-08-18; governing doc docs/market-integrity.md).
    //
    // The old invariant was "a market may only exist while its metric's
    // definition is unchanged", enforced by voiding every open market on ANY
    // edit to name, description, formula or range, refunding every position and
    // respawning fresh. That was defensible when nothing was at stake. With a
    // prize season running it is the wrong trade: rewording one sentence
    // destroyed a week of price discovery and every position in it, which made
    // routine copy-editing a destructive act nobody could safely perform.
    //
    // What replaces it splits the four fields by what they actually are.
    // `name` and `description` are words: nothing computes from them, so they
    // are free to change and every change is written to the append-only
    // revision log, rendered on the floor beside the definition. No code can
    // tell a clarification from a redefinition, so the answer is disclosure,
    // not prevention. `formula` and `marketRangeMax` are machinery, and they
    // are refused above while a market is open rather than voided.
    const textChanged = isTextDefinitionChange(oldRow, update);
    if (textChanged) {
      await recordDefinitionRevisions(id, workspaceId, oldRow, update, revisionAuthor(req));
    }

    // Markets carry the metric's name denormalised (it is what the floor, the
    // share image and every notification render), so a rename that no longer
    // voids has to reach the open markets or they show the old name forever.
    if (update.name !== undefined && update.name !== oldRow.name) {
      await db
        .update(markets)
        .set({ metricName: update.name as string })
        .where(and(eq(markets.workspaceId, workspaceId), eq(markets.metricId, id), eq(markets.resolved, false)));
    }

    const allMetrics = await svc.getAllMetrics(workspaceId);
    // A reading is logged only when this update actually moved the number: a new
    // value, or a formula whose result changes. A rename, a description, a range
    // or a time-preference edit is not a measurement, and logging one fabricates
    // history: renaming the weekly LookPilot metric on a Monday morning stamped
    // last week's $1,179.72 total as a reading inside the new week, which is
    // exactly what the resetsEvery rule exists to keep off the chart
    // (2026-08-17).
    if (update.value !== undefined || update.formula !== undefined) {
      await svc.logSpecificMetrics(getAffectedMetrics([id], allMetrics), allMetrics, workspaceId);
    }
    if (update.value !== undefined) {
      const metric = allMetrics.find(m => m.id === id);
      if (!metric) {
        console.error(`emitEvent: metric ${id} not found after update`);
      } else
        emitEvent(
          'metric:updated',
          { metricId: id, metricName: metric.name, oldValue: oldValue ?? null, newValue: update.value },
          workspaceId,
        ).catch(e => console.error('emitEvent failed:', e));
    }
  }),
);

metricsRouter.delete(
  '/:id',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const id = req.params.id as string;
    const [row] = await db
      .select()
      .from(metrics)
      .where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));
    if (!row) {
      res.status(404).json({ error: 'Metric not found' });
      return;
    }

    // Deleting the metric voids its open markets, so it is refused for the same
    // reason the void endpoint is: it takes money off whoever put it in
    // (docs/market-integrity.md).
    await assertMetricMarketsUntraded(id, workspaceId);

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
        const [tpRow] = await db
          .select({ timePreference: metrics.timePreference })
          .from(metrics)
          .where(and(eq(metrics.id, tpId), eq(metrics.workspaceId, workspaceId)));
        const tpRecord = tpRow?.timePreference as TimePreference | null;
        if (generatesMarkets(tpRecord)) await svc.respawnMarketsForTimePreference(tpId, tpRecord, workspaceId);
      }
    }
  }),
);

// Reorder metrics within their depth level. Body: { ids: string[] } — an
// ordered list of metric ids belonging to the same depth. The metric at index 0
// gets `order = 0`, index 1 gets `order = 1`, etc. Ids that don't belong to the
// workspace are ignored. Returns { updated: number }. Admin-only because order
// is a workspace-level setting, not a per-participant view.
metricsRouter.post(
  '/reorder',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
      res.status(400).json({ error: 'ids must be an array of metric id strings' });
      return;
    }
    if (ids.length === 0) {
      res.json({ updated: 0 });
      return;
    }

    const rows = await db.select({ id: metrics.id }).from(metrics).where(eq(metrics.workspaceId, workspaceId));
    const known = new Set(rows.map(r => r.id));
    const filtered = ids.filter(id => known.has(id));

    // 1-based: existing sort sites use `order || 999`, so order=0 would silently
    // sort to the bottom. Index from 1 to dodge that legacy falsy-zero trap.
    await db.transaction(async tx => {
      for (let i = 0; i < filtered.length; i++) {
        await tx
          .update(metrics)
          .set({ order: i + 1, updatedAt: new Date() })
          .where(and(eq(metrics.id, filtered[i]), eq(metrics.workspaceId, workspaceId)));
      }
    });

    res.json({ updated: filtered.length });
  }),
);

metricsRouter.post(
  '/migrate-leaf-types',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const rows = await db.select().from(metrics).where(eq(metrics.workspaceId, workspaceId));
    let updated = 0;
    for (const row of rows) {
      if ((row.formula ?? '0').trim() !== '0' && row.value !== 0) {
        await db
          .update(metrics)
          .set({ value: 0 })
          .where(and(eq(metrics.id, row.id), eq(metrics.workspaceId, workspaceId)));
        updated++;
      }
    }
    res.json({ updated });
  }),
);

// --- Helpers ---

const MAX_CUSTOM_HORIZONS = 24;

/**
 * The periods a metric may restart on. NULL (absent) means it never does: the
 * number accumulates or is a level, and its whole history is one trajectory.
 * Exported so the frontend picker and the tests read the same list.
 */
export const RESET_PERIODS = ['hour', 'day', 'week', 'month', 'year'] as const;
export type ResetPeriod = (typeof RESET_PERIODS)[number];

/** `undefined` = field absent (no change); `null` = declared non-resetting. */
export function parseResetsEvery(raw: unknown): ResetPeriod | null | undefined | Error {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !(RESET_PERIODS as readonly string[]).includes(raw)) {
    return new Error(`resetsEvery must be null or one of ${RESET_PERIODS.join(', ')}`);
  }
  return raw as ResetPeriod;
}
/**
 * Parse `resolvesNaUntilMeasured`. `undefined` = field absent (no change).
 * A market on a never-measured metric voids instead of settling on the
 * default 0 (docs/ui-conventions.md, "A market on a number that does not
 * exist yet"); like resetsEvery, changing it never voids an open market by
 * itself, it only changes what happens at the instant.
 */
export function parseNaUntilMeasured(raw: unknown): boolean | undefined | Error {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') return new Error('resolvesNaUntilMeasured must be a boolean');
  return raw;
}
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
          return new Error(
            `invalid custom horizon "${entry}": use +Nh / +Nd / +Nw / +Nm / +Ny or YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD, YYYY-MM-DDTHH (UTC)`,
          );
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
  return tp.enabled || (tp.customHorizons?.length ?? 0) > 0 ? tp : null;
}

/**
 * The words half of the definition: safe to change while a market is open.
 *
 * Nothing computes from a name or a description. They are what a reader is
 * told the market means, which is why every change to them is logged rather
 * than blocked (docs/market-integrity.md).
 */
function isTextDefinitionChange(oldRow: typeof metrics.$inferSelect, update: Record<string, unknown>): boolean {
  if (update.name !== undefined && update.name !== oldRow.name) return true;
  if (update.description !== undefined && update.description !== oldRow.description) return true;
  return false;
}

/**
 * The machinery half: what an open market actually settles on.
 *
 * Returns the human-readable field names that changed, so the refusal can
 * name them. `value` counts only on a computed metric, where setting it by
 * hand overrides what the formula produces and therefore redefines the number
 * the market resolves against; on a leaf metric a new value IS the
 * measurement and is always allowed.
 */
function settlementFieldChanges(
  oldRow: typeof metrics.$inferSelect,
  update: Record<string, unknown>,
  effectiveFormula: string,
): string[] {
  const changed: string[] = [];
  if (update.formula !== undefined && update.formula !== (oldRow.formula ?? '0')) changed.push('the formula');
  if (update.marketRangeMax !== undefined && update.marketRangeMax !== oldRow.marketRangeMax)
    changed.push('the market range');
  const isLeaf = !effectiveFormula || effectiveFormula.trim() === '0';
  if (!isLeaf && update.value !== undefined && update.value !== oldRow.value) changed.push('the computed value');
  return changed;
}

/** Who saved the edit, for the revision row. Agent id, else auth user id. */
function revisionAuthor(req: { auth?: { agentId?: string | null; uid?: string | null } | null }): string | null {
  return req.auth?.agentId ?? req.auth?.uid ?? null;
}

/**
 * One append-only row per changed text field.
 *
 * This is the whole mitigation for letting settlement text change under an
 * open market: a trader can see, on the floor, that the wording moved after
 * they took their position, and when, and to what. A silent edit and a logged
 * edit are very different things even though neither is prevented.
 */
async function recordDefinitionRevisions(
  metricId: string,
  workspaceId: string,
  oldRow: typeof metrics.$inferSelect,
  update: Record<string, unknown>,
  changedBy: string | null,
): Promise<void> {
  const rows: Array<typeof metricDefinitionRevisions.$inferInsert> = [];
  const consider = (field: 'name' | 'description', oldValue: string | null) => {
    if (update[field] === undefined || update[field] === oldValue) return;
    rows.push({
      id: randomUUID(),
      workspaceId,
      metricId,
      field,
      oldValue,
      newValue: (update[field] as string | null) ?? null,
      changedBy,
    });
  };
  consider('name', oldRow.name);
  consider('description', oldRow.description ?? null);
  if (rows.length > 0) await db.insert(metricDefinitionRevisions).values(rows);
}

async function getAllMetricRows(workspaceId: string) {
  return db
    .select()
    .from(metrics)
    .where(eq(metrics.workspaceId, workspaceId))
    .orderBy(asc(metrics.order), asc(metrics.createdAt));
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
      await db
        .update(metrics)
        .set({ timePreference: demoted, updatedAt: new Date() })
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
async function deactivateLeafMarketsForTPMetric(
  tpMetricId: string,
  staleDates: string[],
  workspaceId: string,
): Promise<void> {
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

  const openMarkets = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  for (const m of openMarkets) {
    if (leafIds.has(m.metricId) && staleSet.has(m.targetDate) && m.active !== false) {
      await db
        .update(markets)
        .set({ active: false })
        .where(and(eq(markets.id, m.id), eq(markets.workspaceId, workspaceId)));
    }
  }
}
