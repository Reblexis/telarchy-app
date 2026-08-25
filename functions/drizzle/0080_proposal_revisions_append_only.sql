-- proposal_revisions carries the same append-only guarantee as the other
-- ledgers (trades and liquidity_events since 0055, credit_ledger and
-- metric_definition_revisions since 0060).
--
-- A contract's title, description and ask edit in place, and the revision row
-- is the only record that the goalposts moved after someone took a position
-- (docs/market-integrity.md, "Words are edited in place, and published"). The
-- table was created in 0066 with the same shape as metric_definition_revisions
-- but without the trigger, so a hand-written UPDATE or DELETE could quietly
-- un-make a revision. Found by the first conformance audit (2026-08-25).
--
-- Same rule: INSERT freely, UPDATE and DELETE refused unless the transaction
-- deliberately sets telarchy.ledger_admin (workspace or participant deletion).
DROP TRIGGER IF EXISTS proposal_revisions_append_only ON "proposal_revisions";
CREATE TRIGGER proposal_revisions_append_only
  BEFORE UPDATE OR DELETE ON "proposal_revisions"
  FOR EACH ROW EXECUTE FUNCTION telarchy_ledger_append_only();
