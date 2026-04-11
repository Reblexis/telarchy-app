-- 0008: Record Terms + Privacy Policy consent on the BetterAuth user table.
-- consentedAt is nullable so existing users are not retroactively marked.
-- The signup flow populates both fields on new signups.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "consented_at" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "consented_version" text;
