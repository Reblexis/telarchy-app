-- Bringing a friend (proposal 31 on the Telarchy floor, priced as a share
-- by the owner on 2026-09-07; telarchy umbrella,
-- notes/referral-earn-2026-09-07.md). A browser signup whose stored ?ref=
-- slug is another person's nickname is attributed to that person, once, at
-- creation; the referrer then earns the row's percentage of every grant the
-- newcomer takes from the earn table in their first week
-- (docs/guides/credits.md, "Bringing a friend").
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "referred_by" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "referred_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_referred_by_idx" ON "agents" ("referred_by");
--> statement-breakpoint
-- kind 'share': credits is a percentage of what the referee earns, not an
-- amount. Counts toward no tally, like every row that is not flat or cap.
INSERT INTO earn_rules (key, label, credits, kind, note) VALUES
  ('referral', 'Bring a friend', 10, 'share',
   'Your share of what they earn here in their first week. Ten friends at most.')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO earn_rule_history (id, key, credits, kind, enabled, note, changed_by)
SELECT gen_random_uuid()::text, key, credits, kind, enabled, note, 'migration 0110'
  FROM earn_rules
 WHERE key = 'referral';
