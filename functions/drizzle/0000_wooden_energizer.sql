CREATE TABLE "agent_api_keys" (
	"hash" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"workspace_id" text DEFAULT 'default' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"api_key_hash" text NOT NULL,
	"role" text DEFAULT 'agent' NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"earned_betting" double precision DEFAULT 0 NOT NULL,
	"spent_betting" double precision DEFAULT 0 NOT NULL,
	"spent_tokens" double precision DEFAULT 0 NOT NULL,
	"earned_tasks" double precision DEFAULT 0 NOT NULL,
	"wallet_address" text,
	"withdrawn_usdc" double precision DEFAULT 0 NOT NULL,
	"owner_uid" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"platform_admin" boolean DEFAULT false NOT NULL,
	"intent" text,
	"agent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"tx_hash" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"from" text NOT NULL,
	"usdc_amount" double precision NOT NULL,
	"credits" double precision NOT NULL,
	"buy_rate" double precision NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "events_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "hook_watcher" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"last_heartbeat" timestamp,
	"status" text
);
--> statement-breakpoint
CREATE TABLE "liquidity_events" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"market_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"total_liquidity" double precision NOT NULL,
	"type" text NOT NULL,
	"agent_id" text,
	"pool_contribution" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "liquidity_events_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"metric_id" text NOT NULL,
	"metric_name" text NOT NULL,
	"target_date" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"actual_value" double precision,
	"active" boolean DEFAULT true NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"range_min" double precision NOT NULL,
	"range_max" double precision NOT NULL,
	"shares" jsonb NOT NULL,
	"liquidity" double precision NOT NULL,
	"pool" double precision NOT NULL,
	"task_id" text,
	CONSTRAINT "markets_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "metric_logs" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"metric_id" text NOT NULL,
	"metric_name" text NOT NULL,
	"value" double precision NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "metric_logs_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"value" double precision DEFAULT 0 NOT NULL,
	"formula" text DEFAULT '0' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"time_preference" jsonb,
	"market_range_max" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "permission_groups" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "permission_groups_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"market_id" text NOT NULL,
	"direction" text NOT NULL,
	"shares" double precision NOT NULL,
	"total_cost" double precision NOT NULL,
	CONSTRAINT "positions_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_messages" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"from" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_messages_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"proposed_by" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" double precision NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"conditional_market_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"market_id" text NOT NULL,
	"direction" text NOT NULL,
	"shares" double precision NOT NULL,
	"cost" double precision NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trades_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "updates" (
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"metric_name" text NOT NULL,
	"old_value" double precision NOT NULL,
	"new_value" double precision NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "updates_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "user_workspaces" (
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_workspaces_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"credits" double precision NOT NULL,
	"usdc_amount" double precision NOT NULL,
	"to_address" text NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"traded_volume" double precision DEFAULT 0 NOT NULL,
	"custom_api_url" text
);
--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_workspaces" ADD CONSTRAINT "user_workspaces_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;