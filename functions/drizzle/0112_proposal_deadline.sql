-- A decision deadline on every proposal, and trading closes at the decision
-- (docs/guides/proposals.md, "The deadline, and the close"; owner decision
-- 2026-09-08). Pending proposals get the default deadline counted from the
-- deploy; decided ones are closed as of their decision, so their surviving
-- books stop trading now.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "decision_days" integer NOT NULL DEFAULT 7;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "decide_by" timestamp;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "lapsed_at" timestamp;
UPDATE "proposals" SET "decide_by" = now() + interval '7 days' WHERE "status" = 'pending' AND "decide_by" IS NULL;
UPDATE "proposals" SET "closed_at" = COALESCE("resolved_at", now()) WHERE "status" <> 'pending' AND "closed_at" IS NULL;
