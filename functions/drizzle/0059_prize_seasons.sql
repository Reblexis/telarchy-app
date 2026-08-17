CREATE TABLE IF NOT EXISTS "prize_seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"pool_usd" double precision NOT NULL,
	"ladder" jsonb NOT NULL,
	"workspace_ids" jsonb NOT NULL,
	"rules_url" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "season_entries" (
	"season_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"opted_in" boolean DEFAULT false NOT NULL,
	"entered_at" timestamp,
	"baseline_profit" double precision DEFAULT 0 NOT NULL,
	"final_profit" double precision,
	"final_score" double precision,
	"final_rank" integer,
	"prize_usd" double precision,
	"claim_state" text,
	"claimed_at" timestamp,
	"paid_at" timestamp,
	CONSTRAINT "season_entries_season_id_agent_id_pk" PRIMARY KEY("season_id","agent_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "season_entries_opted_in_idx" ON "season_entries" ("season_id","opted_in");
