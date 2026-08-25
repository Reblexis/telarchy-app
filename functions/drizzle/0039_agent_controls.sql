-- 0039: Desired-state control plane for out-of-process agents.
--
-- The /agents admin UI writes desired state (enabled/paused) and cycle
-- trigger requests; each agent's runner polls GET /api/admin/agent-controls
-- and obeys. Pull-based on purpose: the server never needs inbound access to
-- the box running the agents. A trigger fires when trigger_requested_at >
-- trigger_acked_at; the runner acks by setting trigger_acked_at, which keeps
-- the handshake idempotent across runner restarts.

CREATE TABLE IF NOT EXISTS "agent_controls" (
  "agent_id" text PRIMARY KEY,
  "desired_state" text NOT NULL DEFAULT 'enabled',
  "trigger_requested_at" timestamp,
  "trigger_acked_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
