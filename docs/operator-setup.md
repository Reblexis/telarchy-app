# Setting up an operator

**Status: open design question, owner-directed 2026-08-22.** Viktor: *"we want
to redesign the operator view completely.. we have to figure out how we would
set him up first what we would even offer etc"* and *"dont restore the previous
workspace creation process as that will work different now"*. This doc holds
the question, what is already decided, and the options. The old
create-workspace wizard is not the answer by default. What has been built
against it so far is at the bottom, under "Shipped against this doc": two
owner controls on the floor itself, which are deliberately the smallest thing
that does not presume an answer to the question above.

This doc owns: what Telarchy offers an operator, and what setting one up
consists of. `vision.md` owns whether the owner side is open at all (it is,
since 2026-08-21). The permission layer is done and documented there; this is
the layer above it.

## Why the question is open

The API can create a workspace, and since 2026-08-22 anyone signed in may call
it. That is not an offer. It is a database row plus an empty page, and the
previous surface for it, the console's create-workspace wizard, asked the
operator to configure a product they had not seen work yet: name, template,
metrics, formulas, time preference, visibility, auto-funding. Every one of
those is a question Telarchy should be able to answer better than a stranger
on their first minute.

The current reality is the opposite extreme and worth naming honestly: the
first operator (Kleros, `outreach/concierge/lesaege-2026-08-21-reply.md`) gets
set up by a human, in an email thread, with the workspace opened by hand while
he is still in the conversation. That works, does not scale, and is the only
version that has ever produced a live floor.

## What is already decided

These are settled and any design has to hold them.

- **It ends on a live floor, never on a settings page** (`vision.md`,
  2026-08-21). A workspace with no market is a dead end, and a metric only gets
  a market when it carries a horizon.
- **The commitment we take is a decision, not money** (2026-08-21, pricing
  section of the Kleros note). The ask is one real decision, with a date, that
  the operator agrees to read the price on before making. We cannot bill yet
  (item 3 of "The owner side reopens" is legal-gated), so this is the only
  currency we can actually collect.
- **A new floor starts unlisted.** Listing is a human decision while a prize
  season scores every public workspace.
- **Liquidity is the operator's steering wheel** (`vision.md`, "Decision
  quality scales with capital"). Whatever the setup produces, it eventually has
  to let the operator move credits onto the decision that matters this week.
  Item (2) of "The owner side reopens" is unbuilt.
- **The floor leads with the company, not the market** (AGENTS.md, 2026-08-18).
  Whatever we collect at setup has to include the things that identity block
  renders: the company's name, one line of what it sells, and the number.

## The actual question

What does an operator get in exchange for putting their number in public? Three
candidate answers, and they imply different products:

1. **A priced decision.** They name a decision, we get it priced by traders and
   AI participants, they read the number before they act. Setup means eliciting
   ONE decision and one metric it moves. This is what the Kleros email sells and
   what the mechanism is actually for.
2. **A market on their number.** They name the number, the market forecasts it,
   they watch. Cheapest to set up, and the weakest offer: it is a chart, and the
   Kleros draft explicitly refuses to build one.
3. **A workforce.** They post paid contracts, strangers propose work, the market
   prices which proposals would move the number, they approve on a calibrated
   figure. This is the floor as it exists today for LookPilot, and the most
   valuable of the three, but it needs a supply of proposers who care about
   their number.

My reading: (1) is the offer, (3) is what it grows into, and (2) is the failure
mode to design against. That ordering is a recommendation, not a decision.

## What setup would then consist of

If the offer is (1), setting up an operator is an interview, not a form. The
things that must exist at the end are:

- The company: name, one line of what it sells.
- One number, with where its value comes from stated well enough to settle on,
  and a plausible ceiling so the market has a band to price inside.
- One horizon, so a market exists.
- **One named decision with a date**, which nothing in the schema holds today.
  The nearest existing surfaces are the workspace charter (the owner's public
  commitment) and a contract on the floor. If the decision is the thing we sell,
  it probably deserves a field rather than a paragraph.
- Enough context for AI participants to forecast it, which today means a Source
  briefing (`program.md`, forecaster-context strategy).

Who does the eliciting is the fork in the road:

- **A human (today).** Highest quality, zero scale, already happening.
- **An agent.** The `agent-onboarding` guide already scripts this conversation
  for Claude Code and friends, and an operator who arrives with an agent is the
  Telarchy-native case. It is also the only version where "we would set him up"
  and "he sets himself up" stop being different things.
- **A screen.** A form is the worst of the three unless it is doing something a
  conversation cannot, and if it exists it should be the record of the
  interview, not a substitute for it.

## Open questions for the owner

1. Which of the three offers above is the one we make? (Recommendation: 1,
   growing into 3.)
2. Is the first-run experience a conversation with a human, a conversation with
   an agent, or a screen?
3. Does "a named decision with a date" become a first-class object, or stay
   prose in the charter?
4. Does an operator arrive through `/manage`, through an agent holding their
   API key, or through us? Today it is us, and `/manage` is still a door to a
   conversation rather than a form.

## Tried and removed: owner controls on the floor

**Removed 2026-08-22 the same day it was built, owner direction: "lets remove
what you did the in workspace settings thats weird".** `FloorOwnerTools` put
two controls at the bottom of the floor for anyone with `manage`: add a number,
and deepen the market on screen. Both worked and both went through the
documented endpoints. The objection was not the endpoints, it was that a
settings surface bolted onto the market page reads as furniture: the floor is
where a visitor reads a price, and an owner's configuration sitting under it
belongs to a different product.

Keep the finding, not the code: the two operations are right (a number needs a
horizon or there is no market; liquidity has to follow the clock the owner is
looking at). What was wrong was making them a form on the floor. They are now
things Otto does when asked, which is the direction below.

## The direction: Otto sets the operator up

**Owner direction 2026-08-22.** Rather than a screen, the setup is a
conversation with Otto: he works out what the person runs, proposes the number,
and either sets it up himself when the value is public, or hands them a
paste-ready prompt for their own AI agent to push the number on a schedule,
plus what context to share with forecasters.

Most of this needs no new capability. Otto's two tools are "find an endpoint"
and "call it, replaying the visitor's own credentials"
(`services/otto-tools.ts`), so a signed-in operator's Otto can already create
the workspace, name the metric, open the market and fund it. Three gaps:

1. **He is not reachable before a floor exists.** `FloorChat` only mounts on a
   floor page, so the person with no workspace cannot talk to him. This is the
   piece being built first.
2. **Inbound email does not exist**, and the identity problem behind it is the
   real constraint: Otto deliberately has no credential of his own, so acting
   for someone with no session would mean giving him a service key and throwing
   away the property that makes him safe to point at the API. The version that
   keeps it is a magic link: he replies, they land signed in, the conversation
   continues as them.
3. **He has no web access**, so "figure out their startup from public info"
   needs a fetch or search tool, and a fetched page is untrusted text against a
   character whose one safety rule is that only the person in the conversation
   gives him instructions.

The generated agent prompt needs nothing new: `PUT /api/metrics/:id` with a
value is the whole auto-update path, and Sources is the whole "what context to
share" path.

## What exists right now

- `POST /api/workspaces`: open to any identity, 3 per account, `public` clamped
  to `unlisted`. Tests: `functions/src/__tests__/workspace-self-serve.test.ts`.
- `POST /api/metrics` with `timePreference.customHorizons` and
  `marketRangeMax`: the call that turns a workspace into a live floor.
- `POST /api/onboard`: paused (403). Reopening it is a separate abuse question,
  since it needs no account.
- `/manage`: the pitch and the email door. Unchanged.
- `docs/outreach/concierge/`: how a human runs the setup today.
