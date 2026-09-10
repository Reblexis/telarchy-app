import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { buildActions, KINDS } from '../services/actions';
async function main() {
  const q = async (s: string) => { const r: any = await db.execute(sql.raw(s)); return (r.rows ?? r)[0]; };
  const pub = "(select id from workspaces where visibility='public')";
  const expected: Record<string, number> = {
    trade: Number((await q(`select count(*) n from trades where kind='trade' and workspace_id in ${pub}`)).n),
    tradeNoMarket: Number((await q(`select count(*) n from trades t where t.kind='trade' and t.workspace_id in ${pub} and not exists (select 1 from markets m where m.id=t.market_id and m.workspace_id=t.workspace_id)`)).n),
    proposal: Number((await q(`select (select count(*) from proposals where status<>'removed' and workspace_id in ${pub}) + (select count(*) from proposal_revisions r join proposals p on p.id=r.proposal_id where p.status<>'removed' and r.workspace_id in ${pub}) n`)).n),
    decision: Number((await q(`select count(*) n from proposals where workspace_id in ${pub} and status in ('approved','declined','declined_spam','lapsed','withdrawn') and coalesce(case when status='lapsed' then coalesce(lapsed_at, closed_at, resolved_at) when status='withdrawn' then coalesce(closed_at, resolved_at) else resolved_at end) is not null`)).n),
    decisionNoAt: Number((await q(`select count(*) n from proposals where workspace_id in ${pub} and status in ('approved','declined','declined_spam','lapsed','withdrawn') and (case when status='lapsed' then coalesce(lapsed_at, closed_at, resolved_at) when status='withdrawn' then coalesce(closed_at, resolved_at) else resolved_at end) is null`)).n),
    delivery: Number((await q(`select count(*) n from proposals where workspace_id in ${pub} and status<>'removed' and delivered_at is not null`)).n),
    comment: Number((await q(`select (select count(*) from proposal_messages c join proposals p on p.id=c.proposal_id where p.status<>'removed' and c.workspace_id in ${pub}) + (select count(*) from market_messages c join markets m on m.id=c.market_id where c.workspace_id in ${pub}) n`)).n),
    commentOrphan: Number((await q(`select (select count(*) from proposal_messages c where c.workspace_id in ${pub} and not exists (select 1 from proposals p where p.id=c.proposal_id)) + (select count(*) from market_messages c where c.workspace_id in ${pub} and not exists (select 1 from markets m where m.id=c.market_id)) n`)).n),
    announcement: Number((await q(`select count(*) + (select count(*) from announcements where edited_at is not null and workspace_id in ${pub}) n from announcements where workspace_id in ${pub}`)).n),
    reading: Number((await q(`select count(*) n from updates where workspace_id in ${pub}`)).n),
    metric: Number((await q(`select (select count(*) from metrics where workspace_id in ${pub}) + (select count(*) from metric_definition_revisions r join metrics m on m.id=r.metric_id where r.workspace_id in ${pub}) n`)).n),
    metricRevOrphan: Number((await q(`select count(*) n from metric_definition_revisions r where r.workspace_id in ${pub} and not exists (select 1 from metrics m where m.id=r.metric_id)`)).n),
    market: Number((await q(`select (select count(*) from markets where proposal_id is null and workspace_id in ${pub}) + (select count(*) from markets where proposal_id is null and resolved and resolved_at is not null and workspace_id in ${pub}) n`)).n),
    liquidity: Number((await q(`select count(*) n from liquidity_events where type='injection' and agent_id is not null and workspace_id in ${pub}`)).n),
    liquidityOther: Number((await q(`select count(*) n from liquidity_events where workspace_id in ${pub} and not (type='injection' and agent_id is not null)`)).n),
    join: Number((await q(`select count(*) n from agents`)).n),
    link: Number((await q(`select count(*) n from record_links`)).n),
    workspace: Number((await q(`select count(*) n from workspaces where visibility='public'`)).n),
    limitOrders: Number((await q(`select count(*) n from limit_orders where workspace_id in ${pub}`)).n),
    transfers: Number((await q(`select count(*) n from credit_transfers`)).n),
    earnClaims: Number((await q(`select count(*) n from earn_claims`)).n),
    seasonEntries: Number((await q(`select count(*) n from season_entries where entered_at is not null`)).n),
    ownerCalls: Number((await q(`select count(*) n from owner_calls where workspace_id in ${pub}`)).n),
    purchases: Number((await q(`select count(*) n from liquidity_purchases`)).n),
    tradesPrivate: Number((await q(`select count(*) n from trades where kind='trade' and workspace_id not in ${pub}`)).n),
    redeems: Number((await q(`select count(*) n from trades where kind<>'trade'`)).n),
  };
  const got: Record<string, number> = {};
  for (const k of KINDS) {
    let n = 0; let cursor: string | undefined;
    for (let i = 0; i < 400; i++) {
      const page = await buildActions({ kinds: [k.id], limit: 200, cursor });
      n += page.rows.length; cursor = page.next ?? undefined;
      if (!cursor) break;
    }
    got[k.id] = n;
  }
  console.log(JSON.stringify({ expected, got }, null, 1));
  const first = await buildActions({ limit: 12 });
  for (const r of first.rows) console.log(r.at.slice(0, 16), r.kind.padEnd(12), (r.actor?.handle ?? '-').padEnd(18), (r.workspace?.slug ?? '-').padEnd(14), r.text.slice(0, 90));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
