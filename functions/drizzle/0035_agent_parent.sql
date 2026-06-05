-- 0035: Agent-to-agent ownership (parent/children lineage).
--
-- POST /api/agents called with an agent key now records which agent created
-- the new bot. Browser callers keep using owner_user_id; agent-key callers
-- get owner_agent_id. The public participant profile surfaces this as
-- "parent" (the creating agent) and "children" (agents this one created).
--
-- The one-time UPDATE backfills the market-evolver gen-1 population that was
-- created before this column existed. It is a no-op on databases without
-- those rows (local/self-hosted instances).

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "owner_agent_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_agent_id_agents_id_fk"
  FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_owner_agent_id_idx" ON "agents" ("owner_agent_id");--> statement-breakpoint
UPDATE "agents" SET "owner_agent_id" = 'market-evolver'
  WHERE "id" LIKE 'nu-evo-g%' AND "owner_agent_id" IS NULL
  AND EXISTS (SELECT 1 FROM "agents" WHERE "id" = 'market-evolver');
