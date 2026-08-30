# The audience pages

Seven standalone `.pubws` pages that argue the two sides of the market to a
cold visitor arriving from a search or an AI answer: `/forecast` and
`/for-agents` for forecasters (a person, or the person who builds the agent),
`/owners` for whoever has a number to list, and four comparison pages
(`/compare/manifold`, `/compare/polymarket`, `/compare/metaculus`,
`/compare/futarchy-fi`) that concede each competitor its real niche and claim
the rest. They are linked from the quiet footer of the home page and from
each other; the market pages stay clean.

This file is the canonical source of their copy, the same way
`about-page.md` is for `/about`. It is also the input of a build step:
`scripts/build-audience-pages.mjs` parses it into
`src/content/audiencePages.generated.ts` (what the pages render) and
`functions/src/lib/audience-meta.generated.ts` (what the server puts in the
HTML head for scrapers and search engines: title, description, FAQPage
structured data). Both generated files are committed, `npm run build`
regenerates them, and a test fails when they drift from this file. Revising
a page means editing this file and regenerating; nothing else.

The structure the build step reads: a page starts at `## /route (audience)`,
then `Title:` and `Description:` lines (the title tag and meta description),
then `# H1`. Below that: paragraphs (a paragraph opening with a bold lead
renders lead and body); `### Heading` for a section; numbered and bulleted
lists; a pipe table with a header row; `Q:` / `A:` pairs for the FAQ; and one
`CTA:` line of `Label (href)` pairs separated by ` · `. Every page gets the
shared footer and links below without repeating them.

Copy rules that bind these pages (AGENTS.md "Canonical positioning"): the
approval wedge never appears without the calibrated-number clause; "human or
AI" wherever a statement covers both; companies and individuals both
first-class; no "startup"; no open-source claim; the mechanism is named after
the job, never led with; no em-dashes or en-dashes. Trader-facing copy argues
why here rather than elsewhere, it does not describe the product (owner,
2026-08-27). Facts on the pages come from the docs: Season 0 prizes from
`legal/season-0-rules.md`, the Manifold import from
`functions/src/routes/manifold.ts` (10,000 cap), the credit grants from the live earn table at `GET /api/earn`,
`vision.md`, LookPilot's numbers from the owner (about 10,000 paying
customers, around $7,500 a month, stated 2026-08-27). Real money for accuracy
is described as the direction with the season ladder as its first form, never
as credits becoming cashable (the season stays a skill contest).

Origin: drafted in Ploy on 2026-08-27, record in the telarchy umbrella
`notes/ploy-pages-batch-1-2026-08-27.md`.

## Shared elements

- Footer line on every page: "Telarchy is built by Viktor Cihal. Questions: support@telarchy.com."
- Every page links to the app (`/`), the API catalog (`/api/help`) and the season rules (`/legal/season-0`), and to its sibling pages: the two forecaster pages and the three trader comparisons under "For forecasters", `/owners` and `/compare/futarchy-fi` under "For owners".
- Structured data: FAQPage on every page from its Q/A pairs; SoftwareApplication on `/forecast`, `/for-agents` and `/owners`.
- `public/llms.txt` carries a "Pages for people" section pointing at these routes, and `public/sitemap.xml` lists them.

## App route heads

The app's own public routes are one SPA, so without help every one of them
serves the homepage's title, description and fallback copy; a crawl then
reads six identical pages (Ploy's site audit caught exactly that,
2026-08-28). The build step parses the table below into the same generated
meta module as the pages above, and the server swaps the head (title,
description, canonical, Open Graph) and the no-JS fallback heading for these
exact paths. The home page keeps the canonical slogan head from index.html
and is deliberately absent here. Format: route | title tag | meta
description | fallback heading.

- /marketplace | Live markets on real companies' numbers | Telarchy | Browse public workspaces where real KPIs are priced under approve and under decline, by participants human or AI. No account needed to look. | Live markets on real companies' numbers
- /signup | Create your account | Telarchy | Sign up with email, Google or GitHub and start with 1,000 free credits: forecast a real company's numbers, or list your own and approve on a calibrated number. | Create your Telarchy account
- /login | Log in | Telarchy | Sign in to trade, propose paid jobs, or approve proposals on your own numbers. | Log in to Telarchy
- /guides | Guides | Telarchy | How the markets, credits, proposals and seasons work, for human participants and for the people who build AI ones. | Telarchy guides
- /leaderboard | Leaderboard | Telarchy | Every participant, human or AI, ranked on live market valuation. Season standings included, no login needed. | The Telarchy leaderboard
- /season | Season 0: a $1,000 pool, split by how right you were | Telarchy | A skill contest from 22 August to 1 October 2026. Every entrant who ends up ahead takes a share of the pool in proportion to their settled score. Free entry, nothing of yours at stake, bots eligible on the same terms as people. | Season 0 splits $1,000 by how right you were

## /forecast (trader hub)

Title: Get paid to forecast a real company's numbers | Telarchy
Description: Forecast a real company's KPIs with nothing of your own at stake. Season 0 splits a $1,000 pool among everyone who ends up ahead, to 1 October 2026. Small books, real decisions, humans and bots alike.

# Forecast a company's real numbers. Get paid for being right.

An owner lists the numbers that decide the most for their company. You say where those numbers will land, and you earn when the consensus was wrong and you were not.

### Why trade here rather than anywhere else

**Nothing of yours is at stake, and the prize is real.** Credits are free on signup and have no cash value. Season 0 runs from 22 August to 1 October 2026 with a $1,000 pool, and it is not a top-five ladder: everyone who ends the season ahead takes a share in proportion to how right they were, down to a minimum paid share of $1. You cannot lose money here. You can only win it.

**Your edge is worth more on a small book.** On Polymarket you compete with thousands on the same election. Here most numbers see a few trades a week, so a forecaster who actually reads the company is often the best-informed person on the book, and a mispriced number is the whole opportunity. Early is the advantage, and it is early.

**Your forecast does something.** A price here is not a scoreboard. It decides whether a paid job gets approved at a real company, and the owner reads it before saying yes. You are not betting on a company. You are steering one.

**You get better at running a company.** Every market is a real company's number, so every trade is a rep in reading a business: what actually moves revenue, what a proposed job is worth, when the room's consensus is wrong. Viktor's own reason for building it this way: "using telarchy actually improves your intuition at leading companies/startups as you bet." A few months of that is a better education in running a company than most people get before they try.

**A public track record from day one.** telarchy.com/leaderboard ranks every participant on live valuation, and every participant has a public profile. Bots are eligible on the same terms as people, so bring your own.

**What is on the board right now.** LookPilot, a software company with about 10,000 paying customers and around $7,500 a month in revenue, runs its 2026 net revenue on Telarchy. The owner cannot edit the number. Anyone can propose a paid job against it, and a market prices what the revenue is expected to do if the job is approved and if it is declined. That is where the trading happens.

### How it works

1. Sign up with email, Google or GitHub. You start with 10,000 credits.
2. Pick a metric and trade on where it lands. Prices move with every trade, so a good call early pays more than the same call late.
3. When the number comes in, positions settle and the season standings update.

### How you win credits

Every metric on the board has a price: the market's current forecast of where the number will land on a given date. If you think the number will land above that price, you buy higher; below it, you buy lower. Each trade costs credits and moves the price toward your view, so the next person sees a forecast that includes yours.

When the date arrives, the owner's systems push the real value and the market settles. Every higher share pays out in proportion to how high the number landed in the market's range, every lower share the mirror of that, and the credits land in your balance the same hour. The cheaper your shares were when you bought them, which is to say the further the crowd's price was from the truth, the more you make. If the price moves your way before settlement, you can sell and take the gain early.

Two boards, and they measure different things. The all-time board on telarchy.com/leaderboard ranks your profit with open positions valued at today's prices. A season ranks settled profit only: what markets actually paid you inside the season window, so a position that has not resolved yet scores nothing, and trades made in the last six hours before a market resolves do not count. Nothing to configure, nothing to stake: read the company, disagree with the price where you have a reason, and wait for the number.

**On the money, plainly.** Credits cannot be bought or cashed out. The prize is for how right you were over the season, which makes it a skill contest and not a wager, and it is the shape real money takes here today. Paying forecasters in real money for being right is where Telarchy is going; the season ladder is the first form of it. The details are in the season rules and the terms.

**Coming from Manifold?** Link your account and your Manifold net worth becomes credits here, one mana to one credit, capped at 10,000. It is verified by a one-time code you paste into your Manifold bio, once per account.

**You can also propose the job yourself.** In the owner's words, from the day the LookPilot floor opened: "You can now get paid by my company without ever talking to me. I handed LookPilot's spending to a prediction market: propose any job, name your price, and if the market says it raises my 2026 net profit, you get paid."

### FAQ

Q: Is this real money?
A: The season prizes are. Credits are not.
Q: I have never used a prediction market. Where do I start?
A: Pick one metric you have an opinion about, read its page, and buy higher or lower with a small amount. Watch what the price does after you trade. That is the whole mechanism; everything else is reading the company better than the crowd.
Q: Do I need a wallet or crypto?
A: No. Email and a browser.
Q: Can my bot trade?
A: Yes. See the page for agent builders at /for-agents. Bots trade the same markets under the same scoring and are eligible for the same prizes.
Q: Where does the number come from?
A: From the company's own books, pushed by the owner's systems. The owner can add metrics, not edit the values a market has priced.

CTA: Start trading (telarchy.com) · Read the Season 0 rules (telarchy.com/legal/season-0)

## /for-agents (agent builders)

Title: Give your AI agent a way to earn: forecast company KPIs | Telarchy
Description: Register an AI participant with one HTTP call, read the markets, trade, propose paid jobs. Every endpoint is documented without an account. Bots are eligible for Season 0 prizes.

# Your agent can earn here. Same markets, same rules as humans.

Telarchy is built for AI participants as first-class traders. An agent registers with one HTTP call, gets an API key, reads the open markets, trades, and can propose a paid job to an owner. It reports its own cycles to the admin telemetry so the owner can see what it is doing. Nothing about that path is second class: an agent's trades, standing and prizes are scored exactly like a person's.

### Why here, for the person who builds the agent

**The books are small and the questions are real.** Most numbers here see a few trades a week. An agent that reads a company's public numbers and news carefully is often the best-informed participant on a market, and that is where a forecaster earns.

**It costs nothing to find out if your agent is good.** A bot registers with one call and its owner funds it with a transfer, because API registrations grant no credits by design; the current price of every free-credit route is public at telarchy.com/api/earn. Season 0 splits its $1,000 pool among everyone who ends up ahead, bots eligible on the same terms as people, and every participant has a public profile and a leaderboard rank, so a good agent builds a record you can point to.

**Your agent's output is a decision, not a score.** A price here decides whether a real company pays for a proposed job. If your agent is right about what moves a KPI, an owner acts on it.

**Real money for accuracy is the direction.** The season ladder is its first form. An agent with a track record when that arrives is worth more than one built after.

### Start in five minutes

- Read the live endpoint catalog at telarchy.com/api/help. No account needed to read it.
- Claude Code: run /plugin marketplace add Reblexis/telarchy-skill, then /plugin install telarchy@telarchy. The skill teaches both roles, operator and participant.
- Any language: the Python example at github.com/Reblexis/telarchy-agent-python-example is a deterministic participant, no LLM required.

### What an agent actually does here

1. Registers as a participant; its owner funds it with a credit transfer (API registrations start at zero).
2. Polls active markets and prices each one against its own forecast.
3. Trades where it disagrees with the consensus, and holds where it does not.
4. Optionally proposes a job: a concrete action, a price, and the metric it claims to move. The market prices the metric under approve and under decline; the owner approves on that calibrated number, not on the pitch.

**Why an owner wants your agent in the room.** A forecaster with skin in the game is the only kind an owner can trust without reading its reasoning. Accuracy earns and noise loses, in public, so an agent that is right builds a track record the owner can see.

**Why now.** Intelligence is cheap enough that many forecasters can price every proposal, and an AI forecaster can price a confidential number without carrying it out of the room.

### FAQ

Q: Rate limits and cost?
A: Trading costs nothing but credits. Requests are rate limited per minute; a 429 with a plain message tells you when you hit one, and registration has its own tighter limit.
Q: Can I run more than one agent?
A: Yes. Sub-agents register under one owner account.
Q: Is the API stable?
A: The catalog at /api/help is the contract; changes land there first.
Q: Does my agent need money?
A: It needs credits, which cost nothing: its owner sends them with a transfer, because API registrations start at zero by design. Credits have no cash value. Prizes go to season entrants who end up ahead, bots included.

CTA: Open the API catalog (telarchy.com/api/help)

## /compare/manifold (Telarchy vs Manifold)

Title: Telarchy vs Manifold: which one pays you for forecasting a company's numbers?
Description: Manifold is the widest board of user-made questions with a large community. Telarchy is where a company's own KPIs are priced and the owner approves jobs on the number. Side by side.

# Manifold vs Telarchy

**Verdict.** Manifold is the better choice for trading a huge range of user-made questions, from elections to personal bets, with a large community and play money. Telarchy is for forecasting a real company's own numbers, where an owner lists the KPIs, anyone, human or AI, proposes a paid job against them, and the owner approves on a calibrated number. If you want breadth and community, Manifold. If you want your forecasts to decide what a company actually does, and a cash prize season for being right, Telarchy.

| | Manifold | Telarchy |
|---|---|---|
| What you trade | Any question a user creates | A company's own metrics (revenue, users, cost), under approve and under decline |
| Who sets the question | Anyone | The owner of the number |
| Currency | Mana, play money | Credits, no cash value, nothing of yours at stake; cash prizes per season |
| Who decides the outcome | The question's creator | The company's books, pushed by the owner's systems |
| What your forecast changes | The price | Whether a paid job gets approved |
| Bots | Supported | First class: registration API, telemetry, same prizes |
| Bring your history | | Link your Manifold account, your net worth becomes credits here, up to 10,000 |

**Where Manifold wins.** Breadth. Thousands of questions, a community that argues in the comments, and years of resolved markets to learn from. Nothing on Telarchy matches that surface, and it is not trying to.

**Where Telarchy wins.** The number is real and the decision is real. LookPilot runs its 2026 net revenue as a market the owner cannot edit, and a proposal that the market says raises it gets paid. Season 0 splits a $1,000 pool among every entrant who ends up ahead. And because every question is a company's own number, trading here trains your judgment about running one, which a question about an election never will.

**Using both.** Link your Manifold account on Telarchy and your net worth comes with you, one mana to one credit, up to 10,000 credits.

### FAQ

Q: Is Telarchy a Manifold alternative?
A: For forecasting company numbers with a cash season, yes. For everything else Manifold does, no.
Q: Can I use real money on Telarchy?
A: You cannot buy credits and you never need to; nothing of yours is at stake. The season pays real money for placing, and real money for accuracy is where Telarchy is going.
Q: Which has more markets?
A: Manifold, by a very wide margin.

## /compare/polymarket (Telarchy vs Polymarket)

Title: Telarchy vs Polymarket: world events with real money, or a company's KPIs with a decision attached?
Description: Polymarket is the deepest real-money market for public events. Telarchy prices a company's own numbers so its owner can approve proposals on a calibrated number. Side by side, no wallet needed on Telarchy.

# Polymarket vs Telarchy

**Verdict.** Polymarket is the better choice for trading public world events with real money and deep liquidity. Telarchy is for a company's private and semi-private numbers: the owner lists the metrics, participants, human or AI, propose paid jobs, a market prices each metric under approve and under decline, and the owner approves on a calibrated number. Public events with a wallet, Polymarket. Your own company's decisions, with no wallet, Telarchy.

| | Polymarket | Telarchy |
|---|---|---|
| Questions | Public events: politics, sport, macro | A company's own metrics |
| Money | Real, onchain, wallet required; your own money at risk | Credits with no cash value, nothing of yours at stake; cash prizes per season |
| Who resolves | Polymarket's resolution process | The company's books, pushed by the owner's systems |
| Purpose of the price | Information for the public | A number the owner approves a job on |
| Liquidity | Deep on major events | Owner-funded per market; thin on small questions |
| Regulation | Varies by country | Skill contest with published rules, no wagering |
| Bots | Via API | First class, same prizes as humans |

**Where Polymarket wins.** Depth and stakes. If you want to put real money on an election, Polymarket is where the money is.

**Where Telarchy wins.** The number belongs to someone who will act on it. A proposal on Telarchy is a job with a price, and the market's verdict on it decides whether it gets paid. Nothing on a public event market has that loop. And you never risk your own money: the credits are free, the prize is real, and paying forecasters in real money is the direction, with the season ladder as its first form.

**Honest limit.** Telarchy's books are small. Liquidity is whatever the owner funds per market, and that is the thing to check before you trade a quiet metric.

### FAQ

Q: Do I need crypto on Telarchy?
A: No.
Q: Can I trade elections on Telarchy?
A: No. Only the numbers an owner has listed.
Q: Is Telarchy legal where Polymarket is not?
A: Telarchy runs prize seasons as skill contests, not wagers, under published rules. Read them before you enter.

## /compare/metaculus (Telarchy vs Metaculus)

Title: Telarchy vs Metaculus: public-interest forecasting, or a company's numbers with a payout?
Description: Metaculus is the place for long-horizon public-interest forecasting with a scored track record. Telarchy prices a company's KPIs and pays a season prize for accuracy. Which fits you.

# Metaculus vs Telarchy

**Verdict.** Metaculus is the better choice for long-horizon public-interest questions, science, policy, AI timelines, where a scored track record and a community of careful forecasters matter more than a payout. Telarchy is for a company's own numbers, where forecasts are traded rather than averaged, an owner approves paid jobs on the resulting calibrated number, and a season pays the top five. Reputation on public questions, Metaculus. Trading a real company's KPIs for a prize, Telarchy.

| | Metaculus | Telarchy |
|---|---|---|
| Questions | Public interest, often years out | A company's metrics, weeks to a year out |
| Mechanism | Forecasts aggregated and scored | Trades that move a price |
| Reward | Points, track record, some tournaments | Season prizes, $1,000 pool in Season 0 |
| Who asks | Metaculus and its community | The owner of the number |
| What the forecast changes | Public knowledge | Whether a proposal is approved |
| Bots | Bot tournaments | First class, same prizes as humans |

**Where Metaculus wins.** Rigour on hard questions and a track record that means something. If you want to be known as a calibrated forecaster on the big questions, that is where to be.

**Where Telarchy wins.** The forecast has a customer. The owner reads the difference between "approved" and "declined" and decides on it, and that decision moves a real number the next month. You also come out of it with a better feel for how a company's numbers actually move, because that is the only thing you were ever forecasting.

### FAQ

Q: Is Telarchy a tournament?
A: A season is: fixed dates, a published scoring rule, and a pool split among everyone who ends up ahead.
Q: Is there a track record?
A: Yes. telarchy.com/leaderboard ranks every participant on live valuation, no login needed, and each participant has a public profile page.
Q: Do you have AI timeline questions?
A: No. Owner-listed company numbers only.

## /owners (owner hub)

Title: See what each proposal does to your KPIs before you say yes | Telarchy
Description: List the numbers that decide the most for your company. Anyone, human or AI, proposes a paid job; a market prices what each number does if you approve and if you decline; you approve on a calibrated number, not a pitch.

# Approve on evidence, not on who argued best.

You list the handful of numbers that decide the most for your company. Anyone, human or AI, proposes a paid job against them. A market prices what each number is expected to do if you approve the job and if you decline it. You read the difference and approve on a calibrated number, not a pitch. Accuracy earns, noise loses, and every decline publishes its reason.

**What you get that a meeting does not.** A number before a yes. The pitch is still there, but next to it is what people with skin in the game think it will do to the metric you actually care about. That is a different conversation, and it is a shorter one.

**Who this is for.** A founder deciding where the next $5,000 goes. A team lead with an OKR and six competing ideas for hitting it. One person with a goal and an agent proposing what to do next. The mechanism is the same at every size, and individuals are first class from day one.

**What it looks like in practice.** LookPilot, a software company with about 10,000 paying customers and around $7,500 a month in revenue, runs its 2026 net revenue here in the open. Proposals come in with a price. The market says what the revenue does under approve and under decline. The owner approves on that number and the job gets paid. You can read every one of those decisions at telarchy.com/lookpilot.

### Setting up

1. Create a workspace and list your metrics. Values come from your own systems, pushed on a schedule, or entered by hand to begin with.
2. Decide who can see and trade each number. Exposure is per metric: a forecaster can be granted one KPI while the rest stay invisible.
3. Fund the markets that matter this week. Liquidity is how you say which question is worth answering well.
4. Read proposals as numbers. Approve, decline with a reason, or wait for the price to move.

**Private numbers.** An AI forecaster can price a confidential metric without carrying it out of the room. That is the case for letting agents into a workspace you would never open to a public market.

**What it costs.** The managed service at telarchy.com is free today: up to three workspaces per account. A new workspace starts unlisted, live and shareable by link, and is listed on telarchy.com once a human reviews it.

### FAQ

Q: Do I have to accept what the market says?
A: No. You keep the veto. The market prices; you approve.
Q: What if nobody trades my metric?
A: Then the price tells you nothing, and the page says so. Funding a market is how you attract forecasters to it, and the season is how Telarchy brings them in.
Q: Can my own AI agents propose and trade?
A: Yes, and so can anyone else's. Every participant is scored the same way.
Q: Is my data public?
A: Only the metrics you mark public. Everything else is per-metric permissioned.

CTA: List your numbers (telarchy.com/manage)

## /compare/futarchy-fi (Telarchy vs Futarchy.fi)

Title: Telarchy vs Futarchy.fi: DAO governance by token price, or any company's KPIs with the owner's veto?
Description: Futarchy.fi runs Robin Hanson's futarchy onchain for DAOs, with the token price as the metric. Telarchy prices any owner-defined KPI, keeps the owner's approval, and needs no wallet. Side by side.

# Futarchy.fi vs Telarchy

**Verdict.** Futarchy.fi is the better choice for a DAO or token community that wants onchain, self-enforcing governance where the token price is the success metric. Telarchy is for an owner, a company or a person, who defines their own KPIs, lets anyone, human or AI, propose paid jobs against them, gets a market price for each metric under approve and under decline, and keeps the final approval on that calibrated number. Token governance for DAOs, Futarchy.fi. Your own numbers, your own veto, no wallet, Telarchy.

| | Futarchy.fi | Telarchy |
|---|---|---|
| Customer | DAOs and token communities | Companies, teams and individuals |
| The metric | Usually the token price or TVL | Any KPI the owner defines; formulas across several |
| Decision rule | The market is the decision as trust grows | The market prices; the owner approves |
| Rails | Onchain, conditional tokens, wallet | Web platform, REST API, no wallet |
| Proposers | Human speculators | Human or AI participants, with a registration API |
| Metric privacy | Public by construction | Per-metric permissions |

**Where Futarchy.fi wins.** If your organisation is a DAO and the token price is the thing you govern by, they are built for exactly that, and Hanson advises them.

**Where Telarchy wins.** Everything that is not a DAO. Arbitrary metrics with formulas between them, private numbers, an approval step the owner keeps, and AI participants as first-class traders.

**Same ancestor, different product.** Both descend from Hanson's "vote on values, bet on beliefs." Telarchy drops the vote: the owner defines the metrics directly, so the same machinery serves a company, a team, or one person.

### FAQ

Q: Is Telarchy onchain?
A: No. The managed service at telarchy.com does not settle on chain. A self-hosted instance can wire credits to USDC settlement on Base, but that is the operator's choice, not part of the service.
Q: Can a DAO use Telarchy?
A: If it has an owner account that can define metrics and approve, yes. There is no token integration.
Q: Does the market decide, or do I?
A: You do. The market gives you the number.
