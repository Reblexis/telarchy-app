-- The board counts fault refunds as settled profit on their market
-- (docs/ui-conventions.md, "Top traders") and reads them on every load. The
-- rows are rare, so a partial index keeps that read off the whole ledger.
CREATE INDEX IF NOT EXISTS "credit_ledger_fault_refund_idx" ON "credit_ledger" USING btree ("ref_id") WHERE "reason" = 'fault_refund';
