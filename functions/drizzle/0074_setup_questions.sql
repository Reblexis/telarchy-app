-- Otto answers on the operator door too, where there is no workspace yet
-- (docs/operator-setup.md, 2026-08-22). Every question is kept, with its
-- answer, because a row here is a gap said in the asker's own words, and the
-- setup conversation is where the most expensive gaps are. A conversation
-- with someone who does not yet own anything has no workspace to key on.
--
-- Expand-only: dropping NOT NULL is safe against the revision still serving,
-- which always writes a value.
ALTER TABLE floor_questions ALTER COLUMN workspace_id DROP NOT NULL;
