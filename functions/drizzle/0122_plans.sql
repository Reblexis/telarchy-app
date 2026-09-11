-- Plan items: the owner's commitments that are not proposals, drawn on the
-- floor's "What is planned" time axis (docs/owner-on-the-floor.md, "What is
-- planned"; docs/data-room.md, the `plan` row).
--
-- A plan item is a title, optional words, an optional start and an optional
-- due point, and it is either open (done_at null) or done. What the axis buys
-- a trader is that a commitment made in public stays visible until it is
-- either done or visibly edited, so the table refuses DELETE at the database
-- level rather than trusting the routes: a plan item is never deleted, only
-- done or edited, and every add, edit and completion is a row on the data
-- room's actions log. Same escape hatch as the append-only ledgers (0055) and
-- the announcements (0057): a sanctioned cascade (deleting a whole workspace)
-- sets telarchy.ledger_admin for one transaction.

CREATE TABLE IF NOT EXISTS "plans" (
  "id" text NOT NULL,
  "workspace_id" text NOT NULL,
  -- 1..200 characters, enforced by the route.
  "title" text NOT NULL,
  -- Markdown, optional, capped at 5000 chars by the route.
  "description" text,
  -- The owner's start and due instants; both optional. A plan with no start
  -- begins at the left edge of whatever range the axis shows; a plan with no
  -- due date is listed under the axis as "no date".
  "start" timestamp,
  "due" timestamp,
  -- Stamped when a manager marks the item done; cleared when they undo it.
  -- A done plan leaves the axis; history lives in the actions log.
  "done_at" timestamp,
  -- The participant who added it, for the actions log's actor.
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  -- Stamped on every edit of the words or the dates; never by a done tick.
  "edited_at" timestamp,
  CONSTRAINT "plans_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_workspace_open_idx"
  ON "plans" ("workspace_id", "due") WHERE "done_at" IS NULL;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION telarchy_plan_no_delete() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('telarchy.ledger_admin', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'plans is append-only: DELETE refused. A plan made in public is done or edited, never unplanned.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
DROP TRIGGER IF EXISTS plans_no_delete ON "plans";

--> statement-breakpoint
CREATE TRIGGER plans_no_delete
  BEFORE DELETE ON "plans"
  FOR EACH ROW EXECUTE FUNCTION telarchy_plan_no_delete();
