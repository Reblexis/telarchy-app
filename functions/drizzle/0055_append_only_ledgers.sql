-- The two ledgers a market settles on are append-only from here.
--
-- `trades` and `liquidity_events` are the record of who put what into which
-- market and when. Every price, every payout and every refund is derived from
-- them, so an edit to either silently rewrites what a market settled on, and
-- nothing in the app would notice. They were ordinary tables: on 2026-08-15 a
-- stray smoke-test trade was removed from production with a hand-written
-- DELETE, which is precisely the operation this blocks.
--
-- The rule: INSERT freely, UPDATE and DELETE refused. Sanctioned cascades
-- (deleting a workspace or a participant, resetting a workspace, re-attributing
-- an LP row) opt in per transaction by setting telarchy.ledger_admin, so the
-- app can still do them deliberately while an ad-hoc psql session cannot do
-- them accidentally. The flag is transaction-local: it cannot leak into the
-- next statement on a pooled connection.

CREATE OR REPLACE FUNCTION telarchy_ledger_append_only() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('telarchy.ledger_admin', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'Table % is append-only: % refused. This is settlement history. If you really mean it, the sanctioned paths set telarchy.ledger_admin for one transaction.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trades_append_only ON "trades";
CREATE TRIGGER trades_append_only
  BEFORE UPDATE OR DELETE ON "trades"
  FOR EACH ROW EXECUTE FUNCTION telarchy_ledger_append_only();

DROP TRIGGER IF EXISTS liquidity_events_append_only ON "liquidity_events";
CREATE TRIGGER liquidity_events_append_only
  BEFORE UPDATE OR DELETE ON "liquidity_events"
  FOR EACH ROW EXECUTE FUNCTION telarchy_ledger_append_only();
