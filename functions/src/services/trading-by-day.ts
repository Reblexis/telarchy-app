import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * The trading behind the trader count, day by day.
 *
 * Spec: docs/data-room.md, "How the page draws things". The pulse says how
 * many trades happened this week and the window says who is near the line;
 * neither says whether the place is getting busier, which is what somebody
 * pricing next month's trader count is actually asking.
 *
 * Public workspaces only, the same boundary every other published number
 * keeps. A redemption is bookkeeping rather than a trade anyone placed, and a
 * sell is trading exactly like a buy, so credits are absolute cost over
 * non-redemption rows: the same arithmetic the trader metric counts with.
 *
 * Every UTC date touched by the query has a row, including quiet days.
 * The first and last dates can be partial; dates outside coverage are absent.
 */

const DAYS = 120;

export interface TradingByDay {
  byDay: Array<{ day: string; trades: number; credits: number; traders: number }>;
}

export async function buildTradingByDay(now = new Date()): Promise<TradingByDay> {
  const from = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);
  const res = await db.execute(sql`
    select to_char(t.created_at, 'YYYY-MM-DD') as "day",
           count(*)::int as "trades",
           coalesce(sum(abs(t.cost)), 0)::float as "credits",
           count(distinct t.agent_id)::int as "traders"
    from trades t
    join workspaces w on w.id = t.workspace_id
    where w.visibility = 'public'
      and t.kind <> 'redeem'
      and t.created_at > ${from}
      and t.created_at <= ${now}
    group by 1
    order by 1 asc
  `);
  const rows = ((res as unknown as { rows?: Array<{ day: string; trades: number; credits: number; traders: number }> })
    .rows ?? []) as Array<{ day: string; trades: number; credits: number; traders: number }>;
  const byDate = new Map(rows.map(r => [r.day, r]));
  const byDay: TradingByDay['byDay'] = [];
  const day = new Date(from);
  day.setUTCHours(0, 0, 0, 0);
  for (; day <= now; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    const row = byDate.get(date);
    byDay.push({
      day: date,
      trades: Number(row?.trades ?? 0),
      credits: Math.round(Number(row?.credits ?? 0) * 100) / 100,
      traders: Number(row?.traders ?? 0),
    });
  }
  return { byDay };
}
