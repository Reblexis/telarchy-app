#!/usr/bin/env ts-node
/**
 * migrate-default-workspace.ts
 *
 * One-time migration: ensures the 'default' workspace exists as a proper DB
 * row and that the platform user is its owner.
 *
 * What this script does (all steps are idempotent):
 *   1. Creates a workspaces row for 'default' if missing
 *   2. Creates Public + Admin permission groups if missing
 *   3. Creates or upgrades the userWorkspaces membership to 'owner' for the
 *      first admin-role member (if no owner exists yet)
 *
 * Usage (from repo root):
 *   DATABASE_URL=postgres://... npx ts-node --project functions/tsconfig.json scripts/migrate-default-workspace.ts
 */

import { Pool } from 'pg';
import { randomUUID } from 'crypto';

async function main() {
  const connString = process.env.DATABASE_URL;
  if (!connString) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: connString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Ensure workspace row exists
    const wsResult = await client.query(`SELECT id, name FROM workspaces WHERE id = 'default'`);
    if (wsResult.rows.length === 0) {
      await client.query(`
        INSERT INTO workspaces (id, name, created_by, created_at, visibility, traded_volume, auto_fund_new_markets, new_market_liquidity_credits)
        VALUES ('default', 'My Workspace', 'system', NOW(), 'private', 0, false, 0)
      `);
      console.log('✓ Created workspace row: id=default, name="My Workspace"');
    } else {
      console.log(`✓ Workspace row already exists: "${wsResult.rows[0].name}"`);
    }

    // 2. Ensure permission groups exist
    const groupsResult = await client.query(`SELECT type FROM permission_groups WHERE workspace_id = 'default'`);
    const existingTypes = new Set(groupsResult.rows.map((r: { type: string }) => r.type));

    if (!existingTypes.has('public')) {
      await client.query(`
        INSERT INTO permission_groups (id, workspace_id, name, type, description, member_ids, agent_ids, uids, permissions, created_at)
        VALUES ($1, 'default', 'Public', 'public', 'Participants explicitly added to this workspace.', '[]', '[]', '[]', '{}', NOW())
      `, [randomUUID()]);
      console.log('✓ Created Public permission group');
    } else {
      console.log('✓ Public permission group already exists');
    }

    // 3. Check for existing owner
    const ownerResult = await client.query(`
      SELECT user_id, role FROM user_workspaces WHERE workspace_id = 'default' AND role = 'owner'
    `);

    if (ownerResult.rows.length > 0) {
      console.log(`✓ Owner already set: userId=${ownerResult.rows[0].user_id}`);
    } else {
      // Find the first admin-role member of this workspace and promote them
      const adminResult = await client.query(`
        SELECT user_id, role FROM user_workspaces WHERE workspace_id = 'default' ORDER BY joined_at LIMIT 1
      `);

      if (adminResult.rows.length === 0) {
        // No membership at all: find the platform admin user
        const platformAdminResult = await client.query(`
          SELECT user_id FROM app_users WHERE platform_admin = true LIMIT 1
        `);
        if (platformAdminResult.rows.length === 0) {
          console.warn('⚠ No user found to assign as owner. Skipping owner assignment.');
        } else {
          const adminUid = platformAdminResult.rows[0].user_id;
          await client.query(`
            INSERT INTO user_workspaces (user_id, workspace_id, role, joined_at)
            VALUES ($1, 'default', 'owner', NOW())
            ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = 'owner'
          `, [adminUid]);
          console.log(`✓ Created owner membership for userId=${adminUid}`);

          // Also add to Admin permission group
          const adminGroupResult = await client.query(`
            SELECT id, member_ids, agent_ids, uids FROM permission_groups
            WHERE workspace_id = 'default' AND type = 'admin'
          `);
          const agentResult = await client.query(`SELECT id FROM agents WHERE auth_user_id = $1 LIMIT 1`, [adminUid]);
          const agentId = agentResult.rows[0]?.id;

          if (adminGroupResult.rows.length === 0) {
            await client.query(`
              INSERT INTO permission_groups (id, workspace_id, name, type, description, member_ids, agent_ids, uids, permissions, created_at)
              VALUES ($1, 'default', 'Admin', 'admin', 'Participants with full administrative access.', $2, $3, $4, '{}', NOW())
            `, [randomUUID(), JSON.stringify(agentId ? [agentId] : []), JSON.stringify(agentId ? [agentId] : []), JSON.stringify([adminUid])]);
            console.log('✓ Created Admin permission group');
          }
        }
      } else {
        // Promote existing member to owner
        const userId = adminResult.rows[0].user_id;
        await client.query(`
          UPDATE user_workspaces SET role = 'owner' WHERE user_id = $1 AND workspace_id = 'default'
        `, [userId]);
        console.log(`✓ Promoted userId=${userId} to owner (was: ${adminResult.rows[0].role})`);
      }
    }

    await client.query('COMMIT');
    console.log('\n✅ Migration complete. The "default" workspace is now a proper workspace.');
    console.log('   You can rename it in Workspace Settings.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
