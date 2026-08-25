-- 0027: Add `manage_workspace` capability to admin permission groups.
--
-- Splits irreversible workspace-lifecycle operations (deleting the workspace,
-- toggling visibility, configuring auto-fund and default proposal liquidity)
-- out of the broad `manage` capability into a separate `manage_workspace`
-- capability. Defaults: existing admin-type groups get the new capability so
-- workspace admins keep the access they have today; trader and public groups
-- are unchanged. Owners (workspace creator) keep all capabilities via the
-- creator shortcut in computeCapabilities, regardless of group membership.
UPDATE "permission_groups"
SET "capabilities" = (
  SELECT jsonb_agg(DISTINCT cap)
  FROM jsonb_array_elements_text("capabilities" || '["manage_workspace"]'::jsonb) AS cap
)
WHERE "type" = 'admin'
  AND NOT ("capabilities" @> '["manage_workspace"]'::jsonb);
