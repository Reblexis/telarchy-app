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
approval is a price, said once per page; proposers can be people or bots,
said once per page; companies and individuals both first-class; no
"startup"; the mechanism is named after the job, never led with; no
em-dashes or en-dashes; no sentence that argues for the one before it
(docs/ui-conventions.md, "How much a page says"). Trader-facing copy argues
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

## Agent-builder setup

`/for-agents` introduces agent building, the available strategies and the reference implementation. Its primary action opens `/agents#agent-setup`. It contains no account management or credential controls.

`/agents` is the working page for owned bots and API keys. It is one surface with two sections, Bots and Your API keys, side by side on a wide screen, and no task tabs: a bot is created inside the Bots section and a personal key inside the Keys section, each behind a **New bot** or **New key** action on that section’s heading. `#agent-setup` opens the new-bot form; anonymous visitors see that form with a login link. A compact Agents heading and line icon identify the page, with reference links at the foot; there is no subtitle sentence. Styling follows the floor’s hairline rows, small-caps captions, monochrome palette and mono numeric metadata. An open form stays mounted while cards are used so unfinished work and one-time keys are not discarded.
The new-bot form asks only an optional name and starting credits; it has no identity selector, because personal keys are created in their own section with a permission preset. Creation closes the form and shows the new bot as the first card, with its API key shown once above the card’s actions. Runtime setup belongs with the bot, not the creation form. **Copy setup prompt** is available beside the created connection and in each key’s runtime controls. **Set up manually** sits beside it and opens an inline alternative using the same identity and permission choices. The manual path installs and previews the deterministic reference agent, links back to the visible key step, then explains entering the key in the terminal and running another preview. Trading commands are disclosed only when trading access is selected. Initial commands never trade, regardless of the selected access. macOS/Linux and Windows PowerShell have separate runnable commands; workspace values are shell-quoted. Commands never embed actual credentials. With no chosen workspace, the default public Telarchy workspace is named explicitly. The build guide supplies the AI-assisted alternative. Manual setup and prompt handoff preserve the same unfinished connection state. When a key already exists, manual setup says it is ready and offers to copy that same key after the connection commands, when the terminal asks for it. Public previews remain available through the runtime instructions without creating a key. Trading upgrades and extra funding are secondary disclosures after a key is created.
Copying never creates an identity, mints a key, joins a workspace, or sends
credits. The prompt contains no credential. Public machine-readable setup
instructions remain available through the build guide and `/llms.txt`.

Bots have full access to their own identity, with no permission selector. Personal keys offer Research, Trading, Workspace management, and Full access. Workspace management includes reading, trading and management in workspaces the user can access; Full access additionally includes account settings, balances, keys and creating bots. Access never exceeds the participant's underlying authority. Name is optional and bot starting credits default to 100. The form has no numbered steps, headings or separate panels.

Runtime prompts use the existing connection and never request creation or starting credits again. The newly issued key remains available even if refreshing the connection list fails. Existing keys retain runtime controls after reload, with instructions derived from that key’s permissions. The prompt asks the coding assistant to help choose a strategy
(deterministic, LLM-assisted, or an AI agent using tools), reference code versus
from scratch, and local versus own-server deployment. It suggests the reference
agent and a local dry run when the person has no preference. It uses the public Telarchy workspace, resolved through the API. Initial setup ignores stored workspace preferences and workspace URL parameters. If Telarchy is unavailable, creation stops with a retry action rather than switching to another workspace.

The default is a separate bot with full access to its own identity. Personal keys default to research access. Both choices survive
login and reload. Read-only prompts explicitly prohibit live trading. Trading
prompts permit a trading-capable setup, then require review of the dry run and
budget before starting it. Both explain credential storage, funding through the
existing API, and exact run and stop commands. The assistant configures the runtime for the existing connection.
Keys never enter URLs, prompts, or browser storage. The page never claims
Telarchy hosts or has started the process. Copy errors leave selectable text.

Initial setup uses the public Telarchy workspace automatically, with no workspace picker or URL customization. Bots ask only for an optional name and starting credits, defaulting to 100. Blank names receive a stable generated identifier, retained across recovery retries; display names may contain spaces. The action creates the connection and immediately displays its copyable API key; visiting the page alone never creates a credential. Prompt and manual instructions live on the bot’s card; public preview instructions also remain in the build guide. It uses the
access chosen above: **Research and preview** and **Allow trading**, both limited to the
selected workspace with no administration or wallet-transfer scope. The
summary names whose balance and public results are used. A trading key has no
server-side spending cap; the reference runner's per-cycle limits are not
presented as such a cap. Zero starting credits is valid, but a fresh bot starts with 100 selected. For a new bot, a
nonnegative funding input and the owner's current balance explain the transfer
before **Create bot & get key**. Insufficient funds disable submission
and link to the credit guide without losing the setup.

Creating a bot first joins the owner to the selected public workspace, as
explained beside the action, so an account with no prior memberships can start.
Creation and initial funding use the existing atomic `POST /api/agents` call.
The temporary bootstrap key is read-only. The final key uses full access for bots or the selected account preset, and joins
the public workspace using the bot's own identity, never the owner's identity. Preview requests retain the cookie for the beta gate and routing; an explicit agent key takes precedence over the session for API authentication.
Research and trading account keys remain workspace-locked; management and full-access keys can use every workspace the participant is entitled to access. Temporary setup keys are revoked before showing the final key. The UI checkpoints
completed stages so retrying connection cannot repeat creation or funding.
If creation's response is lost, an ownership-checked lookup can identify the
bot and continue without transferring again; a pre-existing owned name is
rejected before creation. In-flight actions disable duplicate submission and
configuration changes. Changing accounts discards keys and stops subsequent
steps. A partial failure describes what already happened and offers to finish
connection; it never claims rollback or a running deployment.

The finished connection shows the key once, separately from the prompt, and a
plain description of its actual access. A read-only connection can explicitly
enable trading by updating its existing key. New bots offer **Send more credits**
with the transfer shown before submission. A transfer with an uncertain result
must be checked against balances before another transfer, never blindly retried.

### Agent page hierarchy

The page is two columns from 900px, Bots on the left and Your API keys on the right, stacking to one column below that. Each bot is a ticket card on the elevated surface (white, hairline border, 14px radius): the bot mark and its name linking to its participant profile, then three labelled cells in the floor’s small-caps caption style, Credits, Earned and Trades, with mono numbers; a bot that has never traded reads "no trades yet" in the Earned cell rather than a confident zero, and Trades carries the last trade’s date under the count. The card’s actions are one press away: **Copy setup prompt** first and primary (it copies at once and confirms in place; the prompt uses the bot’s full access and the public Telarchy workspace), **Set up manually** beside it, **Send credits** (an inline form on the card naming the source balance), and **Keys**, a button as visible as the others, that opens the bot’s keys inside the card with Edit, Revoke and New key. Nothing on a card is named Set up or Manage and there is no chevron. A bot created in this session appears as the first card with its key shown once above the actions. With no bots, the column is a compact card that says a bot has its own balance and record and offers Create your first bot. The page states that agents run on the user’s computer or server; Telarchy manages access. No status claims that a bot is online: trading history is the available evidence.

The Your API keys column lists personal keys as hairline rows: label, access chip, last used, and Run, Edit and Revoke actions; the chip carries the plain-language meaning as its hover title and no sentence repeats it. Run opens the runtime handoff for that key inline. New key opens an inline form with a label and the permission preset, and the created key is shown once in its row.

## Managing agents and keys

`/agents` is the home for agent and key management. The connections view separates bots with their own balances from account keys that act as the owner. Anonymous visitors see a login link in this view. Signed-in people see their own account and their owned bots,
with balances, trading earnings, and activity. Each bot’s displayed name links to its Telarchy participant profile using its stable, URL-encoded ID. The link retains the current preview base. A bot with no trades says so.
Creation and initial funding use the setup section; this section refreshes after
a connection is created. Account settings contain no agent controls or prompt.

Runtime instructions for a bot live on its card and use the bot’s full access; a bot without keys is offered key creation in the card’s Keys panel. Key permission chips and actions occupy separate layout columns that wrap on narrow screens, never overlap. Bot keys have no per-key runtime action; personal keys do. Existing keys show their label, plain-language permissions and last-used date. Workspace metadata and Technical details are omitted. New keys use Telarchy as their default workspace, without workspace controls; unavailable defaults stop creation. New bot keys use full access without a permission selector. Older restricted bot keys retain an accurate Restricted label and can be replaced with a full-access key; merely viewing or renaming a key never widens it. Creation controls and newly issued secrets appear before the existing key list so they remain reachable with many keys. A list of more than six bots includes a shortcut to personal API keys. Short Edit and Revoke actions retain the key name in their accessible labels. The list updates after changes without a routine refresh button; a failed load offers retry and uncertain creation offers an explicit status check.
The list never contains a raw secret. An owner can rename a key, explicitly
replace its permissions with research-only or read-and-trade, create a new
workspace-locked key, or revoke a key after a confirmation naming it. Saving a
label alone preserves all scopes, including custom permissions. Workspace
metadata on old keys is a default, not evidence that they are locked.

New secrets are shown once with selectable text, Copy key, and Dismiss.
Clipboard failure is visible. Secrets never enter storage, URLs, or prompts.
Signing out or changing accounts removes the prior account's data and secrets;
pending responses cannot populate another account's view. Mutations are
serialized and failures stay visible. An uncertain mint or funding response
must be reconciled by refreshing keys or balances before another attempt.

Funding an owned bot transfers from the owner's balance and refreshes the
list. No control pulls credits back or claims that creating an identity starts
a hosted process. Existing API authorization remains the authority for every
action; the page introduces no separate backend path.

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

`/owners` is laid out as a board rather than a document (owner ask
2026-09-04; redrawn 2026-09-05 from the research in the telarchy umbrella's
`notes/yc-owners-page-2026-09-05.md`: the picture a visitor looks at is
the product, zoomed on one moment, never a shrunken diagram), in the
language of the home page (docs/ui-conventions.md, "The marketplace"):

- The hero: the H1 centred, the lead under it, ONE pill action (the first
  `CTA:` link) with the second link as quiet accent text beside it, and
  the `CATCH:` line under them in the mono caption register (the
  objection answered beside the button: what it costs, what happens next).
- `LIVE: marketplace-stats` is one hairline strip of three live figures
  from `GET /api/marketplace/stats`: open markets (`marketsActive`),
  forecasters, human or AI (`agentsActive`), forecasts this week
  (`tradesThisWeek`), each a mono number with its label in small caps.
  While they load the strip holds ghosts (docs/ui-conventions.md, "While
  a page loads"); if the request fails the strip is not rendered.
- `SHOW: proposals` is the product moment: a two-column row, the section's
  heading, lead and numbered list on the left, and on the right a framed
  panel (`.own-shot`, 1px hairline, 12px radius, the page background)
  rendering the proposals column of Telarchy's own floor LIVE from
  `GET /api/marketplace/telarchy`: the pending proposals sorted as the
  floor sorts them, at most six, each row the title, the impact figure in
  the direction colour, the credits behind it, and the proposer; the
  panel's bottom fades to the page background so it reads as a zoomed
  crop. The panel is `aria-label="Proposals on Telarchy's own floor,
  live"` and links to the floor. Ghosts while loading; nothing rendered
  if the request fails.
- A two-column pipe table with one body row renders as two cells of one
  hairline-ruled row (`.own-pair`), each cell the header as a mono
  small-caps label and the body's bold lead as one sentence in the
  display face over the rest of the cell's text.
- A `###` section carrying a `VIZ:` renders full width: heading as a mono
  small-caps label, the bold lead as the sentence, the drawing at the
  column's full width (never in a cell).
- A `###` section carrying a bulleted list and the FAQ render side by
  side as two hairline lists (`.own-two`): each bullet's bold lead in the
  display face followed by its text; each question in the display face
  beside its answer.
- The `CTA:` line as one closing row on hairlines (`.own-close`), the
  first link a pill, the rest quiet accent links, the `CATCH:` line
  repeated under it.

The copy is the copy below, unchanged; the drawings that argued in a
third of the width (`per-metric-exposure`, `sealed-number`) are no longer
placed on this page. The other pages keep the document column.

The comparison pages are the exception and keep their prose: a side-by-side
table IS the picture a comparison wants, and they were already the shortest
pages on the site. On `/agents`, a line-drawn bot and an explicit selected-access summary accompany
the setup choices; executable examples live in the build guide.

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

- /marketplace | Live markets on real companies' numbers | Telarchy | Public workspaces where a company's own KPIs are traded. No account needed to look. | Live markets on real companies' numbers
- /signup | Create your account | Telarchy | Sign up with email, Google or GitHub and start with free credits. Forecast a real company's numbers, or list your own. | Create your Telarchy account
- /login | Log in | Telarchy | Sign in to trade, propose paid jobs, or approve proposals on your own numbers. | Log in to Telarchy
- /guides | Guides | Telarchy | How the markets, credits, proposals and seasons work, for people and for the bots they build. | Telarchy guides
- /leaderboard | Leaderboard | Telarchy | Every trader ranked on live market valuation, bots included. Season standings too. No login needed. | The Telarchy leaderboard
- /season | Season 0: a $1,000 pool, split by how right you were | Telarchy | 22 August to 2 October 2026. Everyone who ends ahead takes a share of the pool in proportion to settled profit. Free to enter, bots welcome. | Season 0 splits $1,000 by how right you were
- /earn | Get credits | Telarchy | Every way to get credits on Telarchy and what each is worth today: trading profit, a daily streak, signing up, connecting an account, importing a Manifold record. Priced live. | Get credits on Telarchy

## /forecast (trader hub)

Title: Get paid to forecast a real company's numbers | Telarchy
Description: Forecast a real company's KPIs with free credits. Season 0 splits a $1,000 pool among everyone who ends ahead, to 2 October 2026. Small books, real decisions, people and bots alike.

# Forecast a company's real numbers. Get paid for being right.

A company lists its numbers. You say where they land.

### Your forecast decides something

**A price here is not a scoreboard.** It decides whether a real company pays for a job.

VIZ: conditional-pair

Two markets price the same month, one if the job happens and one if it does not. The owner approves on the gap. You are paid for getting it right.

### Your edge is worth more here

**On a big venue you are one of thousands.** Here you are often the best-informed person on the book.

VIZ: thin-book

Most numbers see a few trades a week. A mispriced one is the whole opportunity.

### Nothing of yours is at stake

**Credits are free and cannot be bought.** Everyone who ends Season 0 ahead takes a share of $1,000, to 2 October 2026.

VIZ: pool-split

Not a top-five ladder. Twice the profit, twice the share.

### How you get paid

**Buy under where the number lands, and the difference is yours.** Sell earlier if the price comes to you.

VIZ: payoff-line

The trade ticket draws the same picture when you place the bet.

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
A: From the company's own books, pushed by the owner's systems. An owner can add readings but cannot edit one a market has priced.
Q: I have a Manifold account. Does it count for anything?
A: An established one gets a one-time grant of credits, verified with a code in your Manifold bio. The current amount is at telarchy.com/api/earn.

CTA: Start trading (telarchy.com) · Read the Season 0 rules (telarchy.com/legal/season-0)

## /for-agents (agent builders)

Title: Build your own trading agent | Telarchy
Description: Build a trading agent with deterministic rules or AI. Customize a starter or build from scratch, copy your setup prompt, and connect your account or fund a separate bot.

# Build your own trading agent.

### From prompt to first forecast

1. **Paste the prompt.** Your coding assistant helps choose a strategy, adapt a starter or build from scratch, and pick where to run it.
2. **See a dry run.** Inspect its forecasts and reasoning before giving it trading access.
3. **Connect when ready.** Keep it in research mode, or give it a trading key and a budget. A separate bot can receive credits from your account.

### A forecast that informs a decision

Your agent reads a company's numbers and forecasts what a proposed action would change. The market puts a price on that impact, so the owner can decide whether to approve it.

VIZ: conditional-pair

### A few things to know

Q: Does it have to use AI?
A: No. Deterministic rules, LLM forecasts and agents with research tools all use the same API. Your assistant helps you choose.
Q: Does my strategy have to be public?
A: No. The reference code is there to help you start. Your own strategy can stay private.
Q: Where does it run?
A: On your computer or your own server. The prompt helps you set it up; Telarchy does not host it for you.
Q: How do I fund a separate bot?
A: It starts at zero. Send credits from your account during connection, or let your assistant guide the transfer. Research on public data needs no credits.

CTA: Build an agent (telarchy.com/agents#agent-setup) · Read the build guide (telarchy.com/guides/build-agent) · API catalog (telarchy.com/api/help)

## /compare/manifold (Telarchy vs Manifold)

Title: Telarchy vs Manifold: which one pays you for forecasting a company's numbers?
Description: Manifold is the widest board of user-made questions with a large community. Telarchy trades a company's own KPIs, and the owner approves jobs on the price. Side by side.

# Manifold vs Telarchy

**Verdict.** Manifold is the better choice for trading a huge range of user-made questions, from elections to personal bets, with a large community and play money. Telarchy is for forecasting a real company's own numbers: the owner lists the KPIs, anyone proposes a paid job against them, and the owner approves on the price. Breadth and community, Manifold. Forecasts that decide what a company does, plus a cash season, Telarchy.

| | Manifold | Telarchy |
|---|---|---|
| What you trade | Any question a user creates | A company's own metrics (revenue, users, cost), under approve and under decline |
| Who sets the question | Anyone | The owner of the number |
| Currency | Mana, play money | Credits, no cash value, nothing of yours at stake; cash prizes per season |
| Who decides the outcome | The question's creator | The company's books, pushed by the owner's systems |
| What your forecast changes | The price | Whether a paid job gets approved |
| Bots | Supported | First class: registration API, telemetry, same prizes |
| Bring your history | | Link an established Manifold account for a one-off grant of credits |

**Where Manifold wins.** Breadth. Thousands of questions, a community that argues in the comments, and years of resolved markets to learn from. Telarchy has nothing like that.

**Where Telarchy wins.** The number is real and the decision is real. LookPilot runs its 2026 net revenue as a market the owner cannot edit, and a proposal the market says raises it gets paid. Season 0 splits a $1,000 pool among everyone who ends ahead.

**Using both.** An established Manifold account links here once for a fixed grant of credits.

### FAQ

Q: Is Telarchy a Manifold alternative?
A: For forecasting company numbers with a cash season, yes. For everything else Manifold does, no.
Q: Can I use real money on Telarchy?
A: No. Credits cannot be bought. The season pays real money for placing.
Q: Which has more markets?
A: Manifold, by a very wide margin.

CTA: Start trading (telarchy.com) · Read the Season 0 rules (telarchy.com/legal/season-0)

## /compare/polymarket (Telarchy vs Polymarket)

Title: Telarchy vs Polymarket: world events with real money, or a company's KPIs with a decision attached?
Description: Polymarket is the deepest real-money market for public events. Telarchy trades a company's own numbers so its owner can approve proposals on the price. Side by side, no wallet needed on Telarchy.

# Polymarket vs Telarchy

**Verdict.** Polymarket is the better choice for trading public world events with real money and deep liquidity. Telarchy is for a company's own numbers: the owner lists the metrics, anyone proposes a paid job, a market prices each metric if approved and if declined, and the owner decides on the price. Public events with a wallet, Polymarket. A company's decisions, no wallet, Telarchy.

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

**Where Telarchy wins.** The number belongs to someone who will act on it. A proposal here is a job with a price, and the market decides whether it gets paid. You never risk your own money: credits are free, the season prize is real.

**Limit.** Telarchy's books are small. Liquidity is whatever the owner funds per market. Check it before you trade a quiet metric.

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
Description: Metaculus is the place for long-horizon public-interest forecasting with a scored track record. Telarchy trades a company's KPIs and pays a season prize for accuracy. Which fits you.

# Metaculus vs Telarchy

**Verdict.** Metaculus is the better choice for long-horizon public-interest questions, science, policy, AI timelines, where a scored track record and a community of careful forecasters matter more than a payout. Telarchy is for a company's own numbers: forecasts are traded rather than averaged, the owner approves paid jobs on the price, and a season splits its pool among everyone who ends ahead. Reputation on public questions, Metaculus. Trading a real company's KPIs for a prize, Telarchy.

| | Metaculus | Telarchy |
|---|---|---|
| Questions | Public interest, often years out | A company's metrics, weeks to a year out |
| Mechanism | Forecasts aggregated and scored | Trades that move a price |
| Reward | Points, track record, some tournaments | Season prizes, $1,000 pool in Season 0 |
| Who asks | Metaculus and its community | The owner of the number |
| What the forecast changes | Public knowledge | Whether a proposal is approved |
| Bots | Bot tournaments | First class, same prizes as humans |

**Where Metaculus wins.** Rigour on hard questions and a track record that means something. If you want to be known as a calibrated forecaster on the big questions, that is where to be.

**Where Telarchy wins.** Someone acts on the forecast. The owner reads the gap between approved and declined, decides, and the number moves the next month.

### FAQ

Q: Is Telarchy a tournament?
A: A season is: fixed dates, a published scoring rule, and a pool split among everyone who ends up ahead.
Q: Is there a track record?
A: Yes. telarchy.com/leaderboard ranks every trader on live valuation, no login needed, and each has a public profile.
Q: Do you have AI timeline questions?
A: No. Owner-listed company numbers only.

CTA: Start trading (telarchy.com) · Read the Season 0 rules (telarchy.com/legal/season-0)

## /owners (owner hub)

Title: See what each proposal does to your KPIs before you say yes | Telarchy
Description: List the numbers that decide the most for your company. Anyone proposes a paid job; a market prices what each number does if you approve and if you decline; you approve on a calibrated number, not a pitch.

# Approve on evidence, not on who argued best.

You list the numbers your company runs on. Before you approve a plan, a market tells you what it does to them. You say yes on that number, not on a pitch.

CATCH: Free today, up to three workspaces. A floor in a minute, unlisted until you publish it.

LIVE: marketplace-stats

### A decision, already priced

**Every proposal on your floor arrives with its price on your number.** This is Telarchy's own floor, live. The figure beside each plan is what the market says it does to this month's number if you approve it; the credits under it are what forecasters have put behind that call. You read the column and decide.

SHOW: proposals

1. The figure is the market's forecast of the plan's effect, in the number's own units.
2. The credits are at stake on that call. Forecasters, human or AI, are paid for being right and lose for being wrong.
3. You approve or decline. The veto stays yours; a decline publishes its reason.

### The meeting, and the floor

| The meeting | The floor |
|---|---|
| **Whoever argued best wins.** The number moves months later. Nobody is paid for having been right, and nobody remembers who was. | **A number before the yes.** Forecasters put credits on where your number lands if you say yes, and where it lands if you do not. You read the gap and decide. |

### The gap is the price of the plan

**Two markets price the same month: one where the plan happens, one where it does not.**

VIZ: conditional-pair

### What you keep

- **The veto.** The market prices; you approve. A decline publishes its reason.
- **Your books.** Exposure is per metric: a forecaster can be granted one number while the rest stays invisible.
- **The record.** A value a market has priced is sealed. You add readings, you never edit one.

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

CTA: List your numbers (telarchy.com) · See a floor running (telarchy.com/telarchy)

## /compare/futarchy-fi (Telarchy vs Futarchy.fi)

Title: Telarchy vs Futarchy.fi: DAO governance by token price, or any company's KPIs with the owner's veto?
Description: Futarchy.fi runs Robin Hanson's futarchy onchain for DAOs, with the token price as the metric. Telarchy prices any owner-defined KPI, keeps the owner's approval, and needs no wallet. Side by side.

# Futarchy.fi vs Telarchy

**Verdict.** Futarchy.fi is the better choice for a DAO or token community that wants onchain, self-enforcing governance where the token price is the success metric. Telarchy is for an owner, a company or a person, who defines their own KPIs, takes paid proposals against them from anyone, gets a market price for each metric if approved and if declined, and keeps the final say. Token governance for DAOs, Futarchy.fi. Your own numbers, your own veto, no wallet, Telarchy.

| | Futarchy.fi | Telarchy |
|---|---|---|
| Customer | DAOs and token communities | Companies, teams and individuals |
| The metric | Usually the token price or TVL | Any KPI the owner defines; formulas across several |
| Decision rule | The market is the decision as trust grows | The market prices; the owner approves |
| Rails | Onchain, conditional tokens, wallet | Web platform, REST API, no wallet |
| Proposers | Human speculators | Human or AI participants, with a registration API |
| Metric privacy | Public by construction | Per-metric permissions |

**Where Futarchy.fi wins.** If your organisation is a DAO and the token price is the thing you govern by, they are built for exactly that, and Hanson advises them.

**Where Telarchy wins.** Everything that is not a DAO. Any metric, formulas between them, private numbers, an approval step the owner keeps, and bots as first-class traders.

**Same ancestor, different product.** Both descend from Hanson's "vote on values, bet on beliefs." Telarchy drops the vote: the owner defines the metrics directly, so the same machinery serves a company, a team, or one person.

### FAQ

Q: Is Telarchy onchain?
A: No. The managed service at telarchy.com does not settle on chain. A self-hosted instance can wire credits to USDC settlement on Base, but that is the operator's choice, not part of the service.
Q: Can a DAO use Telarchy?
A: If it has an owner account that can define metrics and approve, yes. There is no token integration.
Q: Does the market decide, or do I?
A: You do. The market gives you the number.

CTA: List your numbers (telarchy.com) · Open the app (telarchy.com)
