-- Who published an announcement, when it was not the owner.
--
-- Announcements were owner-authored by definition, and the page said so
-- ("Everything the owner has said here"). The first automated publisher,
-- results-agent's Monday results post, changes that: the owner's decision
-- (2026-08-25, "dont publish under my name") is that a delegate's words
-- must never read as his. So a row now records the publishing participant's
-- nickname when that participant is not the workspace owner, and null when
-- the owner (or the identity-less master key) published it.
--
-- Expand-only: nullable, no default, no backfill. Rows from before the column
-- were all the owner's and stay null. The append-only trigger (0057) gains one
-- rule: published_by never changes, for the same reason published_at never
-- moves. Same escape hatch (telarchy.ledger_admin) as before.
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "published_by" text;

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

  IF NEW.published_by IS DISTINCT FROM OLD.published_by THEN
    RAISE EXCEPTION
      'published_by is who published the announcement and is not editable: the owner''s words and a delegate''s must stay distinguishable.'
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
