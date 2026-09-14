/**
 * The agent watchdog (docs/infra/deploy.md, "Cron schedule"): emails the
 * owner when a watched house agent stops working, from whatever cause, and
 * again when it works again.
 *
 * It runs inside the app, off the machine the agents run on, because the
 * commonest way for an agent to stop is for that machine to stop, and
 * nothing on it can report that. Three signals, each catching what the
 * others cannot: a report older than 30 minutes (machine, unit or network
 * down), a last report that is an error (the unit gave up), and work due
 * but not done (the agent reports idle every cycle while its model, login
 * or membership is broken and it files nothing).
 */
import { and, eq, inArray, isNull, lte, max } from 'drizzle-orm';
import { db } from '../db/client';
import { agentHeartbeats, marketForecasts, markets, systemConfig, workspaces } from '../db/schema';
import { settlesOn } from '../lib/date-utils';
import { sendEmail } from '../lib/notify';
import { publicOrigin } from '../lib/origin';

/** The house agents whose silence the owner has asked to hear about. */
export const WATCHED_AGENTS = ['reference-astra'] as const;

/** The runner reports at least every five minutes; six missed reports is down. */
export const STALE_HEARTBEAT_MS = 30 * 60_000;
/** A market this old with no forecast from the agent is work not done. */
export const DUE_AFTER_MS = 6 * 60 * 60_000;
/** Books that settle sooner than this after opening are skipped by the agent's own rule. */
export const MIN_LIFETIME_MS = 12 * 60 * 60_000;
/** While an agent stays stopped, the owner is reminded this often. */
export const REMIND_EVERY_MS = 24 * 60 * 60_000;

type Status = 'ok' | 'stopped';

interface WatchState {
  status: Status;
  since: string;
  reasons: string[];
  lastAlertAt: string | null;
}

export interface WatchResult {
  agentId: string;
  status: Status;
  reasons: string[];
  mailed: 'stopped' | 'reminder' | 'recovered' | null;
}

const stateKey = (agentId: string) => `agent_watchdog:${agentId}`;

async function readState(agentId: string): Promise<WatchState | null> {
  const [row] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, stateKey(agentId)));
  return (row?.value as WatchState | undefined) ?? null;
}

async function writeState(agentId: string, value: WatchState): Promise<void> {
  await db
    .insert(systemConfig)
    .values({ key: stateKey(agentId), value })
    .onConflictDoUpdate({ target: systemConfig.key, set: { value } });
}

/** Open floor books on public workspaces the agent should have forecast and has not. */
async function dueWithoutForecast(agentId: string, now: Date) {
  const openedBefore = new Date(now.getTime() - DUE_AFTER_MS);
  const candidates = await db
    .select({
      id: markets.id,
      metricName: markets.metricName,
      targetDate: markets.targetDate,
      settlesAt: markets.settlesAt,
      createdAt: markets.createdAt,
      workspaceName: workspaces.name,
    })
    .from(markets)
    .innerJoin(workspaces, eq(workspaces.id, markets.workspaceId))
    .where(
      and(
        eq(workspaces.visibility, 'public'),
        // Floor books only: the agent's market list leaves proposals' books out.
        isNull(markets.proposalId),
        eq(markets.active, true),
        eq(markets.resolved, false),
        eq(markets.voided, false),
        lte(markets.createdAt, openedBefore),
      ),
    );
  const longLived = candidates.filter(m => {
    const settles = new Date(settlesOn(m)).getTime();
    return Number.isFinite(settles) && settles - m.createdAt.getTime() >= MIN_LIFETIME_MS;
  });
  if (longLived.length === 0) return [];
  const forecast = await db
    .selectDistinct({ marketId: marketForecasts.marketId })
    .from(marketForecasts)
    .where(
      and(
        eq(marketForecasts.agentId, agentId),
        inArray(
          marketForecasts.marketId,
          longLived.map(m => m.id),
        ),
      ),
    );
  const done = new Set(forecast.map(f => f.marketId));
  return longLived.filter(m => !done.has(m.id));
}

function mailText(agentId: string, s: WatchState, lastReport: string, lastForecast: string): string {
  return [
    `${agentId}, a house forecaster on ${publicOrigin()}, stopped working at ${s.since}.`,
    '',
    'Why:',
    ...s.reasons.map(r => `- ${r}`),
    '',
    `Last report: ${lastReport}`,
    `Last forecast filed: ${lastForecast}`,
    '',
    `Where to look: the runner's reports are on ${publicOrigin()}/agents; the machine and unit it runs on are in the agent-economy operations doc (docs/operations.md).`,
    'This mail repeats once a day while it stays stopped, and one more comes when it works again.',
  ].join('\n');
}

async function watchOne(agentId: string, now: Date): Promise<WatchResult> {
  const [hb] = await db.select().from(agentHeartbeats).where(eq(agentHeartbeats.agentId, agentId));
  const [last] = await db
    .select({ at: max(marketForecasts.createdAt) })
    .from(marketForecasts)
    .where(eq(marketForecasts.agentId, agentId));

  const reasons: string[] = [];
  if (!hb) {
    reasons.push('it has never reported');
  } else {
    const age = now.getTime() - hb.updatedAt.getTime();
    if (age >= STALE_HEARTBEAT_MS) {
      reasons.push(`it has not reported for ${Math.floor(age / 60_000)} minutes`);
    }
    if (hb.status === 'error') {
      reasons.push(`its last report is an error: ${hb.lastError?.trim() || '(no error text)'}`);
    }
  }
  const due = await dueWithoutForecast(agentId, now);
  if (due.length > 0) {
    const e = due[0];
    const k = due.length;
    reasons.push(
      `${k} open market${k === 1 ? '' : 's'} opened more than 6 hours ago carr${k === 1 ? 'ies' : 'y'} no forecast from it, for example ${e.metricName} ${e.targetDate} on ${e.workspaceName}`,
    );
  }

  const status: Status = reasons.length > 0 ? 'stopped' : 'ok';
  const prev = await readState(agentId);
  const to = process.env.OWNER_NOTIFY_EMAIL ?? '';
  const nowIso = now.toISOString();
  const lastReport = hb ? `${hb.updatedAt.toISOString()} (status ${hb.status})` : 'never';
  const lastForecast = last?.at ? last.at.toISOString() : 'none';

  if (status === 'stopped') {
    const since = prev?.status === 'stopped' ? prev.since : nowIso;
    let kind: 'stopped' | 'reminder' | null = null;
    if (prev?.status !== 'stopped' || !prev.lastAlertAt) kind = 'stopped';
    else if (now.getTime() - new Date(prev.lastAlertAt).getTime() >= REMIND_EVERY_MS) kind = 'reminder';

    const next: WatchState = {
      status,
      since,
      reasons,
      lastAlertAt: prev?.status === 'stopped' ? prev.lastAlertAt : null,
    };
    let mailed: WatchResult['mailed'] = null;
    if (kind && to) {
      const subject = kind === 'stopped' ? `${agentId} stopped working` : `${agentId} is still stopped`;
      // A refused mail is not recorded as sent, so the next run tries again.
      if (await sendEmail(to, subject, mailText(agentId, next, lastReport, lastForecast))) {
        next.lastAlertAt = nowIso;
        mailed = kind;
      }
    }
    await writeState(agentId, next);
    return { agentId, status, reasons, mailed };
  }

  let mailed: WatchResult['mailed'] = null;
  if (prev?.status === 'stopped' && prev.lastAlertAt && to) {
    const text = [
      `${agentId} is working again as of ${nowIso}; it had been stopped since ${prev.since}.`,
      '',
      `Last report: ${lastReport}`,
      `Last forecast filed: ${lastForecast}`,
    ].join('\n');
    if (await sendEmail(to, `${agentId} is working again`, text)) mailed = 'recovered';
  }
  await writeState(agentId, {
    status,
    since: prev?.status === 'ok' ? prev.since : nowIso,
    reasons: [],
    lastAlertAt: null,
  });
  return { agentId, status, reasons, mailed };
}

/** One pass over every watched agent. */
export async function runAgentWatchdog(now: Date = new Date()): Promise<WatchResult[]> {
  const out: WatchResult[] = [];
  for (const agentId of WATCHED_AGENTS) out.push(await watchOne(agentId, now));
  return out;
}
