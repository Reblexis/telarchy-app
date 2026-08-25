UPDATE "metrics" SET "market_range_max" = 1000 WHERE "market_range_max" IS NULL;
ALTER TABLE "metrics" ALTER COLUMN "market_range_max" SET NOT NULL;
ALTER TABLE "metrics" ALTER COLUMN "market_range_max" SET DEFAULT 1000;
