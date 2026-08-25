-- Every question asked of a floor, and who asked it (owner ask 2026-08-20:
-- "this is really useful data").
--
-- It is the only record of what a visitor wanted to know and could not find,
-- which is the highest-signal thing a pre-launch floor produces: each row is a
-- gap in the page, said in the visitor's own words. Answers are stored with
-- the questions so a bad answer can be recognised as such later, rather than
-- being reconstructed from a model that has since changed.
--
-- Identity is best-effort and layered: the participant when the asker had one,
-- otherwise the request-log fields the privacy policy already covers (IP and
-- offline-derived country, same as page_visits). Those two are purged on the
-- same 30-day window as page_visits; the question itself is kept, because the
-- gap it names outlives the visit.
CREATE TABLE IF NOT EXISTS "floor_questions" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL DEFAULT '',
  /** Participant id when the asker was signed in or held a key; null for an
      anonymous visitor, which is most of them by design. */
  "asked_by" text,
  "ip" text,
  "country" text,
  /** What the call cost in USD, from the gateway's own usage report. */
  "cost_usd" double precision,
  "model" text,
  /** Set when the model refused or the gateway failed: a question that got no
      answer is the most interesting row in the table. */
  "error" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "floor_questions_created_idx" ON "floor_questions" ("created_at");
