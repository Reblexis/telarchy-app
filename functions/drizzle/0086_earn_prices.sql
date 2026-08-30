-- The priced earn table (owner decision 2026-08-30, "i agree witht hte
-- table for now.. lets set it up"). Prices come from
-- min(value to us, a fraction of what the signal costs to fake), converted
-- at the internal accounting rate of 1,000 credits = $1. Reasoning per row:
-- telarchy umbrella, notes/earn-table-design-2026-08-30.md, section 8.

-- Signup splits by provider: an email address and an aged OAuth account do
-- not cost the same to farm, so they cannot be worth the same.
INSERT INTO earn_rules (key, label, credits, kind, note) VALUES
  ('signup_email', 'Sign up with an email and password', 100, 'flat',
   'An address costs a farmer almost nothing, so it earns almost nothing.'),
  ('signup_oauth', 'Sign up with Google or GitHub', 300, 'flat',
   'An aged OAuth account costs under a dollar on the open market; this sits below that.')
ON CONFLICT (key) DO NOTHING;

-- Manifold stops scaling with net worth: mana transfers between accounts,
-- so net worth is the one input a farmer can concentrate. What is actually
-- scarce is an aged, active, non-bot account, and that is what is now paid
-- for, flat.
UPDATE earn_rules
   SET credits = 5000,
       kind = 'flat',
       label = 'Link an established Manifold account',
       note = 'Aged 90 days, traded recently, not a bot. The scarcest signal on the list: a proven forecaster.'
 WHERE key = 'manifold_link';

-- The old single signup row stays as the fallback for any caller that has
-- not learned the provider split, priced at the cheaper of the two so it
-- can never be the generous path.
UPDATE earn_rules SET credits = 100, note = 'Fallback when the signup provider is unknown; priced as the cheapest path.'
 WHERE key = 'signup_user';

-- Rule changes are recorded, the same way an operator edit would be.
INSERT INTO earn_rule_history (id, key, credits, kind, enabled, note, changed_by)
SELECT gen_random_uuid()::text, key, credits, kind, enabled, note, 'migration 0086'
  FROM earn_rules
 WHERE key IN ('signup_user', 'signup_email', 'signup_oauth', 'manifold_link');
