-- A second place to bring a forecasting record (owner ask 2026-08-31,
-- after the pricing analysis in the telarchy umbrella's
-- notes/earn-table-design-2026-08-30.md section 10 concluded that record
-- links are what is worth 5,000, not identity or phone).
--
-- Priced level with Manifold: both buy the same thing, an account that
-- has really been forecasting for months, and a Polymarket account of
-- that age costs MORE to manufacture because its trades are made with
-- real money. What it is emphatically not priced on is profit or volume:
-- USDC and positions move between wallets, so any wealth-shaped signal
-- is the one a farmer can pool (docs/record-links.md).
INSERT INTO earn_rules (key, label, credits, kind, note) VALUES
  ('polymarket_link', 'Link an established Polymarket account', 5000, 'flat',
   'Aged 90 days and at least 10 markets traded.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO earn_rule_history (id, key, credits, kind, enabled, note, changed_by)
SELECT gen_random_uuid()::text, key, credits, kind, enabled, note, 'migration 0092'
  FROM earn_rules
 WHERE key = 'polymarket_link';
