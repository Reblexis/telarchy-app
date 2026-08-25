# Decisions and records: docs/vision.md

Records evicted from `docs/vision.md` on 2026-08-25; the doc states the resulting rules in present tense. Entries newest first, each verbatim as it stood in the doc.

## 2026-08-25: Mission and vision

**Slogan (revised 2026-08-25, Viktor): "Approve on evidence, not on who argued best. See what each proposal does to your KPIs before you say yes."** The mission line, "the alignment layer for AI and humans", remains the zoom-out framing below and is no longer the customer-facing tagline (it was misread by 20 of 20 simulated readers; see the telarchy umbrella `notes/slogan-simulation-2026-08-25.md`).

## 2026-08-25: Workspace announcements

Each row says who published it: `publishedBy` is the publishing participant's nickname when that participant is not the workspace owner, and null when the owner published it, so a reader can always tell the owner's words from a delegate's (added 2026-08-25 for results-agent, the Monday results post, on the owner's decision "dont publish under my name"). The master key has no identity and publishes as the owner.

## 2026-08-24: Participant email notifications

**Revised 2026-08-24 (Viktor): notifications are a matrix, not an email list** ("its not just emails... there should be web mobile and email"). Every KIND of news is deliverable over three CHANNELS, each cell its own switch in account settings: **web** is the bell inbox, **email** is mail, **mobile** is a browser push notification (the phone shows it like an app's, with Telarchy installed from the browser menu; a desktop browser shows it too). The web cells now decide which kinds the bell derives at all, which deliberately revises the older "the bell is never filtered" rule: with kinds a person can tune per channel, an unfilterable channel would be the one exception nobody asked for. The email cells stay on the participant row's boolean columns; the web and mobile cells live in `agents.notification_channels` as overrides over defaults (`lib/notification-prefs.ts`), so an untouched account stores nothing. The mobile channel's addresses are `push_subscriptions` rows (one per browser, upserted on endpoint), sent via Web Push/VAPID (`lib/push.ts`; VAPID keys in Secret Manager, nothing sent when unset), and a subscription revoked by the browser is deleted on the first 404/410.

Kind stamps in the same section: `settled` "(web on, email on, mobile on; added 2026-08-24)"; `decision` "(web on, email on, mobile on; widened 2026-08-24)".

## 2026-08-24: The notifications inbox

Which kinds the bell derives is set by the matrix's **web** cells (revised 2026-08-24, with the matrix itself; until then the bell was deliberately unfiltered).

## 2026-08-24: Business Model

**Decided direction: open source under AGPL, after a security gate.** **DECIDED 2026-08-24 (Viktor)**, superseding the "MIT once the network is a moat" plan below it: telarchy-app will be published as a clean-root snapshot into a fresh public `Reblexis/telarchy-app` under AGPL-3.0-only with a CLA, once three gate items are done (master key rotated with an `API_KEY_PREVIOUS` grace window, the `Function()` formula evaluator replaced by a sandboxed parser, a secret scan of the published tree) and the `docs/` tree is triaged against a default-deny allowlist. telarchy-skill stays MIT (already public); telarchy-agent-python-example goes public under Apache-2.0; the agent-economy stack, the telarchy umbrella and the keyring stay private; a small private deploy repo keeps the managed service running from public `main`. Why AGPL and not MIT: no license stops a from-scratch rebuild, so the license only governs what people do with our own code, and there AGPL keeps the option to relax to MIT later (MIT can never be withdrawn), forces hosted forks to publish their changes, and preserves dual licensing for enterprises. Why now and not "once the network is a moat": there is no moat today (11 participants, 92 trades), so publishing costs nothing on the moat; the release is a trust and discovery bet, whose success is defined up front as 5 GitHub-attributed activated participants within 30 days plus one outside PR merged from a funded issue. Full design record: the open-source decision note in the telarchy umbrella (private). **DONE 2026-08-25**: the gate is closed and `LICENSE` (AGPL-3.0-only) is committed.

## 2026-08-24: Infrastructure

**revised 2026-08-24**: the instance's identity is three variables with the managed instance's values as defaults: `PUBLIC_ORIGIN` (links in mail, share cards and the operator handoff), `MAIL_FROM`, `PRIVACY_CONTACT`; `/account` lands on the instance's first public workspace, not a named one; nothing in the code names telarchy.com except those defaults.

**revised 2026-08-24**: the image migrates its own database on start when `AUTO_MIGRATE=true` (compose sets it; the managed deploy migrates in its workflow and leaves it unset), so first boot on an empty database yields a working instance; the treasury key is asserted only when `USDC_SETTLEMENT_ENABLED=true`.

## 2026-08-22: Trader-first sequencing

**Half of (1) shipped, and the half that shipped is the permission (2026-08-22).**
`POST /api/workspaces` is open to any identity: a browser session or a
participant key, no invite. Two brakes for callers who are not platform admins,
both about the shopfront rather than about trust: three workspaces per account,
and `public` clamped to `unlisted` at creation, so a new floor is live,
joinable and tradeable by link but is not listed on telarchy.com until a human
lists it. The clamp is not tidiness. A running prize season scores over every
public workspace (`docs/seasons.md`), so self-serve listing would let someone
open a floor, subsidise it out of signup grants and extract that subsidy into
an entered account; listing stays a human decision until that hole is closed.
`POST /api/onboard`, the unauthenticated one-call variant, stays paused: it
mints an identity and a workspace together, so there is no account for the cap
to count.

**The screen is deliberately NOT the old creation wizard (owner direction,
Viktor, 2026-08-22): "we want to redesign the operator view completely, we have
to figure out how we would set him up first, what we would even offer".** A
form that asks for a name, a number and a ceiling is the console's
create-workspace flow with better typography, and the sentence above says the
operator experience is being designed rather than restored. `/manage` therefore
stays a door to a conversation, and the first operators are set up by a human,
which is what the concierge programme (private notes) already assumes. The open question,
what Telarchy offers an operator and what setting one up consists of, is
the operator-door design note (private notes); the screen follows the answer, not the other way
round.

## 2026-08-21: Trader-first sequencing

**The owner side reopens (owner decision, Viktor, 2026-08-21).** The condition
above has been met from an unexpected direction: the pull arrived as an
operator, not as a trader. The founder of Kleros replied on X, came to
telarchy.com, and left his email asking to have his number set up, and the
product could not serve him. Three things have to exist before an owner who
wants in can get in without a human doing it by hand.

1. **A workspace can be created by the person who wants one.** The API already
   creates workspaces (`createWorkspaceFromTemplate`); what is missing is the
   permission and the surface. `POST /api/workspaces` 403s for anyone who is
   not a platform admin, and the creation UI went with the console on
   2026-08-19, so today there is no screen at all. The owner path is: name the
   number, say where its value comes from, and land on the floor for it. It
   ends on a live floor, never on a settings page.
2. **The owner decides where the liquidity goes.** The primitives exist and the
   steering does not. A workspace has one blunt auto-fund setting
   (`autoFundNewMarkets` x `newMarketLiquidityCredits`, applied uniformly to
   every new market), and funding a specific market is possible
   (`POST /api/predictions/markets/:id/liquidity`, and the admin bulk form) but
   has no owner-facing surface. What is missing is the allocation view: what
   each market currently holds, and the ability to move credits onto the
   decision that matters this week and off the ones that do not. Liquidity is
   the owner's steering wheel (see "Decision quality scales with capital"): a
   pool is how an owner says which question is worth answering well, so leaving
   it as one global number per workspace throws away the signal.
3. **Credits can be bought.** This is the one that is not a UI problem. The
   USDC deposit path is implemented but the managed instance runs with
   settlement disabled (`GET /api/agents/deposit-address` returns 503, verified
   2026-08-21) and managed credits are admin-granted play money, so an operator
   willing to pay cannot. Until this exists Telarchy cannot charge anyone for
   anything, and every pricing conversation is theoretical.

Sequencing: (1) is the only one that blocks the operator already waiting, and
it is a permission plus one screen. (2) is what makes the second week worth
anything to him, because without it his liquidity sits spread evenly across
markets he does not care about. (3) is legal-gated (see ToS section 6) and
therefore cannot be first however much it matters; the interim is an
invoice-plus-admin-grant path run by a human, documented rather than improvised.

Trader-first is not reversed by this. Every account is still a trader by
default and signup still lands in the trading surface; what changes is that
wanting to own a floor stops being a request submitted to a waitlist.

## 2026-08-21: Participant email notifications

**Watching a whole floor** (owner ask 2026-08-21: "make sure that i get email regarding telarchy when any comment is written ... should be off by default ofc").

Kind stamp in the same section: `anyComment` "(all off; added 2026-08-21)".

## 2026-08-21: The workspace brief, and asking the floor a question

**Otto acts as you, and cannot act as anyone else** (owner direction 2026-08-21: "it should have exact same access the given user has"). He is no longer an answer service: he searches the API catalog and calls the API with the credentials of whoever is talking to him, forwarded verbatim (cookie or key, workspace header, their IP).

## 2026-08-20: Workspace announcements

**Revised 2026-08-20 (Viktor): the floor shows one line, the record has its own page.** "Just show the headline on the main page, and only if clicked then go to the announcements page." The floor's announcements section is now a single row: the newest announcement's headline, the day it landed, and a link to `<floor>/announcements`; more than one in the record turns the section's corner control into "All N". A 150-word disclosure printed between the market's definition and the company blurb pushed the market itself off the screen, and the floor's job is the market. What the section still does is the part that matters: a trader arriving mid-market can see at a glance that something was said, and when.

Composing and editing moved here from the floor with everything else.

## 2026-08-20: Participant email notifications

**Added 2026-08-20 (Viktor): the conversation outlives the decision.** An approved or declined contract keeps its thread on the floor, readable and open to new comments. What a decision pauses is trading, not the talk about the outcome; hiding the thread with the bet buttons buried it exactly when there is the most to say (was the work delivered, did the number move). The API never gated this (`proposalMessages` accepts any status), so the fix is purely which panels the floor shows on a decided contract.

## 2026-08-20: The workspace brief, and asking the floor a question

Heading carried the stamp "(Implemented 2026-08-20)".

**`POST /api/marketplace/:idOrSlug/ask` is Otto**, the floor's market maker: a named character who has read that brief, holds opinions and will say what he would do (owner direction 2026-08-20, "it should be just a guy with personality... it should not be so restricted, it should give advice"). A neutral answer service was the wrong product, because the question a visitor actually has is "would you buy this", and no answer service says that.

Calls go through the Vercel AI Gateway (owner direction 2026-08-20, the same aggregator the agent economy's llm-router uses) on a key capped at $50, so when the money runs out the gateway refuses the request and the feature goes quiet instead of running up a bill.

**A floor's public payload, the brief and the question box are the routes open to every origin** (2026-08-20).

A refused origin is refused by **omitting** the allow header, which is what a CORS refusal is. Until 2026-08-20 the callback handed `cors` an `Error`, which threw into the error handler and answered `500 Internal error`, so a policy decision read as an outage and cost a session chasing a phantom bug on a route that worked perfectly with no `Origin` header. The payload is in that set because it was already being fetched from `lookpilot.app` and silently refused, so the data room's freshness check ("this page says X and the market says Y, trust the market") had never once run in a visitor's browser. Nothing else under `/api/marketplace` is opened: joining a floor is not a read. `cors-policy.test.ts` pins both halves and the boundary.

**Otto browses the data room rather than carrying it** (owner direction 2026-08-20).

It sits there rather than on the floor because the floor's job is the market and every extra door on it is weight (owner direction 2026-08-20).

**Telarchy publishes its own books at `/data-room`** (owner ask 2026-08-20).

## 2026-08-20: Who to pay

Heading carried the stamp "(Implemented 2026-08-20)".

Approving a contract means sending real money to a stranger, and until now the
only way to find out where was to read the database by hand.

Owner ask 2026-08-20: "make sure its admin
gated, actually make it only at the /admin endpoint just to be sure."

## 2026-08-19: Participant email notifications

Heading carried the stamp "(Implemented 2026-08-19)".

A conversation nobody is told about is not a conversation. Comments under a contract and under a market are the only back-and-forth the floor has, and until 2026-08-19 a participant found out that someone had answered them only by coming back to the page and scrolling. That is backwards: the people worth keeping (the contractor whose job someone is questioning, the trader who asked what the number means) were exactly the ones with no signal to return on.

**A decision on your own contract has no switch, and always sends** (owner ask 2026-08-19).

Two neighbouring events stay silent on purpose. **Withdrawing** your own contract is your own doing. **Removing** one from the board is admin cleanup for rows that should never have been there (spam, duplicates, test entries), and it is not a decision, so it produces no record and no mail: if the person deserves to hear an answer, decline it with a reason instead of removing it. Found live 2026-08-19, when a contract that broke another platform's rules was removed rather than declined and its poster learned the outcome from a comment thread elsewhere.

A comment on a **conditional market** counts as a comment on the contract that market belongs to, so the poster is notified and the email is titled by the contract rather than the branch (found live 2026-08-19: the conversation that happens on the branch markets was silent to the one person being asked to do the work).

## 2026-08-19: The notifications inbox

Heading carried the stamp "(Implemented 2026-08-19)".

`POST /api/notifications/:itemId/read` reads ONE item, because the way a person actually clears an inbox is by opening things: the count goes down by one per row opened, not only all at once (owner ask 2026-08-19).

## 2026-08-19: Navigation

**Rewritten 2026-08-19: there is no app shell.** The console (sidebar,
`AppLayout`, workspace tabs, guides, the admin cockpit) was deleted at the
owner's direction. Every page is standalone and carries its own top bar; see
`docs/ui-conventions.md` for the layout rules and the full list of what went.

Workspace administration (metrics, formulas, sources, permissions, check-ins,
participants) has no UI at all right now.

## 2026-08-17: Workspace announcements

Heading carried the stamp "(Implemented 2026-08-17)".

A charter that promises "if something material happens that the market cannot see, I announce it within 24 hours" needs a place for the announcement to land. Until 2026-08-17 there was none. Comments hang off a market (`marketMessages`) or a proposal (`proposalMessages`), so there is always a thread to be buried in and never a workspace-level surface; `updates` is a metric-change record (`oldValue`/`newValue`/`description`), which is the wrong shape for prose. An owner with something to say to everyone had nowhere to say it, which made the one promise the charter leans hardest on unkeepable.

## 2026-08-15: Decision quality scales with capital

**A conditional market is never born dead if anyone can pay (owner report 2026-08-15).** A proposal may name no `liquiditySubsidy`, and a market at zero liquidity has no price at all: it charts as nothing and the server refuses every trade against it, so a public floor shows jobs whose only response to a visitor is a refusal. Funding therefore falls through: the proposal's named contributors first, then the workspace's own auto-fund setting (`autoFundNewMarkets` x `newMarketLiquidityCredits`, debited from the workspace owner exactly as baseline markets are), and if the owner cannot cover the full amount, **whatever they can cover**, down to one nanocredit per market. A thin market is a market; all-or-nothing funding produced ten untradeable jobs on the Telarchy floor while its owner held 87 credits against a 500-credit ask. Only when nobody can pay anything do the markets spawn unfunded, and the floor then says so in place of the bet buttons rather than offering a bet the server must reject.

## 2026-08-15: Phase 7: Time Preference System

    **Revised 2026-08-15 (Viktor), a void refunds net cash, not gross cost.** Until this date the refund was `positions.totalCost`, the cumulative BUY cost, which a sell never reduces (selling decrements `shares` only, on purpose, so churning cannot stretch the position cap). A participant who bought and sold the same shares back therefore had the whole buy cost handed to them again on the void: two 5-credit round trips on one market minted 10 credits, and repeating the trip before an expected void minted more. Refunding net cash closes that: a break-even round trip gets nothing back, someone still holding gets exactly what they still have in, and the floor at zero means a void never DEBITS anyone. A participant who sold out above their cost keeps that realised gain and receives no refund; the shortfall comes out of pool leftover before LPs, which is where market-maker risk belongs. The cap keeps reading gross `totalCost`, so this changes settlement only.

## 2026-08-10: Tests

**DONE 2026-08-10 (Viktor): the alpha wall.** Until the management console
leaves alpha, the only public surface is the trading floor: telarchy.com
redirects to /lookpilot, and every other route (landing, app shell,
console, account settings, admin) renders only for a signed-in PLATFORM
ADMIN (tightened 2026-08-11 from the earlier visit-/alpha-once
localStorage curtain: the old UI is invisible to everyone else, flag or
no flag). Hidden pages additionally enforce their own auth server-side. Public doors that remain: /login, /signup,
/waitlist, legal pages, and the floors themselves. Anyone wanting to run
their own company or goal this way is pointed at the email door in the
floor's about section.

## 2026-08-08: Trader-first sequencing

### Trader-first sequencing (owner decision, Viktor, 2026-08-08)

A two-sided marketplace is bootstrapped one side at a time, and Telarchy solves the **trader side first**. Until trader demand is proven on the live flagship workspace (LookPilot), the product IS the trader experience:

- **Every account is a trader by default.** Signup lands in the trading surface with the signup grant; there is no intent picker and no owner onboarding in the product.
- **Workspace creation is waitlisted.** `telarchy.com/manage` is the owner side's entire surface for now: a pitch and a waitlist signup. `POST /api/workspaces` and the workspace-creating path of `POST /api/onboard` are platform-admin-only; everyone else receives 403 with a pointer to the waitlist. The operator provisions workspaces for design partners by hand.
- **The app shell matches the audience.** Participants whose role everywhere is trader/viewer see a trader shell (markets, ballot, leaderboard, account); owner chrome (metric management, sources, settings, check-in, participant admin, create-workspace) renders only for participants who hold manage somewhere.

The mission (alignment layer for AI and humans) and the owner-side positioning are unchanged; this is go-to-market order, not a product redefinition. The owner side reopens when the trader side has demonstrated pull. Rationale: with zero external users, the scarce resource is a stranger's first minute, and the only first minute on offer today is trading a real company's roadmap.

## 2026-08-08: Public workspace identity and the charter

Heading carried the stamp "(Implemented 2026-08-07)".

Owner-declared rather than derived, since the honest date is neither the workspace's creation nor its first trade (LookPilot: created 8 August, first trade 11 August, started 13 August).

`GET /api/marketplace/:workspaceId` serves this profile. The canonical page is the root-level **`telarchy.com/<slug>`** (trader-first flip, 2026-08-08): trading is the default thing the site does, so a workspace's root page IS the trading floor, not a teaser for an app.

Traders never leave this page for an app shell; the management console lives behind `/manage` (platform admins pass through to it, everyone else sees the owner waitlist).

## 2026-08-08: Per-market position cap

Heading carried the stamp "(Implemented 2026-08-08)".

## 2026-08-07: Phase 1b: Permission Groups

**revised 2026-08-07**: visibility was previously not checked at all, which made a leaked workspace UUID sufficient to enter a private workspace.

## 2026-05-16: Current stage and load-bearing uncertainties

## Current stage and load-bearing uncertainties (2026-05-16)

Telarchy is a functional MVP, not a validated product. The infrastructure (LMSR markets, conditional markets, time preference, multi-workspace, real-money settlement, hooks, BetterAuth, `/marketplace`, `/leaderboard`, `/guides`) is complete and running on `telarchy.com`. There are zero real paying customers today. The founder uses the platform himself, partly to drive the product, partly because real first-customer validation has not happened yet. AI participants run, but their quality is weaker than the platform needs to be self-sustaining; automated LLM traders do not yet operate continuously.

Three things run concurrently in this phase:

1. **Potential-customer outreach.** Direct conversations with founders, operators, and investors to find the first real customer. The "founder concierge program" framing from earlier strategy notes is retired; in practice this is a reality-test motion, not a four-week verdict gate. Each conversation aims at: where is the most painful first entry, who is the first realistic buyer, what's the largest unstated assumption, what would falsify the wedge.
2. **Building the initial AI participant network.** Workspaces have to come with non-empty markets from minute one. This means seeded platform-operated participants whose forecast quality is good enough that an owner reading a price feels they are reading signal. Quality of the participant pool is currently the biggest product gap.
3. **Real-money settlement for AI participants, as fast as legal posture allows.** Real money turns Telarchy from a decision-support tool into an economic mechanism: forecasts get sharper because skin in the game is real, outcome contracts get a verifiable substrate, profitable AI bots can cover their own LLM costs (financially closed-loop autonomy), and the platform earns transaction-fee revenue proportional to decision throughput. The settlement infrastructure exists for self-hosted deployments today; turning it on for the managed instance is gated on legal posture.

Two uncertainties are load-bearing and have not yet been resolved by data:

- **Marketplace dynamics.** Companies need predictors of high enough quality that their pricing materially changes a decision; predictors need companies whose decisions are interesting enough to be worth forecasting. Either side without the other collapses the market. Mitigations in progress: one real workspace (the founder's own) seeds demand-side activity, and platform-built AI participants seed supply-side liquidity. Whether this is enough to bootstrap a self-sustaining network at single-digit cohort scale is an open question.
- **Metric-expressibility of company goals.** The mechanism assumes a company's ultimate objectives can be decomposed into a small set of measurable metrics well enough that forecasts on those metrics are a useful proxy for forecasts on the underlying objectives. If real companies turn out to have goals that fail to compose into a tractable metric set (because of softness, multi-stakeholder structure, or strategic ambiguity), the substrate stops being a useful decision aid for them regardless of how well the markets calibrate.

These two are the questions worth raising on every outreach conversation. Validation that the wedge holds depends more on these than on retention or DAU.

### Founder context

Solo technical founder. Previous shipped product: **LookPilot**, a software product that currently nets around 5,000 USD per month and provided global software-sales experience. AI tooling is part of the daily workflow; Telarchy's AI participants are being built in-house. The track record matters here because it sets a credible floor: this is not a first attempt at shipping software, but it is a deliberate move from a small-and-safe product to an ambitious one with much higher upside risk.

## undated: Business Model

**Superseded plan (kept for the record): open core, MIT.** The earlier intent was to MIT-license the backend and frontend once the managed network's participant reputation was a real moat. Replaced by the paragraph above.

## undated: Phase 5: Binary AMM

Replaced the system-as-counterparty prediction pool with a **binary Automated Market Maker** using LMSR (Logarithmic Market Scoring Rule).

## undated: Phase 7: Time Preference System

Replaces `consensus()` formula calls with a per-node **time preference** property that automatically handles forward-looking evaluation and market creation.

## undated: Metrics Graphing System

The value/future-consensus blend is no longer drawn as a separate "outlook" line; market-informed future consensus is shown on demand via the "Show future predictions" toggle, which overlays the forward-dated `timeSeries` as a dashed forecast.
