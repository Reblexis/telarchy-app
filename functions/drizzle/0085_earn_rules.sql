-- The earn table (owner decision 2026-08-30): every way to receive free
-- credits, priced by the value it brings, editable by the operator at any
-- time including mid-season ("season 0 is esxperimental and we should nto
-- be afraid to change rules during"). Design record in the telarchy
-- umbrella, notes/earn-table-design-2026-08-30.md.
CREATE TABLE IF NOT EXISTS earn_rules (
  key text PRIMARY KEY,
  label text NOT NULL,
  -- Credits granted. For a capped rule (the Manifold import) this is the
  -- ceiling rather than a flat amount; `kind` says which.
  credits double precision NOT NULL,
  -- 'flat' grants exactly `credits`; 'cap' grants up to `credits` from a
  -- measured signal.
  kind text NOT NULL DEFAULT 'flat',
  enabled boolean NOT NULL DEFAULT true,
  -- What the operator is paying for, in their own words. Published: an
  -- entrant is entitled to read how credits are earned.
  note text NOT NULL DEFAULT '',
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by text
);

-- Append-only: a table that decides who gets money must be able to answer
-- "what did it say on the day this account was funded?", and rule changes
-- during a running season have to be reconstructable.
CREATE TABLE IF NOT EXISTS earn_rule_history (
  id text PRIMARY KEY,
  key text NOT NULL,
  credits double precision NOT NULL,
  kind text NOT NULL,
  enabled boolean NOT NULL,
  note text NOT NULL DEFAULT '',
  changed_at timestamp NOT NULL DEFAULT now(),
  changed_by text
);
CREATE INDEX IF NOT EXISTS earn_rule_history_key_idx ON earn_rule_history (key, changed_at);

-- Seed with what the code already grants today, so switching the readers
-- to the table changes no behaviour on the day it ships.
INSERT INTO earn_rules (key, label, credits, kind, note) VALUES
  ('signup_user', 'Sign up with an email or an OAuth account', 10000, 'flat',
   'A person arriving. The largest free grant, and the one to price down first if farming shows up.'),
  ('signup_agent', 'Register through the API (a bot)', 0, 'flat',
   'A curl call brings nothing; an owner funds their agents by transfer.'),
  ('manifold_link', 'Link a Manifold account', 10000, 'cap',
   'Net worth at 1 mana = 1 credit, capped at this number. One grant per Manifold account, ever.')
ON CONFLICT (key) DO NOTHING;
