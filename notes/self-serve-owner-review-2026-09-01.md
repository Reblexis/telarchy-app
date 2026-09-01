# Can a stranger open a floor and run it? A review, 2026-09-01

Owner ask: "what else is to be done so that managing workspaces works and
anyone can create and work on their own".

Method: the newcomer path walked end to end against a clean local stack
(`docker compose up`, the same one CI's fresh-clone job runs), plus the
production database read for what real self-serve floors actually got. Each
finding below carries the file or the row it came from.

## What already works

Signing up and opening a floor works, with no operator in the loop. On a
fresh instance: `POST /api/auth/sign-up/email` (email and password, plus
Google and GitHub where configured), `POST /api/auth/consent`, then
`POST /api/workspaces` returns `201 {slug, ownerHandle, visibility:
"unlisted"}`. Adding a metric with `timePreference.customHorizons` opens
markets straight away. Publishing is refused until a metric exists ("Add a
number first"), then `PUT /api/workspaces/:id/settings {visibility:
"public"}` succeeds and trading opens on the floor. The three-floors-per
account cap applies and says how to lift it. None of that needed an admin.

The gap is not creating. It is running.

## 1. Every new floor prices its markets at half a credit

`DEFAULT_MARKET_LIQUIDITY_CREDITS = 0.5` (`functions/src/lib/validation.ts`)
is what `provisionWorkspace` writes on every workspace
(`functions/src/lib/participants.ts`), with auto-fund on. Production agrees:

| Floor | Auto-fund | Credits per new market |
|---|---|---|
| ycat | on | 0.5 |
| Manifold | on | 0.5 |
| Harbour Roasters | on | 0.5 |
| Manifold Markets | on | 50 |
| Telarchy | on | 250 |
| LookPilot | on | 700 |

The three at 0.5 are the self-serve ones. The deep ones were set by hand.

What 0.5 credits buys, measured on the local stack: a market opened with
`pool 0.5`, `b 0.167`, and one 10-credit trade moved it from the midpoint to
the ceiling (`probability 1`, consensus pinned at `rangeMax`). So the first
thing a stranger's floor does is publish a price that any trade destroys.
The setup checklist already knows this and says so in the right words
("Auto-funding 0.5 credits per market, which is too thin to price anything",
`functions/src/services/setup-checklist.ts`) but the default it complains
about is the one we ship.

Decide: a starting depth a floor can actually be read at, or a first-market
depth derived from what the owner holds. Either way the number in
`validation.ts` is the whole fix, and `docs/owner-on-the-floor.md` owns the
sentence that justifies it.

## 2. A new owner holds 100 credits, which cannot fund a floor

`signup_user` pays 100 credits (production `earn_rules`; `link_oauth` adds
200 for attaching a provider). LookPilot funds each of its markets with 700.
So even an owner who understands the depth problem cannot fix it from the
grant: the only route to more is `/<floor>/funding`, which is real money
through Stripe, minimum $5, and only exists on an instance with Stripe keys.

Nothing grants an owner a starter pool for their own floor. Until something
does, "anyone can run their own" means "anyone who pays on day one", and the
funding page is the second screen a new owner meets.

## 3. Trading is refused on an unlisted floor, and the docs promise the opposite

`functions/src/services/trading.ts` refuses every trade on a floor that is
not public (`workspace_not_public`), a deliberate 2026-09-01 decision to stop
a floor being traded in private and published at the end of a season. But
`docs/vision.md` still says a new floor is "live and tradeable at its link",
and that is now false: the owner cannot place a single trade on their own
market to see what it does before publishing it to the world. Either the
sentence changes (done in this branch) or the rule grows an exception for
the floor's own members.

## 4. The floor's own state is only visible inside Otto's conversation

`GET /api/setup/checklist` computes exactly what a returning owner needs:
what has no description, what has no horizon, what nothing updates, how thin
the pools are, whether anyone but the owner has traded. The only surface that
renders it is `SetupChat` on `/manage`. Close the tab and it is gone: the
floor itself shows no "what is still open", and `/manage` answers a returning
owner with a fresh conversation rather than their floor.

## 5. Otto is the only door, and he needs a model

`/manage` is "Otto, and nothing else" (`src/pages/ManagePage.tsx`). With no
model configured the setup endpoint answers 503, and there is no form behind
it, so on a self-hosted instance with no AI key nobody can open a floor from
the browser at all. The conversation is also rate limited to 6 turns per five
minutes per IP.

`POST /api/agents/register` needs an existing `workspaceId`, and
`POST /api/onboard` is paused, so there is no API path from nothing to owning
a floor either. Deliberate, but it means the browser is the only door and
Otto is the only handle on it.

## 6. A floor that runs out of credits degrades silently

When the owner's balance cannot cover a spawn, `insertPendingMarkets` opens
the rest at AMM defaults and writes `console.error`
(`functions/src/services/markets.ts`). The owner is never told. There is no
notification kind for it either (`comment`, `reply`, `contract`, `decision`,
`stale`, `settled`, `anyComment` are the whole set), so the first sign is a
market that behaves oddly.

## 7. A floor is a one-person object in the browser

There is no invite, no co-manager, no permission screen. Memberships and
groups are API only, which `docs/owner-on-the-floor.md` states as
deliberate ("rare and dangerous settings"), but the consequence for
self-serve is that a team cannot run a floor together without someone
writing curl.

## 8. Two governing sentences are stale

- `docs/vision.md`: an unlisted floor is not tradeable any more (finding 3).
- `docs/owner-on-the-floor.md` lists visibility as API-only, but the Publish
  button has been on the floor since 2026-08-28
  (`src/pages/TradePage.tsx`).

Both corrected in this branch, because a governing doc that disagrees with
shipped behaviour is a bug by the rule that docs govern.

## Smaller things

- `POST /api/metrics` ignores unknown top-level fields in silence. Sending
  `customHorizons` at the top level (instead of inside `timePreference`)
  returned `201` with `warnings: []`, and the metric took the workspace
  defaults. The response already carries a `warnings` array built for
  exactly this.
- Creating a workspace through a browser session that has never called
  `GET /api/auth/me` records an owner agent id that has no agent row (the
  participant is minted lazily by that endpoint). The browser always calls it
  first, so this is only reachable by a script driving a session cookie, but
  the workspace it leaves behind has an owner nothing can resolve.

## The order I would fix them in

1. The default depth (finding 1) and the starter liquidity question
   (finding 2). Everything else is cosmetic next to a floor whose price
   means nothing.
2. The checklist on the floor for a returning owner (finding 4).
3. Telling an owner when markets open unfunded (finding 6).
4. The trading-before-publishing rule (finding 3): decide whether the owner
   may trade their own unlisted floor.
5. Invites (finding 7), when someone asks for one.
