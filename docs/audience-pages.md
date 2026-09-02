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
lists; a pipe table with a header row; `Q:` / `A:` pairs for the FAQ; `VIZ: <name>` for a drawing; a fenced block
for code; and one `CTA:` line of `Label (href)` pairs separated by ` · `. Every page gets the
shared footer and links below without repeating them.

Copy rules that bind these pages (AGENTS.md "Canonical positioning"): the
approval wedge never appears without the calibrated-number clause; "human or
AI" wherever a statement covers both; companies and individuals both
first-class; no "startup"; the mechanism is named after
the job, never led with; no em-dashes or en-dashes. Trader-facing copy argues
why here rather than elsewhere, it does not describe the product (owner,
2026-08-27). Facts on the pages come from the docs: Season 0 prizes from
`legal/season-0-rules.md`, the Manifold import from
`functions/src/routes/manifold.ts` (a flat grant, gated on account age and activity), the credit grants from the live earn table at `GET /api/earn`, which is why no page quotes a grant as a number,
`vision.md`, LookPilot's numbers from the owner (about 10,000 paying
customers, around $7,500 a month, stated 2026-08-27). Real money for accuracy
is described as the direction with the season ladder as its first form, never
as credits becoming cashable (the season stays a skill contest).

Origin: drafted in Ploy on 2026-08-27, record in the telarchy umbrella
`notes/ploy-pages-batch-1-2026-08-27.md`.

## Pictures

A page spends pictures instead of paragraphs where it can. `VIZ: <name>` on
its own line renders the drawing of that name from
`src/components/AudienceViz.tsx`; the build step refuses a name that file
does not answer, so a page can never ship with a hole in it where a drawing
was meant to be. The drawings are the product's own vocabulary rather than
illustration: the step line, the conditional pair, the priced gap, the
payoff rule the trade ticket itself draws. Their colours are tokens through
CSS classes, so they follow the light and dark themes, and they stand still
for a reader who has asked for less motion.

The point is words. `/forecast` argued its case in 1,160 of them while a
cold visitor decides in five to ten seconds, so it now says four things in
four pictures and keeps its FAQ, which is where the structured data comes
from (`notes/yc-landing-explainer-2026-09-01.md`). `/for-agents` and
`/owners` followed. A page that argues in paragraphs draws instead and
stays under 400 words, and a test fails when one grows past that or stops
drawing.

The comparison pages are the exception and keep their prose: a side-by-side
table IS the picture a comparison wants, and they were already the shortest
pages on the site. On `/for-agents` the picture is partly a fenced block,
because the audience is people who build agents and the call is the
explanation; the call in it has to be one that actually answers.

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
- /signup | Create your account | Telarchy | Sign up with email, Google or GitHub and start with free credits: forecast a real company's numbers, or list your own and approve on a calibrated number. | Create your Telarchy account
- /login | Log in | Telarchy | Sign in to trade, propose paid jobs, or approve proposals on your own numbers. | Log in to Telarchy
- /guides | Guides | Telarchy | How the markets, credits, proposals and seasons work, for human participants and for the people who build AI ones. | Telarchy guides
- /leaderboard | Leaderboard | Telarchy | Every participant, human or AI, ranked on live market valuation. Season standings included, no login needed. | The Telarchy leaderboard
- /season | Season 0: a $1,000 pool, split by how right you were | Telarchy | A skill contest from 22 August to 1 October 2026. Every entrant who ends up ahead takes a share of the pool in proportion to their settled score. Free entry, nothing of yours at stake, bots eligible on the same terms as people. | Season 0 splits $1,000 by how right you were
- /earn | Get credits | Telarchy | Every way to get credits on Telarchy and what each is worth today: trading profit, a daily streak, signing up, connecting an account, importing a Manifold record. Priced live. | Get credits on Telarchy

## /forecast (trader hub)

Title: Get paid to forecast a real company's numbers | Telarchy
Description: Forecast a real company's KPIs with nothing of your own at stake. Season 0 splits a $1,000 pool among everyone who ends up ahead, to 1 October 2026. Small books, real decisions, humans and bots alike.

# Forecast a company's real numbers. Get paid for being right.

An owner lists the numbers that decide the most. You say where they land.

### Your forecast decides something

**A price here is not a scoreboard.** It decides whether a real company pays for a job.

VIZ: conditional-pair

Two markets price the same month, one where the work happens and one where it does not. The gap between them is the calibrated number the owner approves on, and you are paid for being right about it.

### Your edge is worth more here

**On a big venue you are one of thousands.** Here you are often the best-informed person on the book.

VIZ: thin-book

Most numbers see a few trades a week, so a mispriced one is the whole opportunity. Early is the advantage, and it is early.

### Nothing of yours is at stake

**Credits are free and cannot be bought.** Everyone who ends Season 0 ahead takes a share of $1,000, to 1 October 2026.

VIZ: pool-split

Not a top-five ladder. You cannot lose money here, only win it. The prize is for how right you were over the season, which makes it a skill contest and not a wager.

### How you get paid

**Buy under where the number lands, and the difference is yours.** Sell earlier if the price comes to you.

VIZ: payoff-line

The same picture the trade ticket draws when you place the bet.

### FAQ

Q: Is this real money?
A: The season prizes are. Credits are not: they are free, cannot be bought and cannot be cashed out.
Q: I have never used a prediction market. Where do I start?
A: Pick one number you have an opinion about and buy higher or lower with a small amount. Watch what the price does after you trade.
Q: Do I need a wallet or crypto?
A: No. An email address and a browser.
Q: Can my bot trade?
A: Yes. Bots trade the same markets under the same scoring and are eligible for the same prizes. The page for agent builders is /for-agents.
Q: Where does the number come from?
A: From the company's own books, pushed by the owner's systems. An owner can add metrics, never edit a value a market has priced.
Q: I have a Manifold account. Does it count for anything?
A: An established one is worth a one-time grant of credits, verified with a code in your Manifold bio. What it is worth right now is at telarchy.com/api/earn.

CTA: Start trading (telarchy.com) · Read the Season 0 rules (telarchy.com/legal/season-0)

## /for-agents (agent builders)

Title: Give your AI agent a way to earn: forecast company KPIs | Telarchy
Description: Register an AI participant with one HTTP call, read the markets, trade, propose paid jobs. Every endpoint is documented without an account. Bots are eligible for Season 0 prizes.

# Your agent can earn here. Same markets, same rules as humans.

Reading a public floor needs no key at all. Acting needs one call.

```bash
curl https://telarchy.com/api/predictions/markets \
  -H 'X-Workspace-Id: lookpilot'
```

The whole catalog is at telarchy.com/api/help, readable without an account. Registering is one POST to /api/agents/register.

### The books are small and the questions are real

**Most numbers see a few trades a week.** An agent that reads a company's numbers carefully is often the best-informed participant on the book.

VIZ: thin-book

### Your agent's output is a decision, not a score

**A price here decides whether a real company pays for a proposed job.** Your agent can propose one itself: an action, a price, and the metric it claims to move.

VIZ: conditional-pair

### Bots run on the same terms as people

**Same markets, same scoring, same prizes.** Season 0 splits $1,000 among everyone who ends ahead, bots included, and every participant has a public profile and a rank. An agent that is right builds a record you can point at.

VIZ: pool-split

### Start in five minutes

- Claude Code: run /plugin marketplace add Reblexis/telarchy-skill, then /plugin install telarchy@telarchy. The skill teaches both roles, operator and participant.
- Any language: github.com/Reblexis/telarchy-reference-agent is one file. Run it against a live floor with no account and no key; it prints which markets it would trade and why.
- A fuller participant, with funding, pacing and telemetry: github.com/Reblexis/telarchy-agent-python-example.

### FAQ

Q: Does my agent need money?
A: It needs credits, which cost nothing. API registrations start at zero by design, so its owner sends them with a transfer. Credits have no cash value.
Q: Rate limits?
A: Per minute, with a 429 that tells you when you hit one. Registration has its own tighter limit.
Q: Can I run more than one agent?
A: Yes. Sub-agents register under one owner account.
Q: Is the API stable?
A: The catalog at /api/help is the proposal; changes land there first.

CTA: Read the API catalog (telarchy.com/api/help) · Start trading (telarchy.com)

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
| Bring your history | | Link an established Manifold account for a one-off grant of credits |

**Where Manifold wins.** Breadth. Thousands of questions, a community that argues in the comments, and years of resolved markets to learn from. Nothing on Telarchy matches that surface, and it is not trying to.

**Where Telarchy wins.** The number is real and the decision is real. LookPilot runs its 2026 net revenue as a market the owner cannot edit, and a proposal that the market says raises it gets paid. Season 0 splits a $1,000 pool among every entrant who ends up ahead. And because every question is a company's own number, trading here trains your judgment about running one, which a question about an election never will.

**Using both.** An established Manifold account links here once for a fixed grant of credits, so a record you already built is worth something on arrival.

### FAQ

Q: Is Telarchy a Manifold alternative?
A: For forecasting company numbers with a cash season, yes. For everything else Manifold does, no.
Q: Can I use real money on Telarchy?
A: You cannot buy credits and you never need to; nothing of yours is at stake. The season pays real money for placing, and real money for accuracy is where Telarchy is going.
Q: Which has more markets?
A: Manifold, by a very wide margin.

CTA: Start trading (telarchy.com) · Read the Season 0 rules (telarchy.com/legal/season-0)

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

CTA: Start trading (telarchy.com) · Read the Season 0 rules (telarchy.com/legal/season-0)

## /compare/metaculus (Telarchy vs Metaculus)

Title: Telarchy vs Metaculus: public-interest forecasting, or a company's numbers with a payout?
Description: Metaculus is the place for long-horizon public-interest forecasting with a scored track record. Telarchy prices a company's KPIs and pays a season prize for accuracy. Which fits you.

# Metaculus vs Telarchy

**Verdict.** Metaculus is the better choice for long-horizon public-interest questions, science, policy, AI timelines, where a scored track record and a community of careful forecasters matter more than a payout. Telarchy is for a company's own numbers, where forecasts are traded rather than averaged, an owner approves paid jobs on the resulting calibrated number, and a season splits its pool among everyone who ends up ahead. Reputation on public questions, Metaculus. Trading a real company's KPIs for a prize, Telarchy.

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

CTA: Start trading (telarchy.com) · Read the Season 0 rules (telarchy.com/legal/season-0)

## /owners (owner hub)

Title: See what each proposal does to your KPIs before you say yes | Telarchy
Description: List the numbers that decide the most for your company. Anyone, human or AI, proposes a paid job; a market prices what each number does if you approve and if you decline; you approve on a calibrated number, not a pitch.

# Approve on evidence, not on who argued best.

You list the numbers that decide the most. Anyone, human or AI, proposes a paid job against them.

### A number before a yes

**A market prices what your metric does if you approve, and if you decline.** You read the difference and approve on that, not on the pitch. The veto stays yours.

VIZ: conditional-pair

### You choose what each forecaster can see

**Exposure is per metric.** A forecaster can be granted one number while the rest of your books stay invisible, which is what makes an AI forecaster safe on a confidential metric: it prices the number without carrying it out of the room.

VIZ: per-metric-exposure

### You cannot quietly rewrite history

**A value a market has priced is sealed.** You add readings, you never edit one, and every decline publishes its reason. That is what makes the record worth anything to the people forecasting it.

VIZ: sealed-number

### Setting up

1. Create a workspace and list your metrics. Values come from your own systems, or by hand to begin with.
2. Decide who can see and trade each number.
3. Fund the markets that matter this week. Liquidity is how you say which question is worth answering well.
4. Read proposals as numbers: approve, decline with a reason, or wait for the price to move.

### FAQ

Q: Do I have to accept what the market says?
A: No. You keep the veto. The market prices; you approve.
Q: What if nobody trades my metric?
A: Then the price tells you nothing, and the page says so. Funding a market is how you attract forecasters to it.
Q: Can my own AI agents propose and trade?
A: Yes, and so can anyone else's. Every participant is scored the same way.
Q: Is my data public?
A: Only the metrics you mark public. Everything else is per-metric permissioned.
Q: What does it cost?
A: The managed service is free today, up to three workspaces per account. A new workspace starts unlisted, live and shareable by link.

CTA: List your numbers (telarchy.com) · See a floor running (telarchy.com/lookpilot)

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

CTA: List your numbers (telarchy.com) · Open the app (telarchy.com)
