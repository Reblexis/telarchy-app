-- Proposals with options (docs/guides/proposals.md, "More than two
-- options"): a proposal may carry two to six { id, label } options in place
-- of the approve/decline pair, one conditional market per option with the
-- option id as its branch. `options` is null on every ordinary two-branch
-- proposal; `decided_option` is the id the owner chose, set by approve on a
-- proposal with options and null everywhere else. Additive.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "options" jsonb;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "decided_option" text;

-- An option's markets carry the option id as `branch`, so the branch check
-- from 0033 (approved or declined only) widens to any well-formed option id.
-- 'approved' and 'declined' match the same pattern, so every existing row
-- still passes; the reserved names are refused at the door, not here.
ALTER TABLE "markets"
  DROP CONSTRAINT IF EXISTS "markets_branch_check";
ALTER TABLE "markets"
  ADD CONSTRAINT "markets_branch_check" CHECK (
    ("proposal_id" IS NULL AND "branch" IS NULL)
    OR ("proposal_id" IS NOT NULL AND "branch" ~ '^[a-z0-9-]{1,24}$')
  );
