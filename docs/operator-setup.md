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

**Built 2026-08-22: he is on the door.** `/manage` is Otto now, not a form
(`src/components/SetupChat.tsx` against `POST /api/setup/ask`). Same character
and the same hands as on a floor: `ottoApiTools` replays the caller's own
request, so the workspace he opens is opened BY them and refused by the same
middleware that would refuse them. No service credential exists in that path,
and adding one is the change that would make him dangerous.

His job description is `functions/src/lib/setup-brief.ts`: find out what they
run, argue for one number (favouring one a machine publishes over one they type
in), settle where its value comes from, its ceiling and the month it lands in,
open it, and hand over a paste-ready prompt for their own agent to push the
number with `PUT /api/metrics/:id`. He is told to ask one question at a time,
because a wall of questions is the form they came here to avoid.

One rule is structural rather than prompted: the page's link to a new floor
comes from `opened`, which the route reads back from the database after the
turn. Otto can say "your floor is live" when nothing was created, and a door
that trusted his prose would be worse than the form it replaced. Pinned by
`setup-ask.test.ts` and `SetupChat.test.tsx`.

**The specification, and Otto writing the handoff against it (2026-08-23).**
Owner direction: *"i want the prompt to be generated by the agent.. based off
of specifications.. this way the prompt can be a lot more personalized and
accurate"*. `functions/src/lib/setup-spec.ts` is now the governing list of what
has to be decided before a floor is worth anything, and it has three readers:
Otto's brief (so he works through what is open instead of wandering), the
handoff prompt (so the operator's agent is told what remains), and
`GET /api/setup/checklist` (so that agent can ask the API instead of trusting
a prompt written an hour ago).

The nine decisions: the floor, the number, keeping it true, what traders see,
liquidity, contracts, who can trade, your side of it, getting it read. The
owner named the first six; the last three were added because a floor fails on
them just as hard. Their content is in the file, with what settles each and the
endpoint that does it.

Otto writes the handoff now (`services/setup-handoff.ts`). He may, because he
is not trusted about anything checkable: every id and address is given to him in
a FACTS block built from the database, `guardFacts` discards the whole prompt if
it names an id or a floor address that was not in that block or leaves a
`<placeholder>` behind, and any failure falls through to the dull template. The
page always has a prompt; it is only sometimes the personalised one. The first
instruction he is required to write is "call GET /api/setup/checklist", because
the prompt carries intent and the endpoint carries state.

**A market opens holding zero liquidity, and this is where that surfaced.**
`AMM_DEFAULTS.liquidity` is 0, so a metric created without funding produces a
market that renders perfectly and refuses every trade. Until 2026-08-23 the
setup path walked straight past it, which means "ends on a live floor" was not
true for a self-serve floor. It is now in the specification (`liquidity`), in
the checklist's `blocking` list in those words, and in Otto's instructions with
the number to suggest. Fixing the default is a money decision (a house subsidy
on every self-serve floor) and belongs to the owner, so nothing here changes it:
the operator funds their own market out of their signup credits.

**The handoff, first built 2026-08-22.** Beside the conversation sits
a prompt for the operator's OWN agent: the transcript so far, what has actually
been created with its real ids, and the calls left to make. The reason it
exists is that this page is not the best place to finish the job. Their
assistant knows their business, their repo and where their numbers really live;
Otto knows what they have typed. `functions/src/lib/setup-handoff.ts` assembles
it deterministically rather than asking Otto for it, because a model restating
a workspace id gets one wrong eventually and the agent on the other side would
act on it.

The page is shaped like the assistants people already use (owner direction: "it
should be similar to chatgpt design"): a greeting, one wide rounded composer,
a few suggestions. It is the one place in the product that borrows a convention
wholesale, and it borrows it because the convention is the point: nobody
arriving here has to be taught what the rectangle does. It stays in the house
palette and type, so it is our page in a familiar shape rather than a skin of
someone else's product.

The email door stays underneath it, because that is how the first operator
actually arrived and some people would rather write to a person.

Still missing, unchanged: inbound email, and any web access for him.

Most of this needed no new capability. Otto's two tools are "find an endpoint"
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
