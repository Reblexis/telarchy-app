-- 0050: Payment details become STRUCTURED (owner direction 2026-08-10,
-- late): one free-text handle was too broad to pay against reliably. The
-- account now stores a typed method ({ provider, ...fields }, validated
-- per provider server-side); the existing text column stays as the
-- derived human-readable summary that proposal snapshots and the owner's
-- payout screen keep reading, so nothing downstream changes shape.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "payout_method" jsonb;
