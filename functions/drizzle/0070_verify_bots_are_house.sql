-- Four QA accounts were left in Season 0's entry table by entry-flow testing on
-- 2026-08-18 and 2026-08-19, two of them opted in. Found on 2026-08-20 while
-- verifying migration 0069 against production, hours before the season opened.
--
-- They are the platform's own bots by the plain reading of the published rule,
-- so they carry the same flag as the trading bot: entries stay, scores stay,
-- they simply cannot take a rung. Deleting the rows would have been the other
-- option and is worse, because an entry table that gets edited is a record
-- nobody can check afterwards.
UPDATE agents SET platform_operated = true
WHERE id IN ('season-entry-verify-bot', 'gate-verify-bot2', 'nopay-bot', 'entry-fields-bot');
