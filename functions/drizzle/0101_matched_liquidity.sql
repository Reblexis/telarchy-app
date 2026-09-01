-- Matched liquidity: an earn pays two purses.
--
-- A floor a stranger opens prices its markets at half a credit while its
-- owner holds only trading money, and depth is the one thing they cannot
-- buy without a card (notes/self-serve-owner-review-2026-09-01.md). Each
-- rule now carries the liquidity it grants beside the credits, walled the
-- same as bought liquidity, so a new floor has depth before anyone pays
-- for any (owner decision 2026-09-01,
-- notes/matched-liquidity-grants-2026-09-01.md).
--
-- Seeded on the ONE-TIME signup and OAuth-link rules only. A recurring
-- rule that paid pool credits would refill forever, and the
-- exchange-record links price a forecasting record rather than a floor:
-- matching them would put 10,200 extractable credits behind one linked
-- account instead of 300.
ALTER TABLE "earn_rules" ADD COLUMN IF NOT EXISTS "liquidity_credits" double precision NOT NULL DEFAULT 0;
ALTER TABLE "earn_rule_history" ADD COLUMN IF NOT EXISTS "liquidity_credits" double precision NOT NULL DEFAULT 0;

UPDATE "earn_rules"
   SET "liquidity_credits" = "credits"
 WHERE "key" IN ('signup_user', 'signup_email', 'signup_oauth', 'link_oauth');
