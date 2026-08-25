-- 0021: Bug reports and help requests.
-- Submitted by users/agents from the UI or POST /api/feedback. Platform
-- admins triage via GET /api/feedback and PATCH /api/feedback/:id.

CREATE TABLE IF NOT EXISTS "feedback" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "workspace_id" text,
  "agent_id" text,
  "auth_user_id" text,
  "email" text,
  "url" text,
  "user_agent" text,
  "status" text NOT NULL DEFAULT 'open',
  "admin_notes" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_created_at_idx" ON "feedback" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_status_idx" ON "feedback" ("status");
