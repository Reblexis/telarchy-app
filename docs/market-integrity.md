# Market integrity

What a live market is allowed to have done to it, and what must be on the
record afterwards.

This exists because prize seasons run with real money against live markets.
A market that can be silently reset, and a balance that cannot be rebuilt from
history, are the two ways a season becomes unarguable-about. Nothing may reset
a market, and every trade, transaction and liquidity injection is logged so
that the state can be recreated. History: notes/decisions/market-integrity.md.

## The four invariants

**I1. A live market is never reset as a side effect.** (Applies to a
contract's definition as well as a metric's: see I1b.) Destroying a market is a
deliberate act with its own endpoint. It is never something that merely happens
because an owner edited a field.

**I2. Nothing takes money off a participant who has not agreed to it.** Every
owner-initiated path that would refund positions out from under people is
refused while those people are in the market.

**I3. Every credit that moves leaves a row.** Any change to a participant's
balance, from any code path, writes an append-only ledger entry saying how
much moved, why, and what it referred to. The stored balance is a cache of that
ledger's sum, and a test proves it.

**I4. Every change of a market's b leaves a row.** The book's depth
(`markets.liquidity`, LMSR b) is only ever what the liquidity ledger says it
became: an injection, a subsidy, or an anchored open's thinner sizing
(`type: 'anchor'`, amount 0, recording the b the anchor bought). The price
chart REPLAYS the ledger, so an unledgered b change makes the chart quote
prices the book never printed: the LookPilot weekly market drew a smooth
climb to $9,990 while every trade actually executed on a thinner anchored
book around $5-7k, and the chart ended in a cliff onto the live price
(owner report 2026-08-29). A replay must end where the market stands.

## Redemption is liability-neutral

A trader who buys the side opposite a position they hold gets their matched
higher+lower pairs cashed at 1 credit each (owner ask 2026-08-30;
docs/ui-conventions.md has the reader-facing rule). That is not a subsidy
and not a loss:

- a pair pays `p` on the higher share and `1 - p` on the lower one at any
  settlement value (`resolutionPayouts`), so it is worth exactly 1 credit
  with no opinion in it;
- the pool pays 1 credit now and sheds exactly 1 credit of settlement
  liability, because both share counts fall by the same amount;
- the price does not move, because an LMSR price reads `q1 - q0`.

Both share counts changing means the price REPLAY has to see it, or the
chart drifts from the book the way it did on 2026-08-29 (I4 below). So a
redemption writes one `trades` row per side, negative shares, the credits
split at the marginal price. `position-netting.test.ts` pins the replay
ending where the book stands.

## I1: a definition edit splits in two

Editing a metric's description (the floor's "What is this market?" text),
renaming it, changing its formula, or changing its range never voids an open
market as a side effect. Voiding destroys a week of price discovery and every
position in it, which is a far larger harm than a reworded sentence, and it
would make routine copy-editing into a destructive operation nobody could
safely perform.

The four fields are not the same kind of thing, so they do not get the same
rule:

|  | `name`, `description` | `formula`, `marketRangeMax` |
|---|---|---|
| what it is | words a reader is told | machinery the market prices inside |
| computed from? | nothing | the LMSR consensus, and settlement |
| on edit | applies, market untouched | **409 while any market is open** |
| on the record | a `metric_definition_revisions` row per field | n/a, the edit never happens |

- **Words never void.** The market keeps its price, its pool, its trades and
  its positions. A rename also syncs `markets.metricName`, which is
  denormalised and is what the floor, the share image and every notification
  render; without the sync a renamed metric shows its old name forever.
- **Every word change is on the record.** `metric_definition_revisions` is
  append-only: which metric, which field, the old value, the new value, who
  changed it, when. The floor renders it under "What is this market?", so a
  trader can see whether the goalposts moved after they took their position.
  Saving unchanged text writes nothing, because a log full of non-changes makes
  "did anything move?" harder to answer, not easier.
- **Machinery is refused, not voided.** A market stores its own
  `rangeMin`/`rangeMax` and prices inside them, so changing the metric's range
  under an open market makes the stated range and the traded range disagree
  with nothing on screen saying so. Rather than void-and-respawn or
  sync-and-hope, the edit is refused with a 409 naming the field
  and the open market. Get the range right before opening, or wait for it to
  settle.
- **A leaf metric's `value` is a measurement, not a definition.** It is always
  allowed; the daily sync depends on it. On a computed metric `value` is not
  settable: a value in the request is ignored and the stored value is the
  formula's result.

The residual risk is real and is accepted knowingly: an owner can reword
what a market settles on while positions are open. The mitigation is
disclosure, not prevention, because no code can tell a clarification from a
redefinition. Publishing the revision history next to the definition is what
makes the risk visible to the people carrying it.

## I1b: a contract's definition edits the same way

A contract
(`proposals`) is a definition too, and its conditional pair is a live market
that prices it, so the split is the same one I1 draws for a metric:

- **Words are edited in place, and published.** The title and the description
  are what a trader reads before pricing "if this is approved". The proposer,
  or anyone with `manage`, may edit them while the contract is still pending.
  The pair keeps its price, its pool and every position; the change writes an
  append-only `proposal_revisions` row, rendered on the floor beside the
  contract, so someone already holding can see the goalposts move.
- **The price edits like the words do.** While the pair is untraded, changing the ask **re-anchors** it
  (the branch markets are voided and respawned at the new number, which costs
  nothing because nobody is in them). Once anyone has traded either branch,
  the ask still changes, but the markets, their pools and every position are
  left exactly where trading put them: no void, no respawn, no re-anchor,
  because taking the pair away from people who are in it is what I2 forbids.
  The protection is the same one I1 settled on for a metric's words:
  disclosure, not prevention. The change writes its append-only
  `proposal_revisions` row, rendered beside the contract, so someone already
  holding can see the deal's number move and trade on the new one.
- **The title may not disagree with the ask.** A paid contract's title carries
  its price by convention ("$200: rewrite the store page"), and two places
  stating one number is how they end up stating two. An edit whose title names
  a different price than `askUsd` is refused with 400.
- **Only while pending.** An approved contract's terms are the deal the owner
  agreed to pay for, and a declined one's are what the published reason refers
  to. Neither is editable; the endpoint answers 409.

Nothing here lets an editor change who gets paid: `payoutHandle` is snapshotted
at creation and is not part of the edit.

## I2: what an owner cannot destroy

Two rules, matched to what each path actually takes from people. Both live at
the route layer, never inside `voidMarket`: six of that function's nine callers
are the engine's own lifecycle (stale conditional cleanup, a proposal being
decided or removed, an unapproved conditional reaching its settle instant), and
freezing those would stop the clock rather than protect anyone.

| Path | Refused when | Why |
|---|---|---|
| `POST /api/predictions/markets/:id/void` | anyone has traded it | voiding takes money off people who chose to put it there |
| `DELETE /api/metrics/:id` | any open market on it has been traded | it voids those markets |
| `DELETE /api/workspaces/:id` | a running prize season names this workspace | its entrants' profit is measured over these markets |

Workspace deletion is gated on the season rather than on trading because it
already voids and refunds every open position on the way out: nothing is taken,
the venue just closes. Season membership is read from `prize_seasons.
workspaceIds`, which the season pins at start, so flipping a workspace private
mid-season cannot slip it out of the freeze.

Refused means a 409 that names the reason (how many participants hold
positions, or which season is running), not a silent no-op.

**There is one sanctioned way through, and it is loud.** `POST
/api/predictions/markets/:id/void` accepts `acknowledgeTraded: true` plus a
`reason` of at least ten characters, which is published on the market's
`market:resolved` event. It exists on the model of `allowLedgerAdmin`: a guard
with no sanctioned escape gets routed around with a hand-written UPDATE against
production, and then the destruction happens with no record at all. Holders are
refunded their net cash at stake, as any void does (`vision.md`, void refund
rule), so the escape costs them their position and their price discovery,
never their money.

### There is no reset endpoint

`POST /api/system/reset-economy` does not exist and is not reintroduced, guarded
or otherwise: it zeroed every balance in a workspace, deleted every trade under
`allowLedgerAdmin`, and reset all market AMM state behind nothing but the
ordinary `manage` capability, and the append-only trigger could not stop it
because it opted out of the trigger on purpose. A guard has to be remembered,
and the endpoint has no legitimate use on a live product. Starting a workspace
over is `DELETE /api/workspaces/:id` followed by creating a new one.

## I3: the credit ledger

`trades` and `liquidity_events` are append-only under a trigger (migration
0055), but they are two of the ways money moves; payouts at settlement, void
refunds, proposal stakes, proposal rewards, spam penalties, contract payments,
signup grants, Manifold grants, admin adjustments, limit-order holds and top-ups
all move money too, and every one of them goes through the ledger.

- **One door.** `applyCredits(tx, {...})` in `functions/src/services/credits.ts`
  is the only code allowed to write `agents.balance`. It performs the update and
  writes the ledger row in the same transaction, so a balance change without a
  record is not expressible. `applyCreditsIfSufficient` adds an optional
  balance floor so a caller can use the debit itself as its check with no
  read-then-write race.
- **`credit_ledger` is append-only**, under the same trigger as `trades`
  (UPDATE and DELETE refused unless a transaction sets
  `telarchy.ledger_admin`).
- **Every row says why.** `reason` is a closed set (`trade`, `payout`,
  `void_refund`, `lp_leftover`, `liquidity`, `proposal_stake`,
  `proposal_reward`, `proposal_penalty`, `contract_payment`, `signup_grant`,
  `limit_order_hold`, `limit_order_release`, `transfer_in`, `transfer_out`,
  `admin_adjustment`, `opening_balance`), and `refType`/`refId` point at the
  market, proposal or transfer that caused it.
- **Balance after is stored on the row**, not derived at read time, so a
  divergence is visible where it started rather than only in the total.
- **A new participant is created at zero** and granted through the ledger, so
  even the signup grant has a row.
- **Migration 0060 backfills an `opening_balance` row per existing
  participant.** Without it the invariant would pass in tests (where every
  account postdates the migration) and fail in production for every account,
  which is the worst place for an invariant to be false.
- **`workspace_id` is `'platform'`** for movements that belong to no workspace:
  signup grants, transfers, deposits, withdrawals, admin adjustments.

`agent_balance_snapshots` is a cache rather than the only record; if it and
the ledger ever disagree, the ledger is right.

### What the tests enforce

| Test | Enforces |
|---|---|
| `credit-ledger-ownership.test.ts` | no file but `services/credits.ts` writes `agents.balance`; `reset-economy` stays deleted. Distinguishes creating a row at zero (fine) from zeroing an existing one (the reset-economy shape). |
| `credit-ledger-reconciliation.test.ts` | `sum(credit_ledger) == agents.balance` per participant after grants, buys, a sell, a pool injection and a void; every row's `balance_after` replays; and a hand-written balance change is detected, so the check can actually fail. |
| `metric-edit-does-not-void.test.ts` | words edit in place with the market, price and positions intact; revisions logged with old and new; rename syncs `markets.metricName`; machinery 409s while open and applies once closed. |
| `market-freeze.test.ts` | each of the three destructive paths refuses for its own reason and allows the case it should; `voidMarket` itself stays unfrozen so the engine keeps working. |
| `ledger-append-only.test.ts` | the trigger on both new tables, in both directions. |

**Aggregate in SQL, never in JS.** Pulling the `trades` table into memory
unaggregated OOM-kills the process, and `credit_ledger` grows faster than
`trades` does. The reconciliation query sums database-side; every ledger reader
must too.

## Reconstruction

With all three invariants holding, a workspace's money state is derivable from
five append-only tables: `trades` (who bought what at what price),
`liquidity_events` (who funded which pool), `credit_ledger` (every balance
delta with its reason), `metric_definition_revisions` (what each market was
settling on at each moment) and `proposal_revisions` (what each contract's
words and ask were at each moment). Losing `agents.balance` costs nothing but
a replay; losing any of the five is unrecoverable, which is why all five carry
the append-only trigger.

Known gap, not closed: `DELETE /api/workspaces/:id` still deletes that
workspace's `trades` and `liquidity_events` under `allowLedgerAdmin`, while its
`credit_ledger` rows survive. Reconciliation still holds, but the trades that
justify those rows are gone. Soft-deleting workspaces instead is the fix and is
not done.
