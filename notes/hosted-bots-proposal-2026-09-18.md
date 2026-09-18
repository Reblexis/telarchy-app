# Platform-hosted bots: proposal (2026-09-18)

Viktor, 2026-09-18: "its time to start adding support for platform hosted bots".

Status: proposal. Nothing is built. Four decisions at the bottom are Viktor's;
each carries a recommendation.

## Why now

The 2026-09-01 funnel baseline (`GET /api/admin/participant-funnel`): 94 owned
bots registered in a week, 0 ever traded. A person creates the identity on
/agents and then has to find a machine, a runtime, a schedule and a model key
before anything happens. A hosted bot removes all four: the owner writes what
the bot should do, funds it, and it trades.

Today's docs say the opposite on purpose. `docs/audience-pages.md` ("no
control ... claims that creating an identity starts a hosted process") and
`docs/guides/build-agent.md` ("Neither requires ... Telarchy-managed hosting")
both change if this goes ahead.

## What a hosted bot is

An owned bot (same `agents` row, same owner, funded at creation from the
owner's balance, a separate entity on every board) whose cycles the platform
runs. The owner supplies prose, never code:

- a strategy, in words ("fade anything that moved more than 10 points on no
  news", "only chess books, trust the engine eval in the thread")
- which floors or markets it watches (default: the floor it was created from)
- a model, from a short list
- how often it runs

The platform supplies the loop, which already exists: the house traders
(`reference-astra`, `claude-fable`, `gemini-flash`) all share one runner in
`telarchy-agents/cli-agents/reference-astra/` with pluggable model backends.
It reads a market, asks a model for a value and a stake, files the forecast,
trades toward it and says why under the market. A hosted bot is that same
runner with the owner's prose in place of `strategy.md` and the owner's bot
key in place of the house key.

Prose only is the safety line. We never execute an owner's code, so there is
no sandbox to build and nothing to escape from. The bot holds one key, its
own, which can do what any participant can do and nothing more.

A hosted bot is NOT `platformOperated`: the judgment is the owner's, so it
counts as an outside forecaster and earns season score like any bot. Its
profile says "hosted by Telarchy" so nobody mistakes whose hardware it is.

## What the owner sees

On /agents, the new-bot bar gets a second way to finish: "Run it here" next
to the existing setup prompt. It opens the strategy box, the model pick and
the cadence. The bot's row then shows: running or paused, last cycle, next
cycle, what it spent on compute today, and the last few things it did, each
linking to the trade. Pause, edit the strategy, delete. The strategy box is
the whole product; the first screen should be usable in under a minute.

## Pieces to build

1. Doc: a new `docs/hosted-bots.md` (what it is, the owner's inputs, the
   cycle contract, limits, who pays), plus the two sentences above reversed,
   `/api/help`, the skill.
2. Data: a `hosted_bots` row per bot (strategy text, model, cadence, scope,
   state, daily compute budget) and a `hosted_bot_runs` log (started, ended,
   model cost, what it did, error).
3. API: create, read, update, pause, delete, list runs. Owner only
   (`lib/manages-floor` style check on ownership, not on the workspace).
4. Runner: generalise the reference runner to take (key, strategy, scope,
   model) from a queue instead of a folder. One worker pulls due bots and
   runs them one after another with a hard per-cycle time and cost ceiling.
5. Page: the /agents changes above. Goes through a /design pass first.
6. Limits, tested by name: a bot never spends more compute than its daily
   budget; a paused bot never runs; a bot with zero credits does not call a
   model; one owner's broken bot never delays another's.

Order: 1, then 2 to 4 behind a flag with one of our own bots as the first
tenant, then 5.

## Decisions for Viktor

### 1. Who pays for the model calls

Credits are play money and can never become cash, so compute is a real cost
with no real revenue behind it unless we add one.

- A. **Platform pays, tightly capped (recommended to start).** One hosted bot
  per account, cheapest model (gemini-flash), a fixed number of estimates a
  day. At flash prices that is cents per bot per month. It is the only option
  that fixes the 0-of-94 problem, because every other option adds a step.
- B. **Bring your own model key.** Unlimited, any model, costs us nothing. But
  we then store other people's provider keys, and it is a step most people
  will not take. Good as the upgrade path from A, not as the door.
- C. **Paid plan (Stripe).** Bigger models and more cycles for money. The
  first real revenue line, and the right answer eventually, but it needs
  pricing, billing and support before one bot runs.
- D. **Charge trading credits for compute.** Makes credits a sink, which the
  economy could use, and `spentTokens` already exists on the balance. But it
  turns play money into something that buys a real service, which is the
  direction the redemption rules exist to keep us away from. Not recommended
  without a ruling.

Recommendation: A now, B second, C when there is demand to price.

### 2. Where the runner lives

- A. **The kpi-sync box, next to the house traders (recommended to start).**
  Already runs this loop on a timer, deploy is `git pull`, zero new infra.
  One box is a ceiling of maybe a few hundred bots at a 15-minute cadence on
  a fast model, which is a problem worth having.
- B. **A Cloud Run job in telarchy-app's project.** Scales, shares the deploy
  pipeline and the database, but the runner is Python and the app is Node, so
  it is a second service to build and watch.

Recommendation: A, with the queue in the app database so moving to B later
changes where the worker runs and nothing else.

### 3. How much freedom the strategy gets

- A. **Prose plus the fixed tool set the house traders have (recommended):**
  read the market, the thread, the sources, search the web, return a value
  and a stake.
- B. Also let it propose, comment freely, fund liquidity, transfer credits.
  More interesting bots, and a much bigger abuse surface (spam under markets,
  credit laundering between an owner's bots).

Recommendation: A. Trading and one explanation per trade, nothing else, until
we have seen what people write.

### 4. Do house rules change for hosted bots

A hosted bot on the free tier runs on a small model against house traders on
frontier models with no stake cap. It will mostly lose to them. That is
honest, but a first bot that bleeds out in a day is a bad first day. Options:
leave it (recommended, the strategy is the owner's edge, not the model), or
keep hosted bots off books the house traders have already priced.
