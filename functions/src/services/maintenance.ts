/**
 * Daily data hygiene, in one singleton job (server.ts schedules it at
 * 00:20 UTC behind the `dailyMaintenance` advisory lock).
 *
 * Everything here used to happen either on a read path or not at all:
 *  - page_visits older than 30 days were DELETEd inside every
 *    GET /api/admin/floor-stats request (a write on a read, paid by the
 *    person opening the cockpit);
 *  - floor_questions IP/country were scrubbed inside GET /api/admin/questions
 *    the same way (the response itself now masks anything the job has not
 *    reached yet, so the privacy window holds either way);
 *  - agent_traces had NO retention at all and reached 2.9 GB / 426k rows on
 *    a db-f1-micro before 2026-08-20.
 *
 * Traces delete in chunks: one unbounded DELETE over hundreds of thousands
 * of rows holds locks and bloats WAL in a single burst; 5000-row bites do
 * the same work invisibly. The chunk loop is bounded so a bug can never
 * spin forever.
 */

import { lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { agentTraces, floorQuestions, pageVisits } from '../db/schema';

/** Visit rows and question IPs: the privacy policy's 30-day window. */
export const VISIT_RETENTION_DAYS = 30;
/** Traces are operational telemetry; 90 days covers every season retro. */
export const TRACE_RETENTION_DAYS = 90;

const TRACE_DELETE_CHUNK = 5_000;
const MAX_CHUNKS_PER_RUN = 200;

export async function runDailyMaintenance(): Promise<{
  visitsDeleted: number;
  questionsScrubbed: number;
  tracesDeleted: number;
}> {
  const now = Date.now();
  const visitCutoff = new Date(now - VISIT_RETENTION_DAYS * 24 * 3600 * 1000);
  const traceCutoff = new Date(now - TRACE_RETENTION_DAYS * 24 * 3600 * 1000);

  // RETURNING everywhere: row counts read the same on node-postgres and on
  // the pglite test harness, where driver rowCount shapes differ.
  const visits = await db.delete(pageVisits).where(lt(pageVisits.ts, visitCutoff)).returning({ id: pageVisits.id });

  const questions = await db
    .update(floorQuestions)
    .set({ ip: null, country: null })
    .where(lt(floorQuestions.createdAt, visitCutoff))
    .returning({ id: floorQuestions.id });

  let tracesDeleted = 0;
  for (let i = 0; i < MAX_CHUNKS_PER_RUN; i++) {
    const res = await db.execute(sql`
      delete from ${agentTraces} where id in (
        select id from ${agentTraces}
        where ${agentTraces.startedAt} < ${traceCutoff}
        limit ${TRACE_DELETE_CHUNK}
      ) returning id`);
    const n = res.rows?.length ?? 0;
    tracesDeleted += n;
    if (n < TRACE_DELETE_CHUNK) break;
  }

  return {
    visitsDeleted: visits.length,
    questionsScrubbed: questions.length,
    tracesDeleted,
  };
}
