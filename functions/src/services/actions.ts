import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';

/**
 * The public actions log: every public action on Telarchy, newest first, as
 * one filterable list (docs/data-room.md).
 *
 * Nothing is written for the log. Every kind is one branch of a UNION ALL
 * over the tables the product already runs on, each branch filtered and cut
 * to the page size before the union is sorted and cut once more, so a row
 * can never drift from the thing it describes and a page costs one query
 * plus two name lookups. A private floor is excluded at the branch, not at
 * render time, which is what keeps "nothing private leaks" a property of the
 * query rather than of a filter somebody could forget.
 */

export interface ActionKind {
  id: string;
  label: string;
  description: string;
}

/** The vocabulary, in the order the filter bar lists it. A kind here is also
 *  a row in the doc's table, a branch below, a sentence, and a seeded test. */
export const KINDS: readonly ActionKind[] = [
  { id: 'trade', label: 'Trades', description: 'A participant bought or sold shares on a book.' },
  { id: 'proposal', label: 'Proposals', description: 'A proposal was posted, or its title or description edited.' },
  { id: 'decision', label: 'Decisions', description: 'An owner approved or declined a proposal, or it lapsed or was withdrawn.' },
  { id: 'delivery', label: 'Deliveries', description: 'A proposer reported delivery.' },
  { id: 'comment', label: 'Comments', description: 'A message on a proposal or on a book.' },
  { id: 'announcement', label: 'Announcements', description: 'An owner published or edited an announcement.' },
  { id: 'reading', label: 'Readings', description: "A metric's value changed." },
  { id: 'metric', label: 'Metrics', description: 'A metric was added or its definition changed.' },
  { id: 'market', label: 'Books', description: 'A baseline book opened, settled, or was voided.' },
  { id: 'liquidity', label: 'Liquidity', description: 'A participant put liquidity behind a book.' },
  { id: 'join', label: 'Joins', description: 'A participant account was created.' },
  { id: 'link', label: 'Links', description: 'A participant linked a record on another platform.' },
  { id: 'workspace', label: 'Floors', description: 'A public floor opened.' },
];
const KIND_IDS = new Set(KINDS.map(k => k.id));

export interface ActionRow {
  id: string;
  at: string;
  kind: string;
  workspace: { slug: string; name: string } | null;
  actor: { id: string; handle: string } | null;
  text: string;
  detail: Record<string, unknown>;
  href: string;
}

export interface ActionsPage {
  generatedAt: string;
  kinds: ActionKind[];
  workspaces: Array<{ slug: string; name: string }>;
  rows: ActionRow[];
  next: string | null;
}

export interface ActionsQuery {
  kinds?: string[];
  workspace?: string;
  participant?: string;
  after?: Date;
  before?: Date;
  cursor?: string;
  limit?: number;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/**
 * Parse the query string the page and the endpoint share. A typo answers 400
 * naming the parameter: an empty list is a fact about the log, and a mistake
 * is not allowed to look like one.
 */
export function parseActionsQuery(q: Record<string, unknown>): ActionsQuery {
  const str = (k: string): string | undefined => {
    const v = q[k];
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string') throw new AppError(`${k} must be a single value`, 400);
    return v;
  };
  const out: ActionsQuery = {};
  const kinds = str('kinds');
  if (kinds) {
    const ids = kinds.split(',').map(s => s.trim()).filter(Boolean);
    const unknown = ids.filter(id => !KIND_IDS.has(id));
    if (unknown.length) {
      throw new AppError(`kinds: unknown kind "${unknown[0]}"; known kinds are ${[...KIND_IDS].join(', ')}`, 400);
    }
    out.kinds = [...new Set(ids)];
  }
  out.workspace = str('workspace');
  out.participant = str('participant');
  for (const k of ['after', 'before'] as const) {
    const v = str(k);
    if (v === undefined) continue;
    const d = new Date(v);
    if (isNaN(d.getTime())) throw new AppError(`${k} must be an ISO instant`, 400);
    out[k] = d;
  }
  const limit = str('limit');
  if (limit !== undefined) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) throw new AppError('limit must be a whole number of at least 1', 400);
    out.limit = Math.min(n, MAX_LIMIT);
  }
  out.cursor = str('cursor');
  return out;
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  let raw = '';
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new AppError('cursor is not one this log issued', 400);
  }
  const bar = raw.indexOf('|');
  const at = new Date(raw.slice(0, bar));
  const id = raw.slice(bar + 1);
  if (bar < 0 || isNaN(at.getTime()) || !id) throw new AppError('cursor is not one this log issued', 400);
  return { at, id };
}

/** A naive UTC literal for a timestamp-without-zone comparison. */
function utc(d: Date): string {
  return d.toISOString().replace('Z', '');
}

/** Numbers as a reader says them: whole when whole, else two decimals at most. */
function num(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 100) / 100);
}

/** Cut a message to one line of the log. */
function excerpt(s: string, max = 100): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const PROVIDER_NAMES: Record<string, string> = { manifold: 'Manifold', polymarket: 'Polymarket' };

interface RawRow {
  id: string;
  at: string;
  kind: string;
  workspace_id: string | null;
  actor_id: string | null;
  payload: Record<string, any>;
}

/**
 * Build the page.
 *
 * Every branch selects the same six columns; the filters that apply to the
 * whole log (floor, actor, instant, cursor) are the same SQL fragment
 * spliced into each branch, so a branch cannot forget one. A branch whose
 * kind is not asked for is left out of the union entirely.
 */
export async function buildActions(query: ActionsQuery): Promise<ActionsPage> {
  const limit = query.limit ?? DEFAULT_LIMIT;
  const publicFloors = await db
    .select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.visibility, 'public'))
    .orderBy(workspaces.name);
  const floorById = new Map(publicFloors.map(w => [w.id, { slug: w.slug ?? w.id, name: w.name }]));

  let workspaceId: string | undefined;
  if (query.workspace) {
    const hit = publicFloors.find(w => (w.slug ?? w.id) === query.workspace || w.id === query.workspace);
    if (!hit) throw new AppError(`workspace: no public floor "${query.workspace}"`, 400);
    workspaceId = hit.id;
  }

  let actorId: string | undefined;
  if (query.participant) {
    const p = query.participant;
    const [hit] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(sql`${agents.id} = ${p} OR LOWER(${agents.nickname}) = ${p.toLowerCase()}`)
      .limit(1);
    if (!hit) throw new AppError(`participant: no participant "${p}"`, 400);
    actorId = hit.id;
  }

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const kinds = query.kinds ?? KINDS.map(k => k.id);

  const vocabulary = {
    kinds: [...KINDS],
    workspaces: publicFloors.map(w => ({ slug: w.slug ?? w.id, name: w.name })),
  };

  if (publicFloors.length === 0 && kinds.every(k => k !== 'join' && k !== 'link')) {
    return { generatedAt: new Date().toISOString(), ...vocabulary, rows: [], next: null };
  }

  const publicIds = publicFloors.length
    ? sql`(${sql.join(
        publicFloors.map(w => sql`${w.id}`),
        sql`, `,
      )})`
    : sql`(NULL)`;

  /** The filters every branch applies, over the branch's own aliases. */
  const common = (at: SQL, id: SQL, ws: SQL | null, actor: SQL | null): SQL => {
    const parts: SQL[] = [];
    if (ws) parts.push(sql`${ws} IN ${publicIds}`);
    if (workspaceId) parts.push(ws ? sql`${ws} = ${workspaceId}` : sql`FALSE`);
    if (actorId) parts.push(actor ? sql`${actor} = ${actorId}` : sql`FALSE`);
    // Instants travel as naive UTC text and are cast in SQL: the columns are
    // timestamps without a zone, written as UTC, and a Date parameter would
    // be serialised in whatever zone the driver fancies.
    if (query.after) parts.push(sql`${at} > ${utc(query.after)}::timestamp`);
    if (query.before) parts.push(sql`${at} < ${utc(query.before)}::timestamp`);
    if (cursor) parts.push(sql`(${at}, ${id}) < (${utc(cursor.at)}::timestamp, ${cursor.id})`);
    return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
  };
  const take = limit + 1;

  const branches: SQL[] = [];
  const add = (kind: string, body: SQL) => {
    if (kinds.includes(kind)) branches.push(sql`(${body})`);
  };

  add(
    'trade',
    sql`SELECT 'trade:' || t.id AS id, t.created_at AS at, 'trade' AS kind, t.workspace_id, t.agent_id AS actor_id,
      jsonb_build_object('marketId', t.market_id, 'metric', m.metric_name, 'date', m.target_date,
        'direction', t.direction, 'shares', t.shares, 'cost', t.cost,
        'callBefore', t.consensus_before, 'callAfter', t.consensus_after) AS payload
      FROM trades t JOIN markets m ON m.id = t.market_id AND m.workspace_id = t.workspace_id
      WHERE t.kind = 'trade' AND ${common(sql`t.created_at`, sql`'trade:' || t.id`, sql`t.workspace_id`, sql`t.agent_id`)}
      ORDER BY t.created_at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'proposal',
    sql`SELECT 'proposal:' || p.id AS id, p.created_at AS at, 'proposal' AS kind, p.workspace_id, p.proposed_by AS actor_id,
      jsonb_build_object('event', 'posted', 'number', p.number, 'title', p.title, 'askUsd', p.ask_usd) AS payload
      FROM proposals p
      WHERE p.status <> 'removed' AND ${common(sql`p.created_at`, sql`'proposal:' || p.id`, sql`p.workspace_id`, sql`p.proposed_by`)}
      ORDER BY p.created_at DESC, id DESC LIMIT ${take}`,
  );
  add(
    'proposal',
    sql`SELECT 'proposal:' || r.id AS id, r.created_at AS at, 'proposal' AS kind, r.workspace_id, r.changed_by AS actor_id,
      jsonb_build_object('event', 'edited', 'number', p.number, 'title', p.title, 'field', r.field) AS payload
      FROM proposal_revisions r JOIN proposals p ON p.id = r.proposal_id AND p.workspace_id = r.workspace_id
      WHERE p.status <> 'removed' AND ${common(sql`r.created_at`, sql`'proposal:' || r.id`, sql`r.workspace_id`, sql`r.changed_by`)}
      ORDER BY r.created_at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'decision',
    sql`SELECT 'decision:' || p.id AS id, d.at, 'decision' AS kind, p.workspace_id,
      CASE WHEN p.status = 'withdrawn' THEN p.proposed_by WHEN p.status = 'lapsed' THEN NULL ELSE p.resolved_by END AS actor_id,
      jsonb_build_object('number', p.number, 'title', p.title, 'askUsd', p.ask_usd, 'status', p.status, 'reason', p.decline_reason) AS payload
      FROM proposals p
      CROSS JOIN LATERAL (SELECT CASE
        WHEN p.status = 'lapsed' THEN COALESCE(p.lapsed_at, p.closed_at, p.resolved_at)
        WHEN p.status = 'withdrawn' THEN COALESCE(p.closed_at, p.resolved_at)
        ELSE p.resolved_at END AS at) d
      WHERE p.status IN ('approved', 'declined', 'declined_spam', 'lapsed', 'withdrawn') AND d.at IS NOT NULL
        AND ${common(sql`d.at`, sql`'decision:' || p.id`, sql`p.workspace_id`, sql`CASE WHEN p.status = 'withdrawn' THEN p.proposed_by WHEN p.status = 'lapsed' THEN NULL ELSE p.resolved_by END`)}
      ORDER BY d.at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'delivery',
    sql`SELECT 'delivery:' || p.id AS id, p.delivered_at AS at, 'delivery' AS kind, p.workspace_id, p.proposed_by AS actor_id,
      jsonb_build_object('number', p.number, 'title', p.title, 'note', p.delivery_note) AS payload
      FROM proposals p
      WHERE p.status <> 'removed' AND p.delivered_at IS NOT NULL
        AND ${common(sql`p.delivered_at`, sql`'delivery:' || p.id`, sql`p.workspace_id`, sql`p.proposed_by`)}
      ORDER BY p.delivered_at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'comment',
    sql`SELECT 'comment:' || c.id AS id, c.created_at AS at, 'comment' AS kind, c.workspace_id, c."from" AS actor_id,
      jsonb_build_object('on', 'proposal', 'id', c.id, 'number', p.number, 'title', p.title, 'content', c.content) AS payload
      FROM proposal_messages c JOIN proposals p ON p.id = c.proposal_id AND p.workspace_id = c.workspace_id
      WHERE p.status <> 'removed' AND ${common(sql`c.created_at`, sql`'comment:' || c.id`, sql`c.workspace_id`, sql`c."from"`)}
      ORDER BY c.created_at DESC, id DESC LIMIT ${take}`,
  );
  add(
    'comment',
    sql`SELECT 'comment:' || c.id AS id, c.created_at AS at, 'comment' AS kind, c.workspace_id, c."from" AS actor_id,
      jsonb_build_object('on', 'market', 'id', c.id, 'marketId', c.market_id, 'metric', m.metric_name, 'date', m.target_date, 'content', c.content) AS payload
      FROM market_messages c JOIN markets m ON m.id = c.market_id AND m.workspace_id = c.workspace_id
      WHERE ${common(sql`c.created_at`, sql`'comment:' || c.id`, sql`c.workspace_id`, sql`c."from"`)}
      ORDER BY c.created_at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'announcement',
    sql`SELECT 'announcement:' || a.id AS id, a.published_at AS at, 'announcement' AS kind, a.workspace_id, a.published_by AS actor_id,
      jsonb_build_object('event', 'published', 'body', COALESCE(a.original_body, a.body)) AS payload
      FROM announcements a
      WHERE ${common(sql`a.published_at`, sql`'announcement:' || a.id`, sql`a.workspace_id`, sql`a.published_by`)}
      ORDER BY a.published_at DESC, id DESC LIMIT ${take}`,
  );
  add(
    'announcement',
    sql`SELECT 'announcement:' || a.id || ':edit' AS id, a.edited_at AS at, 'announcement' AS kind, a.workspace_id, a.published_by AS actor_id,
      jsonb_build_object('event', 'edited', 'body', a.body) AS payload
      FROM announcements a
      WHERE a.edited_at IS NOT NULL AND ${common(sql`a.edited_at`, sql`'announcement:' || a.id || ':edit'`, sql`a.workspace_id`, sql`a.published_by`)}
      ORDER BY a.edited_at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'reading',
    sql`SELECT 'reading:' || u.id AS id, u."timestamp" AS at, 'reading' AS kind, u.workspace_id, NULL AS actor_id,
      jsonb_build_object('metric', u.metric_name, 'oldValue', u.old_value, 'newValue', u.new_value, 'note', u.description) AS payload
      FROM updates u
      WHERE ${common(sql`u."timestamp"`, sql`'reading:' || u.id`, sql`u.workspace_id`, null)}
      ORDER BY u."timestamp" DESC, id DESC LIMIT ${take}`,
  );

  add(
    'metric',
    sql`SELECT 'metric:' || m.id AS id, m.created_at AS at, 'metric' AS kind, m.workspace_id, NULL AS actor_id,
      jsonb_build_object('event', 'added', 'metric', m.name) AS payload
      FROM metrics m
      WHERE ${common(sql`m.created_at`, sql`'metric:' || m.id`, sql`m.workspace_id`, null)}
      ORDER BY m.created_at DESC, id DESC LIMIT ${take}`,
  );
  add(
    'metric',
    sql`SELECT 'metric:' || r.id AS id, r.created_at AS at, 'metric' AS kind, r.workspace_id, r.changed_by AS actor_id,
      jsonb_build_object('event', 'changed', 'metric', m.name, 'field', r.field) AS payload
      FROM metric_definition_revisions r JOIN metrics m ON m.id = r.metric_id AND m.workspace_id = r.workspace_id
      WHERE ${common(sql`r.created_at`, sql`'metric:' || r.id`, sql`r.workspace_id`, sql`r.changed_by`)}
      ORDER BY r.created_at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'market',
    sql`SELECT 'market:' || m.id || ':open' AS id, m.created_at AS at, 'market' AS kind, m.workspace_id, NULL AS actor_id,
      jsonb_build_object('event', 'opened', 'marketId', m.id, 'metric', m.metric_name, 'date', m.target_date) AS payload
      FROM markets m
      WHERE m.proposal_id IS NULL AND ${common(sql`m.created_at`, sql`'market:' || m.id || ':open'`, sql`m.workspace_id`, null)}
      ORDER BY m.created_at DESC, id DESC LIMIT ${take}`,
  );
  add(
    'market',
    sql`SELECT 'market:' || m.id || ':settled' AS id, m.resolved_at AS at, 'market' AS kind, m.workspace_id, NULL AS actor_id,
      jsonb_build_object('event', CASE WHEN m.voided THEN 'voided' ELSE 'settled' END, 'marketId', m.id, 'metric', m.metric_name, 'date', m.target_date, 'value', m.actual_value) AS payload
      FROM markets m
      WHERE m.proposal_id IS NULL AND m.resolved AND m.resolved_at IS NOT NULL
        AND ${common(sql`m.resolved_at`, sql`'market:' || m.id || ':settled'`, sql`m.workspace_id`, null)}
      ORDER BY m.resolved_at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'liquidity',
    sql`SELECT 'liquidity:' || l.id AS id, l.created_at AS at, 'liquidity' AS kind, l.workspace_id, l.agent_id AS actor_id,
      jsonb_build_object('marketId', l.market_id, 'metric', m.metric_name, 'date', m.target_date, 'amount', l.amount) AS payload
      FROM liquidity_events l JOIN markets m ON m.id = l.market_id AND m.workspace_id = l.workspace_id
      WHERE l.type = 'injection' AND l.agent_id IS NOT NULL
        AND ${common(sql`l.created_at`, sql`'liquidity:' || l.id`, sql`l.workspace_id`, sql`l.agent_id`)}
      ORDER BY l.created_at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'join',
    sql`SELECT 'join:' || a.id AS id, a.created_at AS at, 'join' AS kind, NULL AS workspace_id, a.id AS actor_id,
      jsonb_build_object('as', CASE WHEN a.owner_agent_id IS NOT NULL THEN 'bot' WHEN a.auth_user_id IS NOT NULL THEN 'person' ELSE 'agent' END,
        'ownerId', a.owner_agent_id) AS payload
      FROM agents a
      WHERE ${common(sql`a.created_at`, sql`'join:' || a.id`, null, sql`a.id`)}
      ORDER BY a.created_at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'link',
    sql`SELECT 'link:' || r.agent_id || ':' || r.provider AS id, r.linked_at AS at, 'link' AS kind, NULL AS workspace_id, r.agent_id AS actor_id,
      jsonb_build_object('provider', r.provider) AS payload
      FROM record_links r
      WHERE ${common(sql`r.linked_at`, sql`'link:' || r.agent_id || ':' || r.provider`, null, sql`r.agent_id`)}
      ORDER BY r.linked_at DESC, id DESC LIMIT ${take}`,
  );

  add(
    'workspace',
    sql`SELECT 'workspace:' || w.id AS id, w.created_at AS at, 'workspace' AS kind, w.id AS workspace_id, NULL AS actor_id,
      jsonb_build_object('name', w.name) AS payload
      FROM workspaces w
      WHERE ${common(sql`w.created_at`, sql`'workspace:' || w.id`, sql`w.id`, null)}
      ORDER BY w.created_at DESC, id DESC LIMIT ${take}`,
  );

  let raw: RawRow[] = [];
  if (branches.length) {
    const union = sql.join(branches, sql` UNION ALL `);
    // The instant comes back as UTC text rather than a Date, because a raw
    // read of a zoneless timestamp is parsed in the process's local zone by
    // both drivers, and a log two hours off is a log that lies.
    const result = await db.execute(
      sql`SELECT u.id, to_char(u.at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at, u.kind, u.workspace_id, u.actor_id, u.payload
        FROM (${union}) u ORDER BY u.at DESC, u.id DESC LIMIT ${take}`,
    );
    raw = (Array.isArray(result) ? result : (result as unknown as { rows: RawRow[] }).rows) as RawRow[];
  }

  const more = raw.length > limit;
  const page = raw.slice(0, limit);

  // Names, looked up once for the page: actors and the owners of bots.
  const wanted = new Set<string>();
  for (const r of page) {
    if (r.actor_id) wanted.add(r.actor_id);
    if (r.payload?.ownerId) wanted.add(r.payload.ownerId);
  }
  const handles = new Map<string, string>();
  if (wanted.size) {
    const rows = await db
      .select({ id: agents.id, nickname: agents.nickname })
      .from(agents)
      .where(inArray(agents.id, [...wanted]));
    for (const a of rows) handles.set(a.id, a.nickname ?? a.id);
  }

  const rows = page.map(r => renderRow(r, floorById, handles));
  const last = page[page.length - 1];
  return {
    generatedAt: new Date().toISOString(),
    ...vocabulary,
    rows,
    next: more && last ? encodeCursor(new Date(last.at), last.id) : null,
  };
}

function renderRow(
  r: RawRow,
  floorById: Map<string, { slug: string; name: string }>,
  handles: Map<string, string>,
): ActionRow {
  const p = r.payload ?? {};
  const floor = r.workspace_id ? (floorById.get(r.workspace_id) ?? null) : null;
  const slug = floor?.slug ?? '';
  const actorHandle = r.actor_id ? (handles.get(r.actor_id) ?? r.actor_id) : null;
  const actor = r.actor_id ? { id: r.actor_id, handle: actorHandle! } : null;
  const book = p.metric ? `${p.metric} (${p.date})` : '';
  let text = '';
  let detail: Record<string, unknown> = {};
  let href = slug ? `/${slug}` : '/';

  switch (r.kind) {
    case 'trade': {
      const side = p.shares < 0 ? 'sold' : 'bought';
      const shares = Math.abs(Number(p.shares));
      const cost = Math.abs(Number(p.cost));
      const call =
        p.callBefore != null && p.callAfter != null ? `, call ${num(Number(p.callBefore))} to ${num(Number(p.callAfter))}` : '';
      text = `${side} ${num(shares)} ${p.direction} shares on ${book} for ${num(cost)} cr${call}`;
      detail = {
        side: side === 'sold' ? 'sell' : 'buy',
        direction: p.direction,
        shares,
        cost,
        callBefore: p.callBefore ?? null,
        callAfter: p.callAfter ?? null,
        marketId: p.marketId,
        metric: p.metric,
        date: p.date,
      };
      href = `/${slug}#market=${p.marketId}&trade=${r.id.slice('trade:'.length)}`;
      break;
    }
    case 'proposal': {
      if (p.event === 'edited') text = `edited the ${p.field} of "${p.title}"`;
      else text = `proposed "${p.title}"${p.askUsd ? ` for $${num(Number(p.askUsd))}` : ''}`;
      detail = { event: p.event, number: p.number, title: p.title, askUsd: p.askUsd ?? null, field: p.field ?? null };
      href = `/${slug}/p/${p.number}`;
      break;
    }
    case 'decision': {
      const ask = p.askUsd ? ` ($${num(Number(p.askUsd))})` : '';
      switch (p.status) {
        case 'approved':
          text = `approved "${p.title}"${ask}`;
          break;
        case 'declined':
          text = `declined "${p.title}"${ask}${p.reason ? `: ${p.reason}` : ''}`;
          break;
        case 'declined_spam':
          text = `declined "${p.title}" as spam`;
          break;
        case 'lapsed':
          text = `"${p.title}"${ask} lapsed undecided`;
          break;
        default:
          text = `"${p.title}"${ask} was withdrawn`;
      }
      detail = { number: p.number, title: p.title, askUsd: p.askUsd ?? null, status: p.status, reason: p.reason ?? null };
      href = `/${slug}/p/${p.number}`;
      break;
    }
    case 'delivery': {
      text = `reported "${p.title}" delivered${p.note ? `: ${excerpt(p.note)}` : ''}`;
      detail = { number: p.number, title: p.title, note: p.note ?? null };
      href = `/${slug}/p/${p.number}`;
      break;
    }
    case 'comment': {
      const on = p.on === 'proposal' ? `"${p.title}"` : book;
      text = `on ${on}: ${excerpt(p.content)}`;
      detail = { on: p.on, number: p.number ?? null, title: p.title ?? null, marketId: p.marketId ?? null, metric: p.metric ?? null, date: p.date ?? null };
      href = p.on === 'proposal' ? `/${slug}/p/${p.number}#comment=${p.id}` : `/${slug}#market=${p.marketId}&comment=${p.id}`;
      break;
    }
    case 'announcement': {
      text = p.event === 'edited' ? `edited an announcement: ${excerpt(p.body)}` : `announced: ${excerpt(p.body)}`;
      detail = { event: p.event };
      href = `/${slug}/announcements`;
      break;
    }
    case 'reading': {
      text = `${p.metric} read ${num(Number(p.newValue))}, was ${num(Number(p.oldValue))}${p.note ? ` (${excerpt(p.note, 80)})` : ''}`;
      detail = { metric: p.metric, oldValue: p.oldValue, newValue: p.newValue, note: p.note ?? null };
      break;
    }
    case 'metric': {
      text = p.event === 'changed' ? `changed the ${p.field} of ${p.metric}` : `added the metric ${p.metric}`;
      detail = { event: p.event, metric: p.metric, field: p.field ?? null };
      break;
    }
    case 'market': {
      if (p.event === 'opened') text = `a book opened on ${book}`;
      else if (p.event === 'voided') text = `${book} was voided`;
      else text = `${book} settled at ${p.value == null ? 'no value' : num(Number(p.value))}`;
      detail = { event: p.event, marketId: p.marketId, metric: p.metric, date: p.date, value: p.value ?? null };
      href = `/${slug}#market=${p.marketId}`;
      break;
    }
    case 'liquidity': {
      text = `put ${num(Number(p.amount))} cr of liquidity behind ${book}`;
      detail = { marketId: p.marketId, metric: p.metric, date: p.date, amount: p.amount };
      href = `/${slug}#market=${p.marketId}`;
      break;
    }
    case 'join': {
      const owner = p.ownerId ? (handles.get(p.ownerId) ?? p.ownerId) : null;
      text = p.as === 'bot' ? `joined as a bot run by ${owner}` : p.as === 'person' ? 'joined as a person' : 'joined as an agent';
      detail = { as: p.as, ownerHandle: owner };
      href = `/participants/${encodeURIComponent(actorHandle ?? '')}`;
      break;
    }
    case 'link': {
      const name = PROVIDER_NAMES[p.provider] ?? p.provider;
      text = `linked a ${name} record`;
      detail = { provider: p.provider };
      href = `/participants/${encodeURIComponent(actorHandle ?? '')}`;
      break;
    }
    case 'workspace': {
      text = `the floor ${p.name} opened`;
      detail = { name: p.name };
      break;
    }
  }

  return {
    id: r.id,
    at: new Date(r.at).toISOString(),
    kind: r.kind,
    workspace: floor,
    actor,
    text,
    detail,
    href,
  };
}

/** One line per row: the instant, the kind, the actor, the floor, the
 *  sentence. What Otto reads and what the agent brief carries. */
export function renderActionsText(page: ActionsPage): string {
  const lines = page.rows.map(r =>
    [r.at.replace(/\.\d{3}Z$/, 'Z'), r.kind, r.actor?.handle ?? '-', r.workspace?.slug ?? '-', r.text].join('  '),
  );
  const head = `Telarchy's public actions log (telarchy.com/data-room), ${page.rows.length} rows newest first, generated ${page.generatedAt}. The same list with filters: GET /api/data-room/actions?kinds=&workspace=&participant=&after=&before=&limit=&cursor=.`;
  const kinds = `Kinds: ${page.kinds.map(k => `${k.id} (${k.description})`).join('; ')}`;
  const floors = `Public floors: ${page.workspaces.map(w => w.slug).join(', ') || 'none'}`;
  const tail = page.next ? `More: cursor=${page.next}` : 'End of the log.';
  return [head, kinds, floors, '', ...lines, '', tail].join('\n');
}

/**
 * The tool Otto is handed on every floor: the log, with the same filters as
 * the endpoint, as lines of text. One round from "what happened on
 * Telarchy" to the rows.
 */
export function actionsTool() {
  return {
    spec: {
      type: 'function' as const,
      function: {
        name: 'read_data_room',
        description:
          "Read Telarchy's public actions log (telarchy.com/data-room): every public action on the " +
          'platform, newest first: trades, proposals, decisions, deliveries, comments, announcements, ' +
          'metric readings, books opening and settling, liquidity, joins, record links, floors opening. ' +
          'Filter with the same parameters the public endpoint takes. Use it whenever a visitor asks ' +
          'what has happened on Telarchy, who did what, or whether anyone is here.',
        parameters: {
          type: 'object',
          properties: {
            kinds: { type: 'string', description: 'Comma-separated kinds, e.g. "trade,decision". Omit for every kind.' },
            workspace: { type: 'string', description: "A public floor's slug." },
            participant: { type: 'string', description: 'A participant handle or id; rows they did.' },
            after: { type: 'string', description: 'ISO instant; rows strictly after it.' },
            before: { type: 'string', description: 'ISO instant; rows strictly before it.' },
            limit: { type: 'number', description: 'Rows, default 50, at most 200.' },
            cursor: { type: 'string', description: 'The cursor a previous read ended with.' },
          },
        },
      },
    },
    async run(args: Record<string, unknown>): Promise<string> {
      try {
        const q = parseActionsQuery(
          Object.fromEntries(Object.entries(args ?? {}).map(([k, v]) => [k, v == null ? undefined : String(v)])),
        );
        return renderActionsText(await buildActions(q));
      } catch (e) {
        if (e instanceof AppError) return `That read was refused: ${e.message}`;
        throw e;
      }
    },
  };
}
