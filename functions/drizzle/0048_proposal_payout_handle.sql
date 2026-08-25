-- 0048: Where an approved job's money goes.
--
-- Why: approval pays the proposer's ask in real dollars, and a job with no
-- way to receive that money is a promise the owner cannot keep. The handle
-- (PayPal email, IBAN, crypto address; free text) is required at listing
-- time for any non-zero ask, so approval is never blocked on a chat about
-- payment details. It is payment information: the API returns it only to
-- holders of the manage capability, never in member or public payloads.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "payout_handle" text;
