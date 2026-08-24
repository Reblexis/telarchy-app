# The X feed: a ledger, not a voice

Opened 2026-08-24. Owner decision (Viktor, 2026-08-24): the Telarchy brand
account on X posts **only things the system can prove**, generated from the
public API by a cron, and never prose. Viktor's own account (`@viktorci`) is
where opinions and replies live, every one shown to him before it goes out
(AGENTS.md, "Never speak as Viktor without showing him the words first").

## Why a ledger

The one X post so far (2026-08-12, 15 views, `notes/launch-executed-2026-08.md`
in the telarchy umbrella) and the second Manifold market (9 views, 0 traders)
failed the same way: a cold account gets no reach, whatever the copy. A brand
account with no followers is therefore not distribution and must not be
counted as such. What it can be, from day one and at zero cost, is a public,
dated, machine-generated record of money actually paid and markets actually
opened. That record is worth having on its own: it is the receipt trail a
visitor from any other channel checks, and it is O-1A evidence that accrues
without anyone writing anything.

Corollary: no generic product copy from the brand account, ever. A Manifold
reader already flagged Telarchy's prose as AI-written; the ledger cannot be,
because it contains no sentences anyone composed.

## The account

Handle: to be created by Viktor (X requires the mobile app or a phone number
for signup). Registered to `viktor@telarchy.com`, labelled **Automated** in X
settings (X's automation policy for accounts that post by API), profile link
`https://telarchy.com`. Developer app on the free tier (about 500 posts a
month, write access; far above the cadence below). Keys live in the keyring
(`laptop/secrets/x-telarchy.env`, mirrored to the box's
`~/keyring/secrets/x-telarchy.env`), never in this repo.

## What gets posted

Three kinds, all derived from public reads of the public workspaces
(`telarchy.com/telarchy`, `telarchy.com/lookpilot`), no key needed:

1. **Receipt.** A contract moved to `approved`. Approving a contract IS the
   payment (the owner's standing rule), so the post says paid, in dollars,
   to the participant's nickname, with the contract title and a deep link
   (`telarchy.com/<slug>#contract=<id>`). If a conditional market on the
   contract actually traded (`tradeCount > 0` and `delta != 0`), one extra
   line names the market's priced impact on the metric. If nothing traded,
   the post makes no market claim at all: a price the market never printed
   is not a fact the ledger may state.
2. **Opened.** A new contract is pending: title, ask, deep link. Nothing
   about its chances.
3. **Weekly standings.** Monday 09:00 UTC: Season 0 entrants in rank order
   with the prize place they currently hold, the number of entrants, open
   markets, trades in the trailing week, verified traders, link to
   `telarchy.com/season`. Skipped while no season is running.

House contracts are not receipts: a contract proposed by one of the owner's
own accounts (`Viktor36`, `telarchy-agents`, the brother's `elonmusk`; the
list is `X_FEED_HOUSE_NICKNAMES` in the env) is never posted in any kind,
because "paid $50 to Viktor36" is the owner paying himself and the ledger
would be technically true and misleading.

Nothing else. In particular no metric readings (LookPilot's revenue is
Viktor's to publish, not a cron's), no declines (a decline reason is prose),
no comments, no replies, no reposts.

## Templates

Receipt:

```
Paid: $20 to tetraspace.
"$20: Write & publish >500 words on Tetra's thoughts on futarchy/telarchy"
Approved by the owner on telarchy.com/telarchy.
https://telarchy.com/telarchy#contract=39a343ce-...
```

Receipt, when the market traded (extra line before the link):

```
Before approval the market priced it at +2.3 Weekly active traders.
```

Opened:

```
New contract on telarchy.com/telarchy, asking $10:
"$10: I will get a user with >100k mana to link their account here"
https://telarchy.com/telarchy#contract=ddbe3f0b-...
```

Weekly:

```
Season 0, standings after week 34:
1. the-big-boss ($500 place)
2. elonmusk
2 entrants. 43 markets open, 65 trades this week, 5 verified traders.
https://telarchy.com/season
```

Titles are cut at 120 characters with an ellipsis so a post never exceeds
280 as X counts (every URL is 23, whatever its length). Numbers are read at
post time, never cached across posts.

## Cadence and limits

Every 30 minutes the poster reads the two workspaces and posts what is new
since its state file, at most 5 posts per run, so a burst of contracts
spreads over a few hours instead of flooding. At today's rate that is a
handful of posts a week; the free tier's monthly cap is not in play.

The first live run marks everything already on the floor as seen and posts
nothing, so switching the feed on never replays history. The dry run
(`x-receipts.py --dry-run --since <date>`) prints exactly what would go
out, and that output is what the owner approves before the timer is
enabled.

## Approval state

- **2026-08-24:** spec written, poster written and installed on the box in
  dry-run mode, timer NOT enabled. Waiting on (a) the X account and its
  developer keys, and (b) Viktor's sign-off on the three templates above.
  Template changes go here first; the poster follows the doc.

## Operations

Poster, unit, and timer: `agent-economy/scripts/x-receipts.py`,
`x-receipts.service`, `x-receipts.timer`; runbook row in
`agent-economy/docs/operations.md` ("x-receipts.timer"). State file on the
box: `~/state/x-receipts.json`.
