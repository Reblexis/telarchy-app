-- His own posts in the X log (telarchy-app docs/x-workbench.md, "Writing his
-- own post"). A post has no source post, so `source_post_id` may be null;
-- `kind` says which rows are replies and which are posts. Both additive:
-- every existing row is a reply with a source.
ALTER TABLE "x_replies" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'reply' NOT NULL;
--> statement-breakpoint
ALTER TABLE "x_replies" ALTER COLUMN "source_post_id" DROP NOT NULL;
