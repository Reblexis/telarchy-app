#!/usr/bin/env node

import pg from 'pg';

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

function unique(values) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))];
}

function nextAvailableId(baseId, usedIds) {
  if (!usedIds.has(baseId)) return baseId;
  let suffix = 1;
  while (usedIds.has(`${baseId}-user-${suffix}`)) suffix += 1;
  return `${baseId}-user-${suffix}`;
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const now = new Date();

const users = (
  await client.query(`
  select user_id, agent_id
  from app_users
  order by created_at asc
`)
).rows;

const agentRows = (
  await client.query(`
  select id, auth_user_id, owner_uid
  from agents
  order by created_at asc
`)
).rows;

const usedIds = new Set(agentRows.map(row => row.id));
const agentsById = new Map(agentRows.map(row => [row.id, row]));
const agentsByAuthUserId = new Map(agentRows.filter(row => row.auth_user_id).map(row => [row.auth_user_id, row]));
const ownedByUserId = new Map();

for (const row of agentRows) {
  if (!row.owner_uid || ownedByUserId.has(row.owner_uid)) continue;
  ownedByUserId.set(row.owner_uid, row);
}

const participantByUserId = new Map();
let createdParticipants = 0;

for (const user of users) {
  let participantId = agentsByAuthUserId.get(user.user_id)?.id ?? null;
  if (!participantId && user.agent_id && agentsById.has(user.agent_id)) participantId = user.agent_id;
  if (!participantId && ownedByUserId.has(user.user_id)) participantId = ownedByUserId.get(user.user_id).id;

  if (!participantId) {
    participantId = nextAvailableId(user.user_id, usedIds);
    usedIds.add(participantId);
    await client.query(
      `
      insert into agents (id, api_key_hash, role, auth_user_id, balance, created_at, approved_at)
      values ($1, $2, 'agent', $3, 0, $4, $4)
    `,
      [participantId, `__browser__:${user.user_id}`, user.user_id, now],
    );
    createdParticipants += 1;
  } else {
    await client.query(
      `
      update agents
      set auth_user_id = $2
      where id = $1
    `,
      [participantId, user.user_id],
    );
  }

  participantByUserId.set(user.user_id, participantId);
}

const groupRows = (
  await client.query(`
  select id, workspace_id, member_ids, agent_ids, uids
  from permission_groups
  order by workspace_id, id
`)
).rows;

for (const group of groupRows) {
  const legacyUsers = Array.isArray(group.uids) ? group.uids : [];
  const mappedUsers = legacyUsers.map(userId => participantByUserId.get(userId) ?? null).filter(Boolean);
  const memberIds = unique([
    ...(Array.isArray(group.member_ids) ? group.member_ids : []),
    ...(Array.isArray(group.agent_ids) ? group.agent_ids : []),
    ...mappedUsers,
  ]);

  await client.query(
    `
    update permission_groups
    set member_ids = $3::jsonb,
        agent_ids = $3::jsonb,
        uids = '[]'::jsonb
    where id = $1 and workspace_id = $2
  `,
    [group.id, group.workspace_id, JSON.stringify(memberIds)],
  );
}

const refreshedGroups = (
  await client.query(`
  select id, workspace_id, type, member_ids
  from permission_groups
  order by workspace_id, id
`)
).rows;

const rolesByWorkspace = new Map();
for (const group of refreshedGroups) {
  const workspaceRoles = rolesByWorkspace.get(group.workspace_id) ?? new Map();
  const memberIds = Array.isArray(group.member_ids) ? group.member_ids : [];
  const role = group.type === 'admin' ? 'admin' : 'trader';
  for (const participantId of memberIds) {
    if (!workspaceRoles.has(participantId) || workspaceRoles.get(participantId) !== 'admin') {
      workspaceRoles.set(participantId, role);
    }
  }
  rolesByWorkspace.set(group.workspace_id, workspaceRoles);
}

for (const [workspaceId, workspaceRoles] of rolesByWorkspace.entries()) {
  await client.query(`delete from user_workspaces where workspace_id = $1`, [workspaceId]);
  for (const [participantId, role] of workspaceRoles.entries()) {
    const participant = await client.query(
      `
      select auth_user_id
      from agents
      where id = $1
    `,
      [participantId],
    );
    const authUserId = participant.rows[0]?.auth_user_id ?? null;
    if (!authUserId) continue;
    await client.query(
      `
      insert into user_workspaces (user_id, workspace_id, role, joined_at)
      values ($1, $2, $3, $4)
    `,
      [authUserId, workspaceId, role, now],
    );
  }
}

await client.query(`update app_users set agent_id = null where agent_id is not null`);

console.log(`Migrated ${users.length} browser users onto participant identities.`);
console.log(`Created ${createdParticipants} new participant rows.`);
console.log(`Updated ${groupRows.length} permission groups to memberIds.`);

await client.end();
