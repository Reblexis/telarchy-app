---
title: Open a floor
description: Create the workspace, put the first number on it, fund the book, and decide who else can act.
category: run
order: 10
---
# Open a floor

A floor is one workspace: your numbers, the markets on them, and the contracts
people offer you against them. Opening one takes two API calls.

## There is no admin console

Workspace administration lives in the API. The browser console was deleted on
2026-08-19 and nothing replaced it, so every instruction of the form "open the
settings page and click save" is dead. What exists in a browser today, on a
public or unlisted floor, is the trading page itself, and on it the owner gets
four things:

- the approve, decline and remove bar on each contract,
- the hero metric's description, edited in place,
- the "What is *name*?" blurb,
- announcements, published and edited at `<floor>/announcements`.

All of those are gated on the `manage` capability, and so is creating the
floor itself: any signed-in visitor opens one from the home page. Permissions,
liquidity settings and deleting are still HTTP calls. A **private** workspace
has no browser page at all: the floor route answers 403, so its members work
through the API only.

Otto is the other way to do the same work, and he is on the floor rather than
behind a separate door. He is a conversation, not a form, and he makes the
same calls you would, as you. If you would rather answer questions than write
JSON, ask him there.

`GET /api/help` is the live endpoint catalog, generated from the routes.

## Open the workspace

```
POST /api/workspaces
{ "name": "Northwind", "template": "saas",
  "templateParams": { "currency": "USD", "revenueRangeMax": 100000 } }
```

`name` is the only required field. It returns 201 with
`{ id, name, slug, ownerHandle, visibility, template, metricsCreated,
starterProposalId }`.

**A template seeds leaf metrics so you do not start on a blank page.** Each one
is a flat list with a description, a market range and a half-life already
chosen. The ids: `saas`, `ecommerce`, `marketplace`, `consumer-app`, `agency`,
`community`, `creator`, `oss` for a business; `wellbeing`, `health-fitness`,
`career`, `learning`, `relationships`, `creative-project`,
`financial-independence` for a person; `blank` for nothing. `templateParams`
takes a `currency` (ISO code, defaults to USD) and a `revenueRangeMax` for the
primary monetary metric. Everything a template writes is editable afterwards.

**A new floor lands on `unlisted`, which answers nobody but its own people.**
Omitting `visibility` gives you unlisted, and asking for `public` is clamped
down to it. Listing stays a human decision while a real-money season scores
over every public workspace.

Unlisted grants a stranger nothing: the same 403 a private floor gives, on
every route. It is a floor the owner has not published yet, not a floor with
an unadvertised address. Its owner and its members reach it normally, and it
shows on the owner's home page like any other floor of theirs.

**Three floors per account.** The fourth `POST` returns 429 with the cap in the
body and a link to ask for more.

**The slug comes from the name**: lowercased, every run of non-alphanumerics
turned into one hyphen, made unique against every slug you have ever used. The
floor is at `telarchy.com/<slug>`. Renaming mints a new slug and keeps the old
one in an alias table, so `GET /api/workspaces/resolve?owner=&slug=` still
finds the workspace and tells the client to rewrite the URL. The id never
changes at all, so `telarchy.com/marketplace/<id>` is the link to hand out if
you expect to rename.

## Put a number on it

```
POST /api/metrics
{ "name": "Net revenue 2026 (USD)",
  "description": "Stripe gross minus refunds and approved contracts, read on the 1st.",
  "value": 0,
  "marketRangeMax": 250000,
  "timePreference": { "enabled": true, "halfLife": 1 } }
```

Needs the `manage` capability. Every field and its default:

| Field | Default | What it is |
|---|---|---|
| `name` | required | The metric's identity. Formulas reference it by exact name, and a trailing `(USD)` marks it as money. See [metric design](/guides/metric-design). |
| `description` | `""` | The settlement text. Write it as the resolution source, because this is what a trader reads before pricing you. |
| `value` | `0` | The current reading. Ignored on a metric with a formula. |
| `formula` | `"0"` | Empty or `0` means a leaf. Anything else makes it computed. See [formulas](/guides/formulas). |
| `marketRangeMax` | `1000` | Upper bound of every market on this metric. Leaf metrics only; must be positive. |
| `timePreference` | `{ enabled: true, halfLife: 1 }` | Which future dates get markets. Pass `null` for no curve. See [time preference](/guides/time-preference). |
| `resetsEvery` | `null` | `hour`, `day`, `week`, `month` or `year` when the number restarts each period. Null when it accumulates or is a level. |
| `resolvesNaUntilMeasured` | `false` | When true, markets void as N/A while the metric has no reading rather than settling on 0. |
| `order` | 999 | Display order. Not settable here; use `POST /api/metrics/reorder` with an array of ids. |

There is no `target`, no `granularity` and no `unit` field. Granularity is
derived from the dates markets open on, currency is read from the name, and a
goal line is a market rather than a column.

**Get `marketRangeMax` right before the first market opens.** A market copies
the range at spawn time and prices inside it, ranges start at zero, and
settlement clamps the actual value to the range top. A metric that can reach
500,000 on a range of 1,000 settles at the ceiling and pays every "higher"
holder in full no matter what happened. You cannot change the range while a
market is open, which is the next section.

## Editing, and the two edits that are refused

Since 2026-08-18, editing a definition does not void markets. That rule splits
the fields in two.

**Words apply in place.** `name` and `description` change at any time, with the
market untouched: same price, same pool, same trades, same positions. A rename
also syncs the name markets display. Each change writes an append-only row to
`metric_definition_revisions` recording the field, the old value, the new value
and who changed it. There is no endpoint serving those rows today, so treat the
table as an internal audit trail rather than as disclosure to your traders. If
a reworded definition changes what the market settles on, say so in an
announcement.

**Machinery is refused.** `formula` and `marketRangeMax` are what an open market
settles on, so changing either while any market on that metric is unresolved
returns 409 naming the field and the market. Wait for it to resolve, or void it
deliberately first.

A `value` sent to a computed metric is not refused and not stored: the route
sets the stored value to 0 and returns 200, because a computed metric reads its
formula and nothing else. To move the number, change the formula or the leaves
it reads.

**Deleting a metric** is refused with 409 once an open market on it has been
traded, because deleting voids those markets and voiding takes money off people
who chose to put it there. The 409 says how many participants hold positions.
Untraded markets do not block it.

**Voiding a traded market is possible and deliberately loud.** `POST
/api/predictions/markets/:id/void` refuses a traded market unless you send
`acknowledgeTraded: true` plus a `reason` of at least ten characters, which is
published on the market's resolution event. Holders get their net cash back;
what they lose is the position and the price discovery, never their money.

**There is no economy-wide reset.** `POST /api/system/reset-economy` does not
exist and is not coming back. Starting over is `DELETE /api/workspaces/:id` and
creating a new one, and even that is refused with 409 while a running prize
season scores the workspace.

The one destructive endpoint that does exist is `POST /api/metrics/logs/purge`,
which deletes reading rows: one metric with `{ metricId }`, the whole workspace
without it. It destroys the history markets settle against, so there is no
reason to run it on a live floor.

## Give the market a book

The pricing engine is an LMSR with a depth parameter `b`. Everything you fund is
denominated in credits, and those credits are the market's pool: `pool = b * ln
2`, so `b = pool / ln 2`. Two consequences to know:

- **Price impact scales as one over `b`.** Double the depth and, per credit
  traded, the price moves half as far. Thin markets swing on pocket change; deep
  ones need conviction.
- **A conditional pair opens at the baseline price** rather than at the middle
  of the range, which costs a slightly thinner book for the same money, because
  an LMSR that starts off centre has a larger worst case to cover.

The default of 0.5 credits per market is deliberately small, and it is thin
enough to matter: measured on the beta, one five-credit trade against a market
funded that way moved the forecast from the middle of the band to its ceiling.
The platform's own test of a readable market is whether a five-credit trade
moves the consensus by more than a fifth of the range. If it does, fund it
more.

**A market with `b` at or below zero has no price and refuses trades.** The
consensus is undefined, the floor shows nothing to read, and a trade returns 400
saying someone has to fund it first. This is the single most common reason a
floor looks broken.

Two workspace settings decide whether that happens to you:

- `autoFundNewMarkets`, on by default at creation.
- `newMarketLiquidityCredits`, 0.5 credits per new market at creation.

Both need the granular `manage_workspace` capability, and turning auto-fund on
requires the owner to have a participant record with a balance to spend.

**Funding is partial rather than all-or-nothing.** When your balance covers only
some of the new markets, the affordable ones are funded at the full rate now and
the rest open unfunded, to be picked up by a later refresh as the balance
allows. That beats the old behaviour, where a day's rollover left every market
at zero because the balance was short of the whole day's need. A contract's
conditional markets follow a different rule, described in
[deciding a proposal](/guides/proposals).

Funding one market by hand is `POST /api/predictions/markets/:id/liquidity
{ amount }`, and it needs only `trade`, not `manage`: anyone who can trade a
market can deepen it. Funding it out of *another* participant's balance is the
part that needs `manage`.

**There is no 0.1 credit minimum.** The only floor is the storage precision,
one nanocredit, so an amount cannot round down to zero and create a market with
no book. A thin market is a risk you are allowed to take.

Your account starts with whatever the signup route you used grants; a
participant registered through the API starts with nothing and is funded by
transfer or by a workspace admin. Every grant is priced in a live table
published at `GET /api/earn`, so read it rather than a number in a guide.

## Who else can act

**Trading happens on a PUBLIC floor and nowhere else.** A floor that is not
public is for building the thing: writing metrics, adding dates, funding
books, inviting the people who will trade. Nobody trades on it, including its
owner and its members, and a resting limit order on it does not fill. It
starts trading the moment it is published.

The reason is the prize season. A season scores every workspace that is public
at settlement, over every market that resolved inside its window, so a floor
that could be traded in private and published at the end contributed a whole
month of score at once, with nobody having seen any of it
(`notes/bug-hunt-2026-08-31.md`, P1-9; owner decision 2026-09-01: "trading
should be possible on public workspaces only, private is for now only for
management and initial creation"). Trading only where everyone can watch makes
that shape impossible rather than merely against the rules.

Two independent switches decide who sees a floor.

**Visibility** is `public` (listed on the front page and readable by anyone)
or `unlisted` / `private` (no public page, 403 from every public route, and a
join attempt answers 404 so the endpoint cannot be used to probe for workspace
ids). **`public` is the only value that answers a caller with no identity.**

Unlisted and private differ in intent, not in access: unlisted is the state a
floor is born in and returns to, private is the state an owner chooses. Both
are readable by their owner and their members and by nobody else.

Before 2026-09-01 unlisted answered anonymous reads addressed by id OR SLUG,
and the slug is derived from the floor's name, so a stranger who guessed a
company name read every metric name, description, formula, current value and
up to 500 points of history. That was the default a new floor was created
with, which made it the answer to "can a founder paste confidential KPIs into
this" - and the answer was no. Records: `notes/bug-hunt-2026-08-31.md`, P0-7.

**Whether the Public group holds `read`** is the second switch, and it is not
implied by the first. A public workspace whose Public group lacks `read` keeps a
counts-only boundary: metric names, market prices and counts are visible, while
logged values, contract text and chat need membership. Granting the Public group
`read` makes it an open floor, where the whole ballot is in the public payload
because anyone is one free self-join away from it anyway. An anonymous reader
gets `read` and nothing more, even on a floor whose Public group also holds
`trade`, because there is no account to debit.

Flipping a floor OFF public - to private or to unlisted - also strips `trade`
from the Public group in the same transaction, so trading rights granted while
it was open do not survive.

**Capabilities** are `read`, `trade`, `manage` and `manage_workspace`. It is a
flat set with no implication chain.

> **`manage_workspace` is not implied by `manage`, and the Admin group does not
> have it.** A teammate you add with `role: "admin"` lands in a group carrying
> `read`, `trade` and `manage`. They can approve contracts, edit metrics,
> publish announcements, edit the charter and manage groups. They get 403 on
> every lifecycle setting (`visibility`, `autoFundNewMarkets`,
> `newMarketLiquidityCredits`, `proposalReward`, `spamPenalty`,
> `maxPendingProposalsPerParticipant`) and they
> cannot delete the workspace. In practice only the creator can, because the
> creator gets every capability by being the creator and no group hands
> `manage_workspace` out.

If you want a teammate to hold it, grant it explicitly:
`PUT /api/groups/:id { "capabilities": ["read","trade","manage","manage_workspace"] }`.

**Per-metric permissions** are a map on a permission group, and only half of it
does anything. Marking `trade: true` on a metric for a group *restricts* that
metric's trading to that group's members; a metric no group has marked is
tradeable by everyone with `trade`, and anyone with `manage` bypasses the
restriction. The `read` half of the same map is stored, validated and enforced
nowhere, so do not promise anyone that a metric is hidden from other members.
Per-source `read` is a different field and is enforced; that is how you publish
a document to the floor or keep it internal.
