-- Two more email switches (owner ask 2026-08-24: "add email notifications on
-- traded market resolving as well as a contract on which user traded /
-- commented / made being approved/declined"; the proposer's own decision mail
-- already existed and stays switchless).
--
-- Both ON by default, because both are answers addressed to the reader: the
-- settlement of a bet they placed, and the verdict on a contract they priced
-- or argued about. The firehose switches stay opt-in; these are not firehoses,
-- their volume is set by the reader's own activity.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS notify_market_resolved boolean NOT NULL DEFAULT true;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS notify_contract_decided boolean NOT NULL DEFAULT true;
