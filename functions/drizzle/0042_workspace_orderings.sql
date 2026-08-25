-- 0042: Per-participant workspace display order (the sidebar order).
--
-- Why: the workspace list is per-user membership (many-to-many), so the order
-- a participant sees their workspaces in is a personal view preference, not a
-- property of the workspace. Keyed by the caller's auth identity (uid for a
-- browser account, else the agent id). Upserted by PUT /api/workspaces/order;
-- GET /api/workspaces sorts by position and appends unsaved workspaces after.
CREATE TABLE IF NOT EXISTS "workspace_orderings" (
	"identity" text NOT NULL,
	"workspace_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workspace_orderings_identity_workspace_id_pk" PRIMARY KEY("identity","workspace_id")
);
