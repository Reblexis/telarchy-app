-- The name an owner typed when creating a bot lived only in its id, so the
-- boards called 97 of 104 owned bots "anonymous" (reported 2026-09-17 for
-- the bot Anaconda). New participants now take their id as their nickname
-- at creation (docs/agent-economy.md, "Optional nickname"); this gives the
-- existing ones theirs. Only participants with no browser account, only ids
-- that are valid nicknames, and never a name somebody holds or that two ids
-- one case apart would both claim.
UPDATE agents a SET nickname = a.id
WHERE a.nickname IS NULL
  AND a.auth_user_id IS NULL
  AND a.id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$'
  AND NOT EXISTS (SELECT 1 FROM agents b WHERE LOWER(b.nickname) = LOWER(a.id))
  AND NOT EXISTS (SELECT 1 FROM agents c WHERE c.id <> a.id AND LOWER(c.id) = LOWER(a.id));
