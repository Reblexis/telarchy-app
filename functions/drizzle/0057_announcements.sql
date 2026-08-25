-- Owner-authored announcements on a workspace, append-only by construction.
--
-- The LookPilot charter promises "if something material happens to LookPilot
-- that the market cannot see, I announce it within 24 hours of knowing it for
-- certain", and there was no surface for that: comments hang off a market or a
-- proposal, and `updates` is a metric-change record, not prose. This is the
-- workspace-level surface the promise needs.
--
-- Integrity is the whole point. What an announcement buys a trader is the
-- ability to check, after the fact, that a disclosure happened before the
-- event. That is worth nothing if the publisher can quietly re-date it, edit
-- the text, or make it disappear, so the table refuses all three at the
-- database level rather than trusting the routes:
--
--   DELETE  refused outright.
--   UPDATE  refused unless it is an honest edit: same id and workspace, same
--           published_at, edited_at stamped, and original_body holding the
--           body exactly as it was first published.
--
-- Same shape and same escape hatch as the append-only ledgers (0055): a
-- sanctioned cascade (deleting a whole workspace) sets telarchy.ledger_admin
-- for one transaction. An ad-hoc psql session cannot rewrite history by
-- accident, and neither can a future route that forgets the rule.

CREATE TABLE IF NOT EXISTS "announcements" (
  "id" text NOT NULL,
  "workspace_id" text NOT NULL,
  -- Markdown. Capped at 5000 chars by the route; an announcement is news, not
  -- a second charter.
  "body" text NOT NULL,
  -- Server-side, always. A disclosure timestamp the publisher chooses proves
  -- nothing, so the route never reads this from the request body.
  "published_at" timestamp DEFAULT now() NOT NULL,
  -- NULL until the row is edited; both timestamps ship in the public payload
  -- from then on, so an edited announcement is visibly an edited one.
  "edited_at" timestamp,
  -- NULL until the first edit, then the body exactly as first published, and
  -- never touched again. The public payload carries it: an announcement that
  -- can be silently rewritten is worth nothing to the promise it keeps.
  "original_body" text,
  CONSTRAINT "announcements_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_workspace_published_idx"
  ON "announcements" ("workspace_id", "published_at" DESC);

--> statement-breakpoint
CREATE OR REPLACE FUNCTION telarchy_announcement_append_only() RETURNS trigger AS $$
DECLARE
  expected_original text;
BEGIN
  IF coalesce(current_setting('telarchy.ledger_admin', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'announcements is append-only: DELETE refused. A published disclosure is the record a trader checks a charter against. Supersede it with a new announcement instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'An announcement cannot change identity.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION
      'An announcement cannot be re-dated: published_at is when the disclosure happened, which is the only thing it proves.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- What the body was when it was first published, whether or not this is the
  -- first edit. OLD.body is NOT NULL, so this is never null.
  expected_original := coalesce(OLD.original_body, OLD.body);

  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF NEW.edited_at IS NULL THEN
      RAISE EXCEPTION 'An edited announcement must record edited_at.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.original_body IS DISTINCT FROM expected_original THEN
      RAISE EXCEPTION
        'An edit must preserve the originally published body in original_body.'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW.original_body IS DISTINCT FROM OLD.original_body THEN
    RAISE EXCEPTION 'original_body is the historical record and is not editable.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
DROP TRIGGER IF EXISTS announcements_append_only ON "announcements";

--> statement-breakpoint
CREATE TRIGGER announcements_append_only
  BEFORE UPDATE OR DELETE ON "announcements"
  FOR EACH ROW EXECUTE FUNCTION telarchy_announcement_append_only();
