# UI conventions

How Telarchy's pages are laid out and styled. There is exactly one design
language: everything public is a `.pubws` page, and anything that does not
look like the trading floor is a bug. Rules are stated per surface, in the
present tense. History: notes/decisions/ui-conventions.md.

## What was deleted, and why it is not coming back by accident

The console (`AppLayout`, the sidebar, the nine workspace tabs, the console
marketplace and leaderboard, the landing page, /start, /welcome, /claim,
/create-workspace, the guides and tutorial engine, /benchmark, the API-key
portal, the agent portal, and the `/alpha` wall) is not in the tree and is
not behind a flag. Git history is its archive. Every API endpoint it drove
is live and documented in `GET /api/help`; the operator drives those by
hand until a surface for them exists in this language. `/admin` exists in
this language (see "The cockpit"); nothing else on that list does.

Nothing public-facing redirects to an old console UI, for anyone, the
platform admin included: there is no old UI to land in.

Two consequences for new UI:

- There is no app shell. Every page renders standalone and carries its own
  top bar. A sidebar is the deleted thing and is not rebuilt.
- There is no `page-content`, no tabs and no `max-width: 1080px` tier. The
  poster column is 660px (`.pubws-main`), a document column is 760px
  (`.pubws-doc`), a door is 26rem (`.pubws-auth`). Every page uses one of
  those.

## Every internal link is base-aware

The app is built twice, at `/` and at `/beta/` (docs/infra/deploy.md), so a
root-absolute URL written into a component silently walks a /beta visitor
back onto the production build. The rule: internal navigation uses
react-router `<Link>`/`navigate()`, which inherit the basename; the rare
genuine URL (a server endpoint such as /api/data-room, a fetch of the
served index or /api/waitlist) goes through `withBase` from
`src/lib/base-path.ts`, the only file allowed to read
`import.meta.env.BASE_URL`. All four rules are enforced by
`src/lib/__tests__/internal-links-ownership.test.ts`, which fails the suite
on any new root-absolute href, location assignment, or root fetch.

## Page layout

Every page is `<div className="pubws">` with a `.pubws-topbar` and one
centered column. The top bar carries the wordmark on the left and, on the
right, either a Log in link or the account menu; it matches the width of
the column beneath it (`--narrow` for doors, `--wide` for documents) so the
wordmark never floats aligned to nothing.

Horizontal padding belongs to the column (`.pubws-main`, `.pubws-doc`),
never to the blocks inside it, so left edges align down the page.

**Blocks of text are left-aligned.** A headline, a price, a caption, a
link row, a button, or any other line that stays one line may sit centred
under a centred title. Anything that wraps (a lead sentence under a
headline, a description, an empty-state explanation, a note under a
control, form help) is set `text-align: left`, whatever its container
does: a ragged left edge is harder to read than a ragged right one, and a
centred paragraph under a centred title is the poster look the site does
not use. The block may still be a narrow column centred by its margins
(`max-width` + `margin: auto`); it is the text inside that is left-aligned.
`src/__tests__/left-aligned-text.test.ts` names the prose classes and
checks each declares it (owner rule 2026-09-04, notes/decisions/ui-conventions.md).

On every page, a build published while the page stayed open shows as one
small pill in the bottom right, `.pubws-update`, reading "new version ·
reload"; pressing it reloads. It is the only fixed element the app draws over
a page, and it appears only when the reload cannot be taken automatically
(docs/infra/deploy.md, "A tab that is already open picks the new build up").

## While a page loads

A page never shows a sentence it will take back, and never a dot in an
empty room. Three rules, in order of effect:

1. **Data rides in the HTML on a full load.** The server puts what the
   page needs for its first paint into the document it serves: the whole
   home payload for `/` (`#telarchy-home`, the body of `GET
   /api/marketplace/home`), and a floor's name and one-liner for a share
   link (`#telarchy-floor`). The client reads the element once on mount
   through `src/lib/inline-data.ts`, deletes it, and treats it as the
   first response; a client-side navigation to the same page fetches
   instead. A page asks for its data in ONE request, never a waterfall.
2. **Where data is still on its way, grey bars hold the exact shape of
   what is coming.** The ghost (`.pubws-ghost`, `bg-tertiary`, 4px radius,
   one slow sweep of 5% light across it) is drawn at the real element's
   height and width in the real layout, so nothing moves when the content
   lands. A floor draws its three columns as ghosts with the name from the
   share hint painted at once in the headline slot; the home page draws
   the board; a page whose code is still downloading draws the top bar
   over an empty column (`lazy-page.tsx` renders `PageShell`, never
   `null`).
3. **Content rises in, in order.** Landed content gets `.pubws-rise`
   (opacity and 10px of travel, 0.55s), staggered 60 ms per sibling from
   the top, and a chart fades in once; nothing loops. While anything
   is still pending a 2px accent hairline runs under the top bar
   (`.pubws-progress`, to 70% in 0.9s, then to 100% and fading when the
   page is whole).

`prefers-reduced-motion` turns the sweep, the rise and the draw off and
shows the content plain. The old motif, an accent dot rippling in the
space (`.pubws-loading-dot`), is gone from every page (owner decision
2026-09-04, notes/decisions/ui-conventions.md).

## The doors (login, signup, waitlist)

`AuthShell` (components/AuthShell.tsx) is the frame: same top bar, same
Fraunces headline, one narrow column, OAuth buttons above a hairline "or",
then labelled underline fields (`.pubws-field-line`) and one full-width
`.pubws-cta`. A door is a poster with a form on it, not a card floating in
a grey page. Legal documents (`/terms`, `/privacy`, `/legal/season-1`) use
the same top bar over the wider `.pubws-doc` column.

## Type scale

| Element                        | Size      | Weight | Notes                                                    |
| ------------------------------ | --------- | ------ | -------------------------------------------------------- |
| Page headline (`.pubws-name`)  | clamp     | 700    | Fraunces; the page's one large statement                 |
| Section label (`.pubws-h2`)    | 0.72rem   | 600    | uppercase, tracked, `var(--text-tertiary)`               |
| Body                           | 0.875rem  | 400    | `var(--text-primary)`                                    |
| Numerals (price, credits, cr)  | mono      | 600    | JetBrains Mono, tabular                                  |
| Meta / time / unit             | 0.75rem   | 400    | `var(--text-tertiary)`                                   |

Section titles are tiny uppercase labels, **not** large bold headers. The
headline is the only large type on a page.

## Color usage

The product is monochrome plus a single accent (amber). Avoid per-category
color coding. Tags and state chips are neutral grey on `bg-tertiary` unless
a single state genuinely needs attention (error red, a paused dot).

Green and red speak only as direction: the Higher/Lower pair on the floor,
an approved/declined branch, a profit delta. Never paint a whole row.

## Hairlines, not cards

For lists, separators and dividers, use a 1px `var(--border-color)`
hairline. Do not wrap sections in `bg-secondary` cards with shadow and
radius; those read as heavyweight panels. The exceptions are the real
interactive surfaces: the trade ticket, the account dialog, a modal.

## How much a page says

**A sentence earns its place by helping the reader act, never by
defending the design.** Every page is written for someone deciding what
to press, so what belongs on it is what this thing is, what it costs,
what it gives back, and where the button is. The reasoning behind a
price, a rule or a mechanism belongs to the docs and the records, and a
reader who wants it can read them.

Concretely, the sentences to cut on sight:

- **Why the mechanism is the way it is.** "because the market opened at
  that number", "which is what pulls forecasters to your number", "the
  change widens who may enter". The rule stands without its defence.
- **The same fact explained twice on one page**, or once per page across
  four pages. One surface owns it; the rest link.
- **The closing note that restates the page.** A footnote under a table
  that says how the table works is the table failing.
- **Pricing or fairness philosophy.** What a thing is worth is a number
  on the row. Why it is worth that is a design record.
- **The sentence that argues for the sentence before it.** "That is the
  point", "on purpose", "which is what makes it a skill contest", "it can
  only add to a score, never take one away", "your credits are never
  spent". A rule is stated; it is not defended, reassured about, or
  explained twice. A refrain ("human or AI", "calibrated number") appears
  once on a page at most, and plain words ("people or bots", "you decide
  on the price") are preferred to the canonical phrase.

What never gets cut for length: a disclaimer's operative words ("not
advice from X"), the consequence of an irreversible action, eligibility
rules, and the claims that keep a purchase a purchase rather than a
contest entry (the funding page's "can only ever go into your own market
pools", "does not enter you into the prize season"). Trimming those is
not concision; it is a different statement.

The house benchmark is the login page and the market list's headline.
Adopted 2026-08-30 (owner: "less words.. everywher on the website.. i
feel like ther eare useless explanations not releevant to users"); the
survey of what was cut and the outside evidence behind the rule are in
the telarchy umbrella, `notes/yc-website-copy-2026-08-30.md`. The
refrain and justification rules were added 2026-09-04 after a reader
called the copy "cloyingly Claudish" (notes/decisions/ui-conventions.md).

## Vocabulary a visitor reads

**User-facing copy says MARKET, never "floor".** The word is internal
vocabulary only: component and class names (`FloorRails`, `.pubws-*`) and
doc prose like this file may keep it, but no string a visitor can read
may. When copy needs a word for one public workspace, it is "market". The
owner's own surfaces are copy a visitor reads too: the create dialog, the
publish band and the empty state all sat outside this rule until the
2026-08-30 walkthrough read them back.

**A credit figure on screen is the POOL, never `b`.** A market carries two
numbers that look alike and are not: `pool`, the credits people actually put
in, and `liquidity`, the LMSR sensitivity `b = pool / ln 2` that the price
maths takes (docs/vision.md). They differ by a factor of 1.44, so a surface
that reads `liquidity` and writes "cr" overstates by 44%: an owner who
injected 1,000 credits watched the pool rise by 1,443 and reported it
(2026-08-30). Anything a person reads as money, on the floor, in a dialog or
in the public books, takes `pool`; `liquidity` goes only where a price is
being computed.

**An assistant row says what it DOES, never "ask".** Otto acts as the person
signed in, and so does their own agent once it holds a key, so a row that
offers either says the work: run, trade, set up. "Ask" survives in exactly
one place, the signed-out reader, for whom it is the truth
(docs/owner-on-the-floor.md, "Handing it to your own agent").

**The thing on the ballot is a PROPOSAL, never a "contract" or a "job".**
An owner puts their own actions on the ballot beside the ones strangers
offer (docs/owner-on-the-floor.md), and an owner's proposal has no ask and
no counterparty, so "contract" is wrong for it; "job" was wrong for the same
reason. "Proposal" covers both, and it is the word the API, the skill and
the guides already use, so a visitor now reads one word everywhere. The
board is "Proposals", the action is "Propose", and a participant "offers" or
"proposes" one. The people who get paid are still **contractors** ("Top
contractors" in the standings footer): a contractor is someone whose proposal carried a
price and was approved, and the noun for the person survives the rename of
the thing.

The API keeps its identifiers: `proposal` where it already had it
(`POST /api/proposals`, `proposalId`) and `contracts` where a payload or a
path used that word before the rename (`GET
/api/marketplace/:idOrSlug/contracts`, `proposals[]` and `contractsTotal`
in the brief, the `contract` notification kind, `contractDecided`). So do
component and CSS names (`JobsBoard`, `.jobform-*`). Renaming those buys
nothing and breaks every client; the rule is about what a visitor reads,
and the prose describing those keys says proposal. A floor link from a
notification is `#proposal=<id>`; the older `#contract=<id>` still opens
the same proposal, because it is printed in emails already sent. The rule
is checked mechanically by `src/__tests__/proposal-not-proposal.test.ts`.

## The market's activity is one list

The panel under a market has three tabs: Discussion, Positions, **Activity**.
Activity is the market's whole history in one order, trades and the pool
together, newest first, and its count is both.

The pool belongs there because it is the other half of every price in the
list: a price that barely moved because the book got four times deeper is not
the same event as a price nobody traded, and with only trades on screen a
reader cannot tell those apart. A pool row carries a drop rather than a green
or red triangle, since the pool is not a side of the market, and says what
went in and what the pool holds after it. The platform's own opening
liquidity has no funder to name and reads as "the house".

It is called Activity rather than Trades for one reason: a funded market
nobody has traded used to answer "Trades (0)", which looks exactly like a
market nobody funded either.

## The participant profile (/participants/:id)

`telarchy.com/participants/<handle>` (`ParticipantProfilePage`, `.prof-*`
styles) is a trader's public record, modelled on what a prediction-market
account page shows: who they are, how they are doing, and every bet they
made, each one a door back to the market it was made on. Standalone, in the
`.pubws` language, one 640px column, hairlines and mono numbers.

The header is the picture, the handle, the linked Manifold handle when one
is verified, and one line of standing: "Trading since <month day, year> ·
#N on the leaderboard" (the rank line is omitted when the participant has
no rank). The bio follows when set.

**The stats strip** is one ruled band of three cells, and every number in
it is one the platform already reports elsewhere, so the profile never
disagrees with another page:

- **Profit**: the trading profit marked to market that the leaderboard
  ranks on, the same number, with "N settled · N open" beneath it. Green
  when positive, red when negative.
- **Balance**: the participant's tradeable credits right now, platform-wide
  (the live point of the balance history), with "N cr in positions"
  beneath: what their open positions are worth at the current call, summed.
- **Trades**: how many, with "N cr traded · <ago>" beneath. The
  traded figure is credits moved by their buys and sells on public floors;
  redemptions are not trades and do not count.

Profit and Balance are pressable, the way a Manifold account's balance,
invested and profit tiles are: the pressed cell (its label in ink, a 2px
ink rule under it) is the series the chart below draws, and Balance is
pressed on arrival. Trades is a number, not a series, and is not
pressable.

**The chart** is the floor's market chart (`MarketChart`, "The price and
the chart") drawing the pressed cell's series, ending on the live point:
the same step line, gradient, labeled end dot, crosshair and tooltip, and
the same range words (`1W 1M ALL`, a range longer than the history
dimmed), so a reader who has hovered a floor already knows how to read
this one. It is drawn in ink rather than amber, because amber is the
market's call and this is not one, and its tooltip names the series
("balance" or "profit"), never "market". Balance is the daily balance
snapshots; profit is the profit the board scored, as the daily snapshot
recorded it (below), so the line is the leaderboard's number day by day
and its live point is the strip's. A series with fewer than two points
draws nothing; in its place one quiet line says "Recorded once a day; the
first point lands tomorrow."


**Positions** are rows, one per market and direction the participant holds,
heaviest first. The title is the metric and its date ("Active traders ·
Sep 2026"); a conditional position carries "if <proposal title>" after it.
The sub-line is the holding and where the market stands: "N higher ·
<workspace> · market at <consensus>, P% higher". The right column is the
position's profit (worth minus spent, coloured), and under it "worth N ·
spent N". Worth is the shares marked at the current payout factor, the
same mark the board uses (docs/seasons.md F1). Spent is what was paid for
the shares in that direction; a sale takes shares off the position but
not credits off this figure, so a partly sold position shows its whole
cost. The strip's open profit is the board's number, which nets sold
proceeds out, so the position profits need not add up to it. Every row
links to the market on its floor.

**Trades** are rows, newest first, and each one says what was done in
plain words: "Bought 21,192 higher on Active traders · Sep 2026", "Sold
…", or "Redeemed N matched pairs" for a redemption (docs/ui-conventions.md
"A trader holds ONE net side"). The sub-line carries the price paid per
share ("0.297 cr a share", cost over shares) and, when the trade recorded
it, how far it moved the market: "moved the market 18.9 → 20.2", the
market's call before and after that trade. A trade from before the
platform recorded the call shows the price alone; a redemption moves
nothing and shows neither. The right columns are the credits moved and how
long ago. **Every trade row is a link to that trade on its floor** (below).

**Proposals** lists what the participant proposed, with the ask, the
status and the floor, each row linking to the proposal on its floor. A
visitor reads "proposal" (docs/ui-conventions.md "Vocabulary a visitor
reads"); this section was called "Proposed jobs" and is not.

### A trade has an address

A trade on the profile links to `/<workspace slug>#market=<marketId>&trade=<tradeId>`
(a trade on a proposal's branch links to `#proposal=<proposalId>&trade=<tradeId>`,
because the floor shows a proposal's two branches together). The floor
handles the hash the way it handles `#comment=`: `market=` steps the page to
that market, `proposal=` opens that proposal, and `trade=` opens the
Activity tab, scrolls the row carrying that trade id into view and fires
the arrival flash once. The hash is consumed on arrival. A trade that is
no longer in the Activity list (the list holds the newest 50) lands the
reader on the right market with the tab open and nothing flashed; that is
still the right floor, and better than a dead link.

For the two pages to say the same thing about one trade, an Activity row
on the floor also names the price per share: "bought 21,192 at 0.297 cr".

### What the platform records at trade time

The trades ledger keeps, beside direction, shares and cost, the market's
call before and after the trade (`consensusBefore`, `consensusAfter`),
written by the trade transaction itself so a display never has to replay
the book to know what a trade did. Rows written before the columns
existed are null there, and every reader treats null as "not recorded",
never as zero. Redemption rows move no price and record nothing.

The daily balance snapshot (one row per participant per UTC day, written
by the hourly cron) records, beside the balance, the participant's
trading profit marked to market over public floors at that moment
(`profit`), the same number the leaderboard ranks on. Rows from before the
column carry null and are not profit history.

## A bot says it is one

A participant with no browser account is a bot: it was registered through
the API, by itself, by a person's account or by another participant. Every
public surface that prints a participant's name prints the bot icon right
after it (`BotMark`, `.pubws-bot`): the same line-drawn robot the top bar's
Agents link draws (`BotGlyph`, one drawing for both), in the muted text
colour, sized to the name's text, with the accessible name and tooltip
"bot". No word, no pill: the icon alone, the same everywhere:

- the standings footers (top traders, top contractors, traders on this
  proposal) and the full leaderboard's rows, both tables;
- the market's Discussion, Positions and Trades lists: the comment's author,
  the holder, the trader, the pool's funder;
- "proposed by" on the proposals board and on the proposal view;
- the profile header, beside the name.

A browser account is never marked, whatever it does and whoever runs it: a
house account a person signs in to is a person on the page.

The API says it where it serves the name, so no page has to guess: `bot` on
a leaderboard row, a contractor, and each position, trade and pool row of
market activity; `fromBot` on a comment; `proposedByBot` on a proposal;
`bot` on the profile. The fact is read once, in `botIds` (participants.ts).

**The profile of a bot the platform runs** (`platformOperated`) says who runs
it and on what, one line under the name: "Run by Telarchy on <model>", the
model being the `model` label of its most recent recorded forecast, and "Run
by Telarchy" alone when it has filed none. The API carries it as `runBy`
(`'telarchy'` or null) and `model` (string or null). A bot somebody else
runs gets the mark and no line.

**Every bot's profile names its owner**, under the name: "Owned by <handle>",
the handle linking to the owner's profile. The owner is the participant that
created the bot (`ownerAgentId`) or, when a person's account created it, that
person's participant (`ownerUserId`). For a bot the platform runs the two sit
on one line: "Owned by telarchy-agents · Run by Telarchy on claude-fable-5-1".
The API carries it as `owner` (`{ id, nickname }`, or null for a person and for
a bot with no recorded owner, which then has no owned line).

**The standings footer names the bots on this floor.** When at least one bot
placed a trade on this workspace in the last seven days, one line sits under
the footers, above "Show full leaderboard": "N bots trade here. Build your
own", "Build your own" linking `/agents` ("1 bot trades here" in the
singular). N is `botTraders` on the floor payload: distinct bots with a trade
(not a redemption) on this workspace in the trailing seven days. At zero there
is no line.

## Trading floor (root slug page)

`telarchy.com/<slug>` (`TradePage`, `.pubws-*` styles; `/marketplace/:idOrSlug`
canonicalizes here) renders **standalone** (as every page does) and renders
**the market and nothing else**. History of this surface:
notes/decisions/ui-conventions.md.

### The top bar and the account menu

The top bar is full-bleed, pinned to the viewport corners: the Telarchy
logo lockup at the landing nav's 3rem in the top-left, linking home,
vertically centered; top-right, after the session check settles and faded
in so signed-in visitors never see a flash, either a Log in link or, when
signed in, the bell (see "The bell") and the account menu: a round avatar
(the account's `image`, which OAuth providers populate and the menu can
set, else initials) opening a small popover that keeps only a glance
(name, credits to trade and credits earned, "Account settings", log out).
The bar owns a stacking layer above the floor rails so the popover paints
over them; the bar deliberately ignores the 660px content column. "Log in"
never wraps.

On a phone (640px and under) the bar stays at the top of the viewport while
the page scrolls: sticky, on the page background, one thin row. A floor is
nine screens tall on that display and the logo is the only way back to the
floors list, so a bar that scrolls away leaves a phone reader with no way
home short of scrolling to the top. On wider screens it scrolls with the
page as before.

The mark at 2rem stands in for the lockup wherever the lockup does not fit,
which is every width under a tablet's 768px: the lockup is 4.4 times as
wide as it is tall, and the row carrying it measures 708px before the
viewport's own margins.

The logo is never what gives way. Whatever the viewport, the logo on it
keeps its own proportions and its full height: it is not squeezed narrower
than it is drawn, and a bar too tight for everything on it narrows the
controls instead. The signed-out Manifold pitch folds under 560px. The
credit balance and agent destination stay visible on phones; labels shorten
before the controls disappear. Below 480px, the secondary Discord and bug-report shortcuts yield their space to account controls. No width pushes the bar past the screen.

Left of the account, on every top bar, sits the **Agents & API** destination:
a line-drawn bot icon with an Agents label on desktop and the icon on mobile.
It is a normal link with an accessible name and tooltip. Signed-in visitors
land on `/agents`; signed-out visitors also land on `/agents`.
The current agent page marks it active. It replaces the top-bar theme toggle.

Every page, including Agents and guides, retains the shared Discord, feedback and Agents shortcuts in the same order. Signed-in visitors also retain the notifications bell. Shared shortcuts come from one component so moving between the floor and document pages cannot omit them. All signed-in top bars use the same account menu and credits link. The balance
is one compact two-line link to `/earn`: current credits above, **Earn +N**
below when N is available, otherwise **Get credits**. The amount available is
never added to the balance. A failed availability read shows no invented
amount. Both lines remain visible on phones. There is no separate Earn credits
button in the top bar. Liquidity stays a separate, explicitly labeled wallet.

Theme switching lives in the account menu. The site follows the OS until a
visitor chooses a theme; the per-browser `telarchy-theme` choice and before-
paint application remain unchanged.

The picture is saved via POST /api/auth/profile { image }: there is no
blob store in this stack, so the account dialog renders the pick to a
256px JPEG and sends it inline as a base64 data:image (png, jpeg or webp,
at most ~96KB encoded), and the endpoint otherwise accepts only http(s)
URLs (what OAuth providers populate), so the value can never become a
javascript: vector in an img src.

### The question line: the pickers, and the sentence

The floor prices a SET of metrics, and every one of them is one number read
on several dates. The horizon list is therefore a grid, metrics x dates.
**Both axes of that grid are strips** (revised 2026-09-09, replacing the two
dropdown chips of 2026-09-04): two rows of mono small-caps tabs on their own
hairline, the metrics first and the dates under them, the selected one in ink
over an accent underline. **Only the DATE strip carries a call** (owner ask
2026-09-09): a metric on its own is not a market, so a number under a metric's
name is a value for whichever date happens to be selected, printed as though
it belonged to the metric. A dropdown hides how many books a floor prices and what they
say; a strip is the scoreboard of everything this floor prices, read
without pressing anything, which is the whole of what a visitor came to
find out:

```
  ACTIVE TRADERS   REVENUE   OUTSIDE OWNERS DECIDING   PROFITABLE FORECASTERS
  ------------
  THIS WEEK   THIS MONTH
  14.3        17.9
              ----------
        What will be Telarchy's active traders this month?
              NOW · READ 35M AGO   |   MARKET'S CALL · FOR 30 SEP
              9.00                 |   17.9  ▲ +0.4
                  [ HIGHER ]  [ LOWER ]
```

- **The metric strip** (`.pubws-strip`, `.pubws-strip--metric`) lists the
  floor's metrics, primary first, each tab (`.pubws-strip-tab`) the metric's
  name and nothing else, **in every view** (owner ask 2026-09-10, twice: "dont
  show the values here as it doesnt make sense given that they arent
  individual markets", then "but again donet show any numbers here" of the
  proposal view). A metric is an axis, not a market: whatever number stands
  under its name is really about the date selected on the strip below, and
  reads as though it belonged to the metric. A floor with one metric draws no
  strip at all, because a strip of one is a label. **A picker with one
  option is not rendered, for the owner either** (Viktor, 2026-09-11: "if
  there is only one metric or one date dont put the selector of that type
  there"): the manager's "Manage metrics" used to keep a one-tab strip
  alive as its way into the dialog; now it moves to the owner row below the
  strips instead (see "The owner's two entries").
- **The date strip** (`.pubws-strip--date`) lists the selected metric's open
  dates soonest first, each tab the clock's name ("THIS WEEK", "THIS MONTH";
  `dateSegmentOf`) over that date's call. The settle day it used to carry
  moves to the stat row's caption, which already says "FOR 30 SEP · SETTLES
  IN 21D" and is the only place it needs to be said. One open date draws no
  strip, for a visitor and for the owner alike (2026-09-11; the manager's
  "Manage dates" moves to the owner row). **A rolling minute or hour horizon is one tab, the newest open
  cell** (2026-09-11, Viktor, of a snake strip reading 14:39 · 14:42 ·
  14:44: "there shouldve been the one only the reached length"): a floor
  whose operator opens a new cell every step would otherwise list an
  hour of minutes as if they were horizons. The older cells still trade
  and settle, and the one a selected proposal is priced on is listed
  beside the newest while that proposal is open on the page, so its pair
  is never hidden from the reader looking at it.
- **A tab with no price prints a dash**, never a borrowed number: an
  unfunded book is a book nobody has priced, and a strip that invents a
  value for it is worse than one that admits it.
- **A proposal pair with no liquidity cannot be pressed** (owner ask
  2026-09-09). Nothing has been staked on that cell, so there is no forecast
  to show and nothing to trade when you arrive: a zero with a word under it
  was a prediction dressed up as a fact. On the date strip the tab reads "no
  liquidity" where its number would be; on the metric strip, which prints no
  numbers, it is quiet and dead, and says so on hover. The word "untraded" is
  gone with it; where there IS liquidity the number stands on its own.
- **The owner's two entries stay reachable.** "Manage metrics" and "Manage
  dates" are the last tab of their strip, in the accent, for a manager only;
  they open the same dialogs the chips' menus opened (the metrics dialog and
  the metric's sheet, docs/owner-on-the-floor.md). When an axis has one
  option its strip is not drawn (above), and its entry goes to **the owner
  row** (`.pubws-strip-owner`, 2026-09-11): one quiet hairline row under
  the strips, right-aligned, mono small-caps in the accent, carrying only
  the entries whose strip is gone (one or both). A visitor never sees the
  row. The rule hides a picker, never an owner action.
- Each tab is a `button` in a `tablist` with `aria-selected`, so a keyboard
  reader moves along the strip with the arrow keys. The strips scroll
  sideways on a phone rather than wrapping or shrinking their labels; the
  selected tab is scrolled into view.
- **The caption line below them carries the proposal's deadline and nothing
  else.** With the pickers gone from it, the `h2` renders only when a
  proposal is selected, which is the one thing that still belongs on that
  line (the amber chip, below).
- **A market with no price keeps the settle day.** It prints no stat row, so
  the day it is forecasting rides the "no price yet" line instead. The day
  never leaves the page, which is the rule the date chip used to carry.

- **The date word names the instant the book asks about, at the cell's own
  granularity** (Viktor, 2026-09-11, of a minute cell titled "on 11 Sep?"):
  "today", "this week", "this month" for the named clocks; "on 30 Sep" for
  any other day; "at 12:38" for a minute cell; "in the hour to 13:00" for
  an hour cell. A book that settles inside a minute is never titled with a
  day. The date strip's tab and the board's "impact by" use the same
  words (`dateQuestionOf`, `horizonLabel`).
- **A game's floor asks in the game's unit, not at a clock time** (Viktor,
  2026-09-11, picking from the snake floor's design proposal). On a floor
  whose `liveFeed.kind` is `snake` a minute cell reads "in 60 moves"
  (`moveQuestionOf`): the whole minutes from the current minute to the
  cell's own minute (its settle instant less one minute; never below 1),
  so the count is the same at any second of the minute (a step opened at
  13:40 is 60 moves from its 14:40 cell at :00 and at :59, never 61),
  because the game moves once a minute and "at 15:53" is a fact about
  the clock, not about the snake. The strip's tab keeps the clock, and the number ticks down with
  the page's minute clock. An hour or day cell, and every other floor,
  reads exactly as before.
- **The sentence is "What will be {company}'s {metric} {date}?"** The
  scaffold words sit a register quieter (`.pubws-instrument-ask`); the
  metric and the date are the sentence's ink. The company is named
  possessively even though the identity block already carries the name,
  because the sentence needs its subject (a deliberate relaxation of the
  2026-08-18 say-it-once rule, for grammar; the metric word still strips a
  leading copy of the company's name via `captionLabel`). **The metric word
  reads in sentence case** (2026-09-10, of "Telarchy's Active traders this
  month?" live on every floor whose metric is stored capitalised): a stored
  name is a label, and a label dropped into the middle of a sentence keeps
  its capital only when it is an acronym ("DAU", "MRR") or starts with a
  proper noun the company's own name did not strip. `sentenceCase` in
  `lib/floor-horizons.ts` owns that rule, and every sentence that quotes a
  metric mid-line (the question, a proposal's question, the impact caption)
  goes through it; the ticket's subject starts its own line and keeps its
  capital.
- **The sentence's metric and date are cycle words** (`.pubws-ask-word`,
  the world word's dotted underline, so a clickable word looks the same
  everywhere on the floor). Clicking one steps to the next option and
  LOOPS (the 2026-08-20 arrow rule: a control that sometimes does nothing
  is worse than one that always moves); with one option the word is plain
  text and no control. A named clock reads as its own adverb, "today",
  "this week", "this month", with no preposition; any other date reads as
  "on" plus its settle day ("on 30 Sep"), computed by `dateQuestionOf`.
  The word's tooltip carries the full settle instant.
- **Picking a metric keeps the date when it can.** A reader on "this week"
  who moves from revenue to reviews lands on reviews this week; only when
  the next metric has no open market on that date does the page fall to
  that metric's furthest-resolving one (`cellOf(views, metricId,
  targetDate)`). Picking a date never changes the metric.
- **Selection is one market id, never an index.** A (metric, date) pair IS
  a market, so nothing new travels through state; `horizonById` resolves
  it and falls back to the primary when the id is gone, which is what a
  reader sees after the market they were watching settles under them. No
  role enum exists, and no surface reads meaning out of a position. There
  is no flat walk across the grid: a flat walk across a grid reads as
  confusing once there are more than two cells.
- **The caption line and the question are each an `h2` that is a block
  child of `.pubws-center`.** Controls on those lines go INSIDE the heading,
  never in a wrapper around it: a flex row between `.pubws-center` and a
  heading drops it into a narrow column beside the price, four words tall
  and over the leaderboard rail, because the heading's placement comes
  from rules that assume it is a block child of the column.
- **With a proposal selected the SAME sentence carries the condition**
  (owner ask 2026-08-28: modify the question, never add a second line
  under it): "What will be {company}'s {metric} {date} if {who} is paid
  ${ask} to do: {task}?", the "?" at the true end. The world phrase ("is
  paid" / "is not paid") stays the branch toggle inside it, and the
  sentence takes a wider measure (`.pubws-instrument-ask--cond`) instead
  of a taller stack.
- **No per-horizon role caption, and no cross-horizon conflict mark on the
  ballot.** One clock at a time, with a way to the others, is the whole
  rule, on the headline and on a proposal alike.

**Metric names are short handles.** A segment has to fit beside its
siblings and the metric word has to scan inside the sentence, so a floor
metric's name is the noun a reader would say
("LookPilot net revenue (USD)", "Active traders", "Implied valuation
(USD)"): about twenty characters before the unit tail, three of them side
by side in the 660px column. The definition, including the window
("trailing 30 days", "trailing 7 days"), lives in the description, which
the floor prints in "What is this market?", and which is the settlement
text anyway. The window does NOT go in the name: `metricLabelOf` strips the
trailing parenthetical as the unit tail and `currencyOf` reads the currency
out of that same tail, so a window written inside it is deleted from the
caption AND takes the `$` off the price with it. A renamed metric keeps its
id, so no market moves; the LookPilot sync's `COMPUTE` map is keyed by name
and carries the names in use (a rename without a map edit silently stops
the sync).

The question names the prediction: the metric's name, its parenthetical
unit tail trimmed for display, inside the sentence, set in the Fraunces
display face (an exception to the tiny-uppercase-label rule: it is the
page's statement of what the market is). A named clock's settle day is
not printed in the sentence; the date row and the word's tooltip carry
it, and the settle note under the price reads "resolves <settle day>"
(`settleNoteOf`). That division is also what keeps the year boundary
honest: a settle date printed beside a name that carries its own horizon
reads a day late, the 2026 period ending at the instant January 1 begins.

**Every metric is a level, read on three dates.** A metric on a public
floor is a number that exists at every instant (a trailing-30-day total, a
count as of now), never a number that belongs to one calendar period
(revenue "this week", "in September"). The same metric is read today, this
week and this month, and a market on it settles on
`metricValueAsOf(resolvesOn)` with no per-period arithmetic; with one
metric and three dates the definition is written once. The horizons on
every public floor are THREE: `+0d` (today, settling at the coming midnight
UTC), `+0w` (this ISO week) and the next-month market, which is the
absolute `2026-09` every floor metric carries (the Season 1 hero's date; it
does not roll, and rolling it is a decision for when September ends).
There is no fourth clock.

**Which market is THE number, with several metrics.** `primaryMarket` picks
the furthest-resolving open market, and a tie on the settle instant (two
metrics both read at month end) goes to the metric with the LOWER `order`,
then the earlier name. Liquidity never breaks the tie, because that would
let a trade flip the headline. The owner sets the order with
`POST /api/metrics/reorder` (the floor metric first), and the payload
carries `metricOrder` on every market so the client mirror
`primaryHorizonOf` and the metric picker read the same rule. The metric
picker walks metrics in that order, primary first.

**A floor shows ONE horizon as its headline: the furthest-resolving
market.** It is the headline everywhere a single number is shown: the
marketplace card, the share card an unfurled link renders, the floor's
opening view, the definition it quotes, the chart it draws, the market its
ticket trades, and the metric a contractor's impact is denominated in.
Lists still ship soonest-first, so the API contract is unchanged; one
helper, `primaryMarket`, picks the primary server-side and
`primaryHorizonOf` picks the same one client-side, so the surfaces cannot
drift apart. A workspace may have other open baseline markets, and the API
serves them (`GET /api/marketplace/:id` ships every one in `markets`); the
floor offers them one at a time through the pickers, with no second chart
shown at once.

**One model owns what a horizon is** (`src/lib/floor-horizons.ts`). Which
market is primary, its label, its settle day, its unit, its metric history,
its period start and the lookup of its price series all come from there,
and a price series is only ever fetched BY MARKET ID. Surfaces that decide
these from an array position disagree the moment the order changes. The
payload labels its inline price replay with `marketHistoryMarketId` so
nothing has to guess, and a test greps the frontend for a second copy of
any of it.

**A floor with six markets ships six histories.** `horizonHistories` is
not capped; the metric log is read once per distinct metric, not once per
market, so the cost is per metric.

### Every clock on the floor reads in the viewer's zone

Every instant the floor prints is the viewer's local time (Viktor,
2026-09-11: "the time shown has to be local for the viewer"): a minute or
hour cell's label ("12:38", "hour to 13:00"), the settle instant on hover
("11 Sep 2026, 12:38 CEST"), a deadline's hover, "decided 12 Sep", "edited
3 Sep", the chart's axis days and its tooltip, a position's settle day. The
zone is named once, on a hover instant, as its short name; a bare clock
never carries "UTC". Day, week and month cells stay UTC periods (a book
"for 30 Sep" is the UTC day, as docs/guides/sources.md defines it) and keep
their settle day as before; only the rendering of an instant moves. The
public actions log is the exception: it is an audit record and says "Times
are UTC" over its rows.

### Links in prose are links

A URL typed into a proposal's description, the workspace's one-line
description, the owner's "What is <name>?" text or a metric's definition
renders as a link (new tab, no referrer), never as inert text (Viktor,
2026-09-11: "make sure that links in descriptions etc. work"). Trailing
punctuation stays outside the link, so a sentence that ends in an address
does not link the full stop. The stream a workspace runs (the snake on
Twitch) is linked from that prose, in the owner's words.

### A proposal is a decision with a price

**Revised 2026-09-09**, replacing "A proposal keeps the clock line, and says
which world it is". That section held two rules this one reverses for the
proposal view only: that the caption keeps its pickers and its conditional
sentence, and that the big number is never the impact. The decision is the
owner's (direction C of the 2026-09-04 proposal-page canvas, put on beta as
PR 205 and never merged, then re-drawn on 2026-09-09 against the floor as it
now stands). The grounds are in `notes/decisions/ui-conventions.md`.

A proposal is not a variant of the metric view. It is a decision with a
deadline, an ask, and a price, and it reads in that order:

```
  #28  A 500 dollar prize for the best open-source trading agent
  Viktor36 · $500 if approved · decides 15 Sept · 24,857 behind it

  ACTIVE TRADERS   REVENUE   OUTSIDE OWNERS   FORECASTERS
  THIS WEEK        THIS MONTH
  ±0               +1.4

         ACTIVE TRADERS THIS MONTH, APPROVED VERSUS DECLINED
                             +1.4
  LAST READ 9.00 | IF APPROVED · 30 SEP 20.0 | IF DECLINED · 30 SEP 18.6
        If approved, what will Telarchy's active traders be on 30 Sep?
                        [ chart, both worlds ]
        [ BET HIGHER · if approved ]  [ BET LOWER · if approved ]
```

- **The title is the headline**, with its number before it, left-aligned, in
  the display face. Not a conditional sentence: "what will be X's Y this
  month if Z does W" makes a reader parse a number, a proposer, a price and a
  task as one clause before anything is on screen. The four facts of a
  proposal follow as ONE icon row in the market's own facts vocabulary: the
  proposer, the USD ask, the countdown to the decision, and the pool behind
  the pair.
- **The deadline in the facts row counts down under a day** ("decides in
  4h"), red inside the last hour, and **by the second under an hour**
  ("decides in 5:31", then "0:09"), ticking every second, because on a floor
  that decides once a minute a static "<1h" is a lie for its whole life
  (Viktor, 2026-09-11, of the snake floor). Its hover says the proposal
  declines itself at it. The deadline never moves: there is no extend control
  anywhere (docs/market-integrity.md I1b).
- **The ask says what approving does to it**: "$250 if approved", not a
  bare "$250" (2026-09-10, after a review scored this page 3/10 for a
  newcomer: `notes/proposal-page-review-2026-09-10.md`). Three words in the
  row that is already there, rather than a sentence under it. The rule
  behind it: **the mechanism is never explained above the trade** (Viktor,
  2026-09-10, of a line that did explain it: "shouldnt this just be in the
  market rules or something? seems like too much of a detail"); what a
  proposal IS belongs in "How this decides", below.
- **The strips say what it moves.** With a proposal open, the metric strip
  and the date strip stop showing levels and show THIS proposal's impact on
  each cell: `THIS WEEK ±0  THIS MONTH +1.4`. The metric strip prints no
  number in any view (above), so the impacts ride the dates. They carry no
  leading label ("moves", "by"): the strips
  are where they always are, and a word in front of each one captions
  something the reader is already looking at (owner ask 2026-09-09, "i dont
  like the moves and by texts remove those"). A proposal ships a pair for every cell of the grid
  (below), and until now that grid has never been on screen; the strip is
  where it belongs, because it is the product's own claim stated literally.
  The strips keep the floor's order, primary metric first and dates soonest
  first: a strip that reorders itself when a proposal opens moves the tabs
  under the reader's finger. The selected tab is scrolled into view.
- **A pair with no liquidity says "no liquidity" and cannot be pressed**
  (owner ask 2026-09-09, replacing the "untraded" note of the same day:
  "its just useless tag.. especially if theer is a liuqidity present.. if
  liuqidity isnt present.. then just dont make it clickable in the first
  place"). Nothing is staked on that cell, so there is no forecast to print
  and nothing to trade on arrival. Where liquidity IS present the impact
  stands on its own, tagged with nothing.
- **The impact is the number.** The hero is the selected cell's impact,
  if-done minus if-not-done, over a caption that names what it is a
  comparison OF: "<metric> <date>, approved versus declined" (revised
  2026-09-10; "if approved, <metric> <date> moves by" left "+$614" open to
  being read as growth from today, or as profit after the ask is paid),
  green up and red down. This is the reversal: on the metric view
  the big number is the metric's own value, and on a proposal it is the
  impact, because the impact is the only number the ruling turns on and the
  only one the pair actually prices.
- **The two worlds are the control.** Under the hero, three cells on
  hairlines in the stat row's anatomy: now, if approved, if declined, each a
  caption over a value. The branch captions carry the day being forecast and
  not the settle note the metric view uses ("if approved · 30 Sep"): the same
  note on two cells beside each other is said twice and truncates. The two branch cells ARE the branch toggle
  (`aria-pressed`), replacing the pair of pills: the number you are switching
  to is the thing you press. The baseline stays on screen as the first cell,
  which is the whole reason a pair can be read at all.
- **The question sits UNDER the worlds, never above the number.** One
  sentence between the world cells and the chart, in the metric view's own
  serif: "If approved, what will <floor>'s <metric> be on <settle day>?",
  switching to "If declined" with the cells. It names neither the proposer
  nor the task, because the title carries both a few lines above, and it
  comes after the number rather than before it: the conditional sentence
  this restores was removed on 2026-09-09 for putting a company, a metric, a
  date, a proposer and a task in one clause ahead of anything countable, and
  the placement is what fixes that, not the sentence itself.
- **The chart's baseline is "without it", not a second "now".** With a pair
  on screen the unconditional market's line is labelled "$7,049 without it":
  the "now" cell beside it is the last logged READING, and the two were 8%
  apart under one word. The cell says "last read · 4 days ago" for the same
  reason, worded to follow those two words rather than to stand alone
  (`readingWhen`; the stat row's own `readingAge` says "4 days old" and
  "reported today", which read as a second sentence after "last read").
- **The world rides the verb.** "Bet Higher · if approved", on the button,
  never only in a toggle further up the page. A trader who has scrolled past
  the toggle cannot tell which world a verb belongs to, and the ticket in the
  rail names the same world in its header.
- **The words, the rules and the ruling are below the trade**, in the order
  the metric view already uses: question, numbers, chart, verbs, then "What
  <proposer> would do" as the tinted block "How this settles" wears, then
  **"How this decides"** in that same block's shape, then the owner's ruling
  band, then the rest of the ballot. Nothing that is prose or a control
  stands between the title and the number.
- **"How this decides" is where the mechanism lives**, and the only place
  (Viktor, 2026-09-10: "shouldnt this just be in the market rules or
  something? seems like too much of a detail"). Three sentences, generic to
  every proposal so nothing is written per proposal: what approving pays and
  commits; that every number this floor prices gets two markets for this
  proposal and the gap between them is what the market says the work is
  worth; and what the ruling does to them, which is that the world that did
  not happen is voided and refunded AT COST while the other keeps trading
  until the number settles, with an undecided proposal lapsing as a decline
  at its deadline. That is the engine's actual behaviour
  (`voidProposalBranch`, `lapseOverdueProposals`), not a simplification of
  it.

**The deadline is said ONCE, in the facts row under the title** (a clock
glyph and the date, in the accent: "decides 14 Sep"; "decided 12 Sep" after
the ruling). Under a day it counts down instead ("decides in 4h"), red
inside the last hour, and under an hour by the second ("decides in 5:31"),
because a date is no use when the answer is due this afternoon and an hour
is no use when it is due this minute. The same clock, at the same
resolution, on the board row and in the owner's bar. There is no standalone chip above the title and nothing under the
pitch, in the ticket or on the chart. The owner's bar carries three mono
words under its buttons, "declines itself in 4h", and nothing to press: a
deadline does not move. On the board a pending row carries the same clock
and countdown among its facts, red inside the last day; a row nobody ruled
on by its deadline wears a "lapsed" pill in the decided fold, in the quiet
register rather than the decline's red: a lapse is not a verdict. Once the
proposal is closed (decided or lapsed) the ticket and the verbs are gone,
the call cell's caption reads "market's call at the decision", and the
position card says when it settles ("settles 30 Sep") where the Sell button
was. The proposal form asks for a DURATION, not a date, because a date
picker cannot express ten minutes: a row of presets (1h, 6h, 1 day, 3 days,
1 week, custom) with the floor's own default preselected and named as such.
Custom reveals a number and a unit, nothing more.

**What did not change.** The pair still resolves by the cell on screen, so
picking a metric or a date moves the pair with it. The ticket trades the
selected branch: its probability and liquidity come from the active market,
never the baseline, or payouts, the bet ghost and position worth are all
computed against the wrong curve, and positions refetch on every switch
because they belong to the market on screen. The chart draws the branch's
own history, falling back to the market's current call as a single point
when nobody has traded it yet.

**The proposer and the manager edit in place, from a PENCIL.** The control is
an icon on the head of "What <proposer> would do", where the metric
definition's own edit already sits, not a full-width button under the prose
(owner ask 2026-09-09: "make that more like an icon"). Correcting a listing
is a rare act and the ruling below it is not; a control the same size as the
ruling claims to be as important as it. The words save without touching the
market; the price only moves while nobody has traded the pair, and the server
says so plainly when it will not (docs/market-integrity.md, I1b). Same three
fields as posting one, same order.

### A proposal has an address and a card

**A decision is the one thing on this site worth sending to one person**
(2026-09-09). A proposal therefore has a real URL, `/<slug>/p/<number>`, and
its own share card; a metric book has neither, because nobody links "active
traders in September" on its own and the floor's card already carries the
hero number.

- **The address renders the floor, opened on that proposal.** One page and
  one implementation: `/telarchy/p/28` is the floor with #28 selected, and
  the hash form `#proposal=<id|number>` keeps working and redirects to it,
  because it is in notifications already sent. Selecting a proposal on the
  floor replaces the address with the `/p/` form, and deselecting restores
  the floor's own. **Both spellings of the path are in play and they are not
  the same string**: the router's is basename-relative and says whether this
  is the floor's own address, the address bar's carries the base, and writing
  the router's into `replaceState` walks a /beta reader onto the production
  build (`internal-links-ownership.test.ts` fails the suite on it now).
- **An address that names no proposal says so.** `/telarchy/p/999` on a
  floor with no #999 renders the floor in its plain market view with one
  quiet line under the strips, "No proposal #999 on this floor.", and the
  address bar back on the floor's own path (2026-09-10; it used to render
  the floor silently, so a stale or mistyped link looked like the proposal
  had simply never existed to be found). The line is the only thing that
  changes: nothing else on the page is about a proposal that is not there.
- **The card is the decision.** Server-rendered from the same payload the
  floor reads, so it cannot drift: the floor's name, the proposal's title,
  the impact on the hero metric with its unit, the number it moves, the pool
  behind it, and the day it is decided. The workspace card already works this
  way and lends it its anatomy.
- **The title says the decision and the price**: "Should <floor> pay for
  <task>? The market says <impact> <metric>", with the description naming the
  deadline. Every page on the site otherwise shares one og:title and one logo
  image, which is why a proposal cannot currently be sent to the person who
  knows how to price it.
- **A proposal with options says which option leads**: "Should <floor>
  <verb>: <title>? The market says <leader label> leads by <lead> <metric>."
  (the leader's lead over the next best, with the metric's unit), "The
  market has the options tied." when two or more share the top price,
  "Nobody has priced it yet." while fewer than two options are priced, and once
  decided "<floor> chose <label> on #<number>: <title>". The description
  says "<ask> to the proposer if chosen." and "bet on which option lands
  higher" where a pair says "which world".


### A proposal with options shows one world per option

A proposal may carry options instead of the approve/decline pair
(`docs/guides/proposals.md`, "More than two options"). The page is the
same page; only the parts that said "two" change, and they change by
counting:

- **The worlds are the options.** The control under the hero is the "last
  read" cell followed by ONE cell per option, in the proposer's order, each
  captioned with the option's label ("Turn left", not "if turn left") over
  its price; the leader's cell wears the green the approved cell wears
  today ("· leads" after its label), the others are plain, and the selected
  cell is underlined in the same green its chart line wears. Every priced cell is a button
  (`aria-pressed`) that puts that option on the chart and the ticket; an
  unpriced one says "no liquidity" and cannot be pressed, as any pair does.
  Up to six options fit one row on the desktop floor; on a phone the row
  wraps to two cells per line, the last-read cell first. There is no
  declined cell, because there is no declined world.
- **The hero is the lead.** The big number is the leader's consensus minus
  the best other option, over the caption "<metric> <date>, <leader label>
  over the next best". Fewer than two priced options: the hero prints
  "no lead yet" in the place of the number over the caption "<metric>
  <date>, the leader over the next best", and the strips print "open" for
  that cell. **A tie at the top is not a lead**: the hero prints "±0" over
  "<metric> <date>, tied at the top", no cell reads "· leads" or wears the
  leader's green, and the board row prints "tied" where it prints
  "<leader> +lead". The page opens on the leader's world, else the first
  priced option's, else the first option's.
- **The question names the option**: "With <label>, what will <floor>'s
  <metric> be on <settle day>?", switching with the selected cell. "With",
  not "If": a label is a noun phrase the proposer wrote ("Turn left",
  "Headline B"), and "if Turn left" is not a sentence.
- **The chart draws every option.** One line per option, the selected
  one in the approved world's green and full weight, the others thinner in the muted ink,
  each labelled with its option's name at its right end where the pair
  chart prints its two prices. No baseline "without it" line: with options
  there is no world without the proposal to compare against, and the
  "last read" cell already carries the metric's current value (Viktor,
  2026-09-11: "in the graph show all options not just the one selected
  and without it.. whatever that means").
- **The world rides the verb**: "Bet Higher · Turn left". The ticket's
  header names the same option.
- **The decision bar has one button per option**, each reading "Choose
  <label>", the leader's first and in the approve green, then Decline as
  today; with no leader no button is green. Pressing one is the approve
  with that option; nothing asks twice. The ask in the facts row reads
  "$250 if chosen". A tie at the top has no leader, so no Choose button is
  green and they keep the proposer's order.
- **The board row prints the leader's lead** where a pair prints approved
  minus declined, prefixed with the leader's label in the mono caption
  register ("Turn left +0.4"); "open" until two options are priced. The
  ruling band reads "Chose <label>" in the approved pill's colours. A
  manager's row reads "Choose" where it reads "Approve", and opens the same
  confirm band with one "Choose <label>" per option.
- **An option row names its options instead of Higher and Lower.** In
  their place the row carries one chip per option, in the proposer's
  order, each its label and its own value on the cell on screen, the
  option book's consensus as the metric prints it ("Turn left 3.5",
  "Turn right 3.2", "Continue 3.1"), never a difference between options.
  An unpriced option's chip reads "open". The leader's chip wears the
  green; a tie at the top has no leader, so none does. Pressing a chip
  opens that proposal with that option's world selected, the same as
  pressing its cell on the proposal's own page (Viktor, 2026-09-11: "lets
  just shwo the different options and their impacts instead of the higher
  /lower", "wehn clicked it goes to that proposal witht he correspodnign
  branch open", then "it hshould show just the absolvute value isntead not
  some subtract result"). A two-branch row keeps Higher and Lower.
- **A decided proposal with options** strikes through the price of every
  option cell but the chosen one, captioned "stakes refunded", and the
  ruling says which option was chosen.
- **Posting one**: the creation form has an "Options" row under the pitch,
  closed by default (a two-branch proposal is the default and stays the
  default). Opened, it holds two label fields and an "add option" control
  up to six; a label empties an option, and fewer than two filled labels
  post a two-branch proposal. Ids are the labels lowercased and hyphenated,
  deduplicated with a number.

### A proposal ships every pair of the grid, and the board reads the pair on screen

A proposal's `markets` carries EVERY pair the engine spawned for it, one
per baseline market of the grid (metrics x dates is small by construction;
`marketPairCount` stays equal to `markets.length` and is kept for readers
that predate this). The board, the ticket and the chart all pick a
proposal's pair by (metric, date) of the horizon on screen, never by date
alone and never by position; only a payload with no `metricId` on its pairs
(older builds) falls back to date-only matching. The number the board
prints is therefore, by construction, the approved consensus minus the
declined consensus of the two markets the chart draws when that proposal
is opened, and when that pair is unpriced the board prints "open", exactly
as the ticket says "impact not yet priced": the largest-delta fallback
exists only for the moment before the markets arrive and no horizon is
known, never for an unpriced pair, because a borrowed number under the
wrong caption is the mismatch this section exists to prevent. The suite seeds a two-metric, three-date grid with six pairs per
proposal and asserts (a) the payload ships all six, (b) the board's
printed impact equals approved minus declined of the pair for the metric
AND date on screen, and (c) that pair is the one the ticket trades.

### A market on a number that does not exist yet resolves N/A

**The rule.** A metric can declare `resolvesNaUntilMeasured` (POST/PUT
`/api/metrics`). While such a metric has NO logged reading at or before a
market's resolution instant, that market does not settle on a number: it is
VOIDED, every position refunded, with the reason published on the void. The
first reading ends the state for good: from then on the metric is a level
like any other and every later market settles on the value as of its
instant. The metric's `value` column plays no part (a never-measured metric
carries the default 0, and settling "no investment" as "$0 valuation" is
the wrong answer the flag exists to prevent). Without the flag nothing
changes: a market with no reading before its boundary falls back to the
live value.

A void and not a special resolution value, because N/A is what the market
IS when its question has no answer, and the engine has exactly one honest
shape for that (refund everyone, publish why). A "resolved at 0" would pay
the LOWER side for an event that did not happen; a synthetic sentinel would
need every surface that reads `actualValue` to know about it.

**What the floor says.** Under the price, the settle note reads "resolves
30 September 2026, or N/A (all bets refunded) if there is still no reading"
for a flagged metric that has no reading yet; once a reading exists the
note is the plain "resolves ..." again. The flag travels on
`horizonHistories` as `resolvesNaUntilMeasured` beside `resetsEvery`, and
`measured` says whether a reading exists, so the page never infers either
from the points array (a resetting metric ships an empty array inside a
fresh period, which is not "unmeasured").

The metrics that use the flag ("Implied valuation (USD)" on both public
floors) are defined in docs/metrics.md.

### The price and the chart

**One chart is the hero: the number's own, with the market's call drawn on
it.** A newcomer reads the floor top to bottom: what the number is, what it
reads now, what the market says it will read, then the picture of both on
one axis. Everything in this section serves that order (decision record:
`notes/decisions/ui-conventions.md`, 2026-09-03).

**Nothing about settlement stands between the question and the number**
(revised 2026-09-09). The summary line under the question is gone, and with
it the last way the definition could print twice: the rule the market settles
on is one block UNDER the trade, "How this settles"
(`.pubws-settles`, a tinted `--bg-secondary` panel with the section's tiny
uppercase label), carrying the metric's full definition and the settle
instant in one paragraph. A reader meets the question, the two numbers, the
chart and the two verbs first, and reads the rule when they want to check it,
which is the order every venue that prices a number uses. A metric with no
definition prints the settle sentence alone. The know block keeps the
manager's Edit control on that same text.

**The stat row** (`.pubws-stats`) is two named numbers in ONE row, two
cells on hairlines the way the home board draws its cells (revised
2026-09-04): a 1px `var(--border-color)` rule above and below the row and
one between the cells, each cell (`.pubws-stat-block`) a mono small-caps
caption line first ("NOW · READ 35M AGO", "MARKET'S CALL · FOR 30 SEP",
`.pubws-stat-what`) and the value under it at the price size
(`.pubws-price`, mono, tabular, 2.1rem), the reading left-aligned in its
cell and the call left-aligned in its own, so the two numbers start on
the same vertical rhythm.

- The reading (`.pubws-stat--now`, ink): the value in force, "now", then
  "read 25m ago" (`.pubws-updated`, `timeAgoOf` from the latest reading's
  instant, the exact instant as its hover title), because a reading is
  only trustworthy with its age on it. A metric with no reading yet prints
  "no reading yet" in the value's place and no age. **On a snake floor the
  caption names the attempt** (2026-09-11): "NOW · ATTEMPT 41 · READ 5S
  AGO", the attempt being `game.deaths + 1` from the live feed's latest
  poll, so the reading is read as "this attempt's length", which is what
  resets to 1 when the snake dies. Before the first poll (or on a floor
  with no feed) the caption is the one every floor prints.
- The market's call (`.pubws-stat--call`, amber): the consensus, "market's
  call", then "for 30 Sep · settles in 27d" (`.pubws-settle-in`: the day
  being forecast, which is the day before the settle instant, exactly as
  the date strip names it, and the countdown ticking by the minute, the
  exact instant on hover; "settling" once it is). A selected proposal's
  impact chip sits beside the value as the bare arrow and delta
  ("▲ +7.8"), because the impact is the proposal's one number.
- **The call carries its own move** (2026-09-09), on the plain market view
  where no proposal impact occupies that slot: the same chip anatomy
  (`.pubws-delta-chip`, green up, red down) reading the change since the
  last point at least 24 hours old in `marketHistory`, "▲ +0.4", with
  "since yesterday" as its hover title. A returning trader's first question
  is what moved while they were away, and a bare consensus cannot answer it.
  A market with no point that old, or one that has not moved, prints no chip
  rather than a grey zero; a selected proposal's impact wins the slot,
  because the proposal is what that view is about.

The price carries the metric's currency symbol when the trimmed
parenthetical tail names one (e.g. "USD" -> "$"; the same prefix runs
through every numeral in the charts). A market with no price yet (no
liquidity) keeps the pickers, prints a centred "no price yet" where the
stat row would be and the no-liquidity note where the bets would be, and
draws no charts: the pickers are how a reader leaves it for a market that
has one.

**The number chart is the hero** (`NumberChart`, `.pubws-numchart`),
directly under the stat row at the wide geometry (`GEOM`): the metric's
readings, the "now" rule, and on the future side every open market of
this metric as a marker at its settle instant carrying its call, the
selected one amber and labeled. Its control row keeps the metric's own
name centred (`.pubws-chart-cap`, `captionLabel`, the leading company
name stripped) and its range chips on the right; the left cell is empty,
the stats are above. **A legend under the plot names the marks** in a few
words each (`.nchart-legend`): the ink line "actual", the amber dot
"market's call for 30 Sep", and the grey dots "other open dates" only
when there are any; with a proposal open the proposal's legend replaces
it. The market chart and the number chart used to stack at equal size
with a stat each and no words joining them; a Manifold trader read the
$6k on the bottom one as a lifetime total and bet against a company he
thought had just started.

**There is ONE chart, and how the call moved is a mode of it** (revised
2026-09-09, replacing the second chart stacked below). The chart's control
row carries a two-way toggle in its left cell, the one the stat row emptied
when it moved above the plot, VALUE and CALL:
Value draws the number chart described above, Call draws the market's own
history (`MarketChart`) in the same slot at the same height, captioned by
the same caption, with its own ranges (`1D 1W ALL`). Nothing is lost and
the reader chooses which question they are asking. Two charts stacked cost
340px of the first screen and pushed the two bet verbs to 1035px on a
1000px viewport, below the fold, which is the one thing a trading page may
not do. The composed bet's ghost draws in whichever mode is on screen
(`preview` on both components, one value from the ticket), and the mode is
remembered for the session, not the page load. **A sale casts the same
ghost** (owner ask 2026-09-10: "when selling it should also be shown on the
graph where will it be moved.. just like when buying"): with the sell panel
open, the chart shows where the market's call lands if those shares are
sold, moving with the size slider and clearing with Cancel, in the sold
side's own colour, because selling Higher moves the call the way buying
Lower does and the reader should see that before they press.

**The chart's footer is where the counts live** (revised 2026-09-09,
moving them up from the tab row): one quiet row under the plot, the way
every exchange labels a chart. The range chips stay in the chart's own
control row above the plot, where they have always been. Two of the three counts take a word, because a bare number cannot
say what it counts: "42k pool · 30k volume", mono and quiet
(`.pubws-chartfoot`). The trader count keeps its icon and drops its label,
since a number beside a person already reads as people. The full sentence
stays as each item's hover title. This is the only place the counts appear;
the facts row under the bet verbs keeps the owner's Inject and Buy controls
and nothing else.

**When a market settles is said once, beside the call.** The date
picker names each market by its clock and settle day (`TODAY · 26 AUG`,
`THIS WEEK · 30 AUG`, `30 SEP`), the question line by its clock alone
("today", "this week", "on 30 Sep", the exact settle instant as the
word's hover title), and the countdown rides the call's date line, whether
or not the metric has readings, so the settle clock never leaves the page.
That countdown carries the distance ALONE: the exact instant is its
hover title, in the same words the rest of the floor uses for one, and
never a second line of type. A metric with no reading yet keeps its
number chart too, in the component's own "no reading yet" state with the
market's marker (hiding it read as the graph collapsing, owner report
2026-08-28). Neither the segments nor the question repeat the timer. The
one thing that still prints under the stat row is the N/A caveat of a
metric with no reading yet ("N/A, all bets refunded, if there is still no
reading by then"), because it changes what a bet is.

- **The market chart** is the prediction (`MarketChart`, the chart's CALL
  mode): one amber step line of the market's call over its lifetime,
  gradient fill, labeled end dot, crosshair. The series STARTS at the price the market opened at,
  stamped with its creation time, because a pair that opens anchored and
  has traded once is otherwise a single point, which draws as a flat line
  and a cliff at the live dot and reads as if every trade happened at once.
  Its range chips are `1D 1W ALL`; a range longer than the market's life is
  not offered.
- **The number chart** (`NumberChart`) is the metric's own trajectory: its
  readings as an ink step line up to a "now" rule, and, on the future side,
  every open market of this metric as a marker at its settle instant
  carrying that market's current call. Readings are joined by straight
  segments with a dot at each reading and a dashed hold from the last one
  to now (the value in force); a step line read as a staircase. **The
  vertical axis never magnifies a wobble into a cliff**: it spans at least a
  tenth of the largest value drawn (readings, markers and the pair), so a
  reading that moved a third of a percent draws as a small step and only a
  real move fills the plot; three readings within an hour used to draw as a
  full-height wall at the now rule. **It is about the market on
  screen**: the selected market's marker is amber and labeled; the others
  are grey, carry their call in the quiet register, and one that falls
  outside the window is simply not drawn. **Every marker is the date
  control** (2026-09-09): pressing one selects that market, which is the
  same act as pressing its tab in the date strip, and the two controls stay
  in step because they are one selection. A marker is a `button` with the
  date and its call as its accessible name, grows a ring on hover and
  focus, and names the date it would switch to in a tooltip; the selected
  one is not pressable, because it is where you already are. A reader who
  can see four dots priced differently and cannot press them is being shown
  a control that is not one. Hovering snaps to the nearest reading on the past side (the dot sits on
  a real point of the line, the tooltip names that reading and its date), and the nearest market's call on the future side,
  in the same crosshair and tooltip the market view uses. **The window follows the selected
  horizon** rather than stretching to show every marker: roughly two days
  for a day market, a week for a week market, a month for anything further,
  always ending at the selected settle instant; the range chips
  (`2D 1W ALL`, `1W 1M ALL`, `1M 3M ALL` by granularity) override it.
  **Switching dates tweens the axis and the line** over about 400ms,
  ease-out, rather than snapping, so a reader sees where the window went.
  **With a proposal open, every marker in the window grows the proposal's
  pair on that market**: a green dot for the metric if the proposal is
  approved, a red dot if it is declined, joined by a bar whose length is
  the priced impact, while the amber dot stays the market without the
  proposal. Only the selected date is labeled (both values and the impact);
  the others show the pair small and grey. Labels never collide: the dots
  stay where the values are, the labels keep a minimum gap and stay inside
  the plot, and a label that had to move gets a hairline leader to its dot. A one-line legend under the
  chart says it in the proposal's words ("if Jason is paid $80" / "if not"
  / "the market now"). Whichever branch the markets price higher sits on
  top. The impact is stated from the world on screen, on the chart and in
  the chip beside the price alike: "+7.8" with "if approved" selected is
  "-7.8" with "if declined" selected, because the number answers "what does
  this world do to the metric compared with the other one". The number
  view honours the actual-vs-forecast rule below: a resetting
  metric shows only its own period. It animates as the market view does:
  the readings line draws itself with the same keyframes and timing, and
  the dots, markers and hold appear after it (none of it under reduced
  motion). **A metric with no reading yet draws no line and no zero**: the
  past side says "no reading yet", the hover says the same, the future side
  still shows the markets' calls, and the N/A caveat under the price says
  what a bet on it is. A metric's creation is not a reading: a metric
  declared `resolvesNaUntilMeasured` logs nothing until its first real
  value, which is what lets its markets void rather than settle on 0.

The chart breaks out of the column to min(92vw, 760px), capped so the whole
anonymous poster through the CTA fits a 900px-tall desktop viewport; phones
get a taller, narrower canvas chosen at mount. On the three-column floor
(>=1120px) it stops breaking out (100% of the center column).

**A metric's history is its definition's history.** When a metric is
redefined in place (a count becomes a percentage, a month-to-date total
becomes a trailing level), the readings logged under the old definition are
removed and the new definition's series is rebuilt from its source (the
sync's daily caches for revenue, the evidence series for reviews, the trades
table for active traders), so the number view never draws two definitions
as one line. The rebuild is a record in `notes/decisions/ui-conventions.md`.

### The actual-vs-forecast chart

**A resetting metric's chart shows only the period it is measuring.** The
metric declares it (`resetsEvery`: null, or hour/day/week/month/year), and
when set, only readings taken inside a market's own target period are that
market's actual-so-far: a reading of "revenue this week" is about the week
it was taken in, so last week's total is not this week's actual. A period
that has just begun therefore draws no actual line at all, an empty axis
with the market's call on the right and a crosshair that says "no reading
yet", which is the truth, where last period's total would be a
fabrication. Undeclared (the default), every reading is one trajectory and
nothing is dropped: that is what a metric accumulating all year is, and
filtering it by its market's period is a mistake.

**The x-axis is the period being settled on.** It opens at the first
moment of that period, or at the first reading when that is earlier, and
closes at the settle date. So a week-long market draws Monday to Sunday
even when only the last two days have readings, while a metric that
accumulates all year keeps its January start under a market targeting
2026-12. The bound is on the AXIS, never on the points. Tick labels follow
the length of the domain, days under about six weeks and months above it,
because "Aug" printed three times is not an axis. The API sends
`periodStart` per horizon so the two surfaces cannot disagree about where a
period begins.

**Event markers.** The chart takes an optional `marker` (`{ at, label }`):
one dashed vertical hairline at a moment, with a small uppercase label at
the top, answering the question a year-long trajectory raises, which is
what changed and when. A marker draws only when its moment falls inside the
drawn domain, so a chart of a period that predates the event simply does
not mention it (a weekly horizon does not carry an August marker in
October); it is `--text-tertiary` and dashed, not accent, because it is
context and the data still leads; and its label flips to whichever side of
the line has room, the same `edgeLabel` rule the settle-value label uses.
One marker, not a list: a chart with several annotations is an infographic,
and the floor's charts are instruments.

### Two tiers: poster and desk

The page is two-tier by intent: the anonymous view is a poster free of
explanatory context (no hook sentence, no settle fineprint, no captions)
with exactly one action under the chart: the trade ticket itself, in demo
mode. A newcomer composes a real bet (side, amount, payout line, the
impact ghost on the chart all work), and only the confirm differs: it
reads "Sign up to bet" and routes to /signup. The ticket is the pitch;
signing up IS the intent signal, and the signed-in view becomes the
trader's desk. The desk adds, around the trade ticket only, live position
worth on each held row ("worth 31.2 cr +6.2", green/red delta from the AMM
sell preview, the delta hidden while it is still zero) and the trader's
resting limit orders. The wallet balance lives in the account menu, not
under the ticket.

**An unfunded market never shows bet buttons.** A branch market can exist
with no liquidity, in which case it has no price and the server refuses
every trade against it. The floor borrows the baseline's call to DRAW such
a branch (a blank chart is worse than an honest prior), but that borrowed
number must not decide whether the page offers a bet: `funded` is carried
separately from it, and an unfunded market replaces the two bet verbs with
one line saying nobody has funded a market for this proposal yet.
Composing a bet and meeting "this market has no liquidity" at submit is
the bug this rule exists to prevent.

### The ticket

**The ticket opens INLINE under the bet verbs** (owner ask 2026-08-28,
replacing the modal of 2026-08-10): pressing "Bet Higher" or "Bet Lower"
grows the ticket in the page's flow (`.pubws-ticket-inline`, a chromeless
wrapper: the ticket's OWN card is the one card, at the column's full
width, after Manifold's bet panel - a card inside a card is the shipped
mistake this sentence exists to prevent), so the charts above stay on
screen while the bet is composed and
the composed bet's ghost draws on both charts.

**Buy and Sell are two tabs of the one ticket** (owner ask 2026-09-09, after
Kalshi: "could sell be possible from there as well?"). Buy composes a bet;
Sell holds the held-position rows and the resting orders, so closing a
position never means finding another surface. Buy is the open tab, and
managing a held position opens the same inline ticket on Sell. A Sell tab
with nothing to sell says so in one line rather than vanishing: a tab that
disappears when it is empty reads as a missing feature.

**The card carries ONE rule of chrome, and the rail is 293px wide** (owner
report 2026-09-09, of a card that had four: the tabs, the sides, the order
type and a close). The tab row is the FIRST thing in the card and it is a
rule: Buy and Sell as underlined tabs on the left, the order type (Quick /
Limit) at its right end, a hairline under the whole width. Everything else
follows below it. The order type is a BUY control and is not drawn while
selling, and a tab's own content never renders above the tabs that select
it: both are the card describing a state it is not in.

**There is no close control.** The ticket is the rail, always on screen, so
the × closed a card the page drew again in the same frame; all it really did
was drop the composed bet's ghost. A control that appears to undo something
it cannot undo is worse than no control.

**The two sides are one 50/50 row at the card's full width.** They were
auto-width and centred, which at 293px left the card visibly lopsided and
pushed the order type onto a line of its own. **Hiding those rows
on the Buy tab never means withholding the position from the ticket**: the "New value" preview NETS against it, because buying the
opposite side closes the held position on the server first and the buy
prices against the post-close book. Handing the bet ticket an empty
positions list to hide the rows made it quote a landing the trade never
reached (owner report 2026-08-30), so the rows are gated on manage mode
and the data flows in both. Pressing the other verb re-seeds the ticket's side rather than
being a dead click; its close control collapses it and drops the ghost.

The ticket (`TradeTicket`) follows Manifold's bet-panel layout: a card
(`--bg-secondary`, 14px radius) with the Lower/Higher pills top left and a
Quick/Limit toggle top right. It is the one card on the poster, and
exactly ONE element in it carries a fill, the confirm, which is what makes
that button unmistakably the action. **The ticket opens COMPOSED** (owner
ask 2026-09-09, replacing the progressive disclosure of 2026-08-28): the
side that was pressed is already chosen, the stake reads 0 cr with the
slider at its left end, and the confirm already states the instruction
("Bet 0 cr on Higher"), so the first act is dragging a stake rather than
answering a question the reader answered by pressing a verb. A side pill
never toggles OFF: pressing the chosen side again leaves it chosen, because
a composer that collapses under the reader's finger reads as a broken
button.

**An untouched ticket still quotes both sides**, and so does the floor that
has not opened one. Each side pill carries what a credit spent on that side
can come back as, and so does each of the floor's two bet verbs, which are
the untouched state on a market page: the ticket only exists once a verb has
been pressed and it opens with a side already chosen, so quoting inside it
alone would still make a visitor commit to a direction to learn anything.
**Nothing under the verbs explains what a share pays** (owner ask
2026-09-09, removing the short line of 2026-08-31): the ticket's own payoff
line prices the actual bet in credits, and a rule of arithmetic under the
verbs is read by nobody who is not already composing one. Lower/Higher are two
words, not boxes; state is carried by colour and a fill on the chosen one,
with the floor's ▲/▼ glyph keeping its --higher/--lower colour even while
the word is quiet, since direction is the fastest thing on the page to read.

**The quote is how much is on the table** (owner, 2026-08-31). Each side
says the most that can ever be won on it from where the market stands, in
credits: "up to 700 cr". There IS such a ceiling and it is exact,
`b * ln(1/p)`, the market's liquidity times the log of one over that side's
price. Buying pushes the price toward the range's edge, so each further
share costs more than the last and the cost catches the payout: the profit
converges on that figure instead of growing with the stake. On a 30c side
with `b = 575`, 73 credits can make 144 and 5,000 credits can make 700,
which is the ceiling; the next five thousand make nothing.

It is quoted as "up to" and never bare, because it is reached only if the
number settles at the range's own edge. It is null, and the line is absent,
where there is nothing to state: an unfunded market has no price either and
refuses trades.

This is the number both untouched surfaces carry because it is the only one
on the page that answers what a trader asks first, which is whether there is
anything here worth their time. A price in cents, and the multiple it
implies, are near-identical across every live market; the depth is not, and
"up to 12 cr" sends somebody away in one glance where "up to 3.4x" never
would. It also says which side the market maker is exposed on: 700 credits
behind Higher and 42 behind Lower is a description of where the cheap
opportunity is. The wording lives in `maxWinLabel` in
`src/lib/market-quote.ts`, which the pills and the floor's verbs both call,
so the two can never drift apart. What it replaced, the cents price, was
itself the fix for a trader who could not price a trade without pressing a
button first (`notes/quroe-churn-2026-08-27.md`); once a side is picked the
payoff line prices his actual bet in credits, so nothing is lost by quoting
depth rather than price before the click.

**The stake, its slider and the slider's ends are ONE group** (owner ask
2026-09-09, of a card whose 26px stake numeral sat alone in a 46px band):
the line, the track directly under it, and under that the two ends the track
actually moves between, in CREDITS ("1 cr", "500 cr, all you have").
Labelling the ends is what stops the slider being read as the metric's
range; the card carried two identical 10px tracks stacked, one measuring
credits and one measuring the metric, and nothing said which was which.

**No picture until there is a stake.** At 0 cr the payoff line is not drawn:
the plain range bar it used to fall back to was the second of those two
tracks, and there is nothing to picture before a bet exists. The line
appears the moment a stake does, under the slider, where its own two rows of
type make it plainly a different object.

**A side pill's ceiling is one line.** Quoted compactly ("up to 25.8k cr")
so a pill is one line of type: at the rail's 293px the exact figure wrapped
and left the pills 78px tall for two words. The floor's verbs, which have
the room, keep the exact figure; both come from `maxWinLabel`, so the
wording cannot drift.

The amount is one bare underlined mono numeral (no boxed field, no stepper
chips, no presets) with a slider under it, its fill in the chosen side's
colour. The slider spans 1 cr to the trader's whole balance on a LOGARITHMIC track (a linear 0-to-balance slider
crams every bet a sane trader would place into the leftmost pixels once
the balance is in the thousands), so equal drag multiplies the stake
rather than adds to it; 1..100 cr gets about as much track as
100..10,000. Dragging snaps to two significant digits (150, 1,900) so the
numeral reads as a chosen stake, not a decoded pixel (1,943); the two
ends stay exact, 1 cr and the full balance. The mapping lives in
`src/lib/bet-slider.ts` and nowhere else.

**The stake is typed to a millionth of a credit** (Viktor, 2026-09-11:
"betting decimal amounts of credits up to 1000000th of a credit for now").
The numeral keeps a decimal point and up to six places, nothing in the
ticket rounds a typed stake to a whole credit, the confirm names it as
typed ("Bet 0.25 cr on Higher"), and the ceiling is the balance itself,
never the balance rounded down. A budget typed as a target's cost carries
its decimals too. The slider keeps its ends and its whole-credit snapping:
a stake under 1 cr is typed, not dragged. The server already keeps credits
to a nanocredit (docs/guides/creating.md); the sixth decimal is the
ticket's precision, and the field takes no seventh.

The balance is the only ceiling, and the track ends there. Nothing else may
limit a stake: a screen that offers a size the server refuses reads as a
broken product rather than as a rule, so a size the ticket can reach is a size
the trade route accepts.

The win is a picture, not a table. Payout is linear in the settled value,
so what a bet is worth is a straight line, and the honest way to state a
line is to price points on it: the payoff line's scale gives five, the two
ends of the range and the quarters, each with the credits the bet wins or
loses if the number settles there. The confirm is full width, tinted by
the side, and always states what it will do ("Bet 25 cr on Higher");
success flashes "Placed" on the button itself; errors render inside the
ticket.

**A held position states itself in the same fact rows the Buy tab uses**
(owner report 2026-09-09: "i dont understand the sell visualization at
all"). The direction and the share count on one line, then "You paid" and
"Worth now" with the change beside the worth, then the Sell control. **The
Sell tab draws no settlement payoff line**: it priced a bet nobody is
placing, its four credit stops did not fit 293px (two of them overlapped by
11px), and nothing said they were the position's worth rather than a bet's.
**What the sell panel pictures instead is the sale**: at the size on the
slider, what you GET and what that is against what those shares cost you
("You get 427 cr", "Profit / loss -466 cr", green up and red down), so
dragging the size shows the trade being made rather than a settlement that
is no longer yours. The cost side is pro rata: selling half a position
compares against half of what it cost. **The sell confirm is INK and the
size slider is neutral**, never a direction's colour: selling is not a
direction, a green button closing a Lower position says the opposite of what
it does, and a full-width red track at 100% reads as an error bar rather
than a size.

Limit mode swaps the composer's right half from the landing value to the
price itself, in the same underlined register, and the confirm becomes the
whole instruction ("Buy Higher with 25 cr under $65,000"), with breakeven
exactly at the limit; limit orders are a mode of the same ticket, never a
second panel. Spec: docs/limit-orders.md.

**The payoff line is one rule with two rows of type, and nothing else**
(owner, 2026-09-01: "i want the visualization line to only show on top the
credit gains/losses and on bottom the different values it settles at thats
it"). Above the rule, what the bet is worth at each stop, in credits. Below
it, the value the number would have to settle at. The rule itself changes
colour where the bet starts paying, so the break-even is a boundary you see
rather than a label to read, and it is also the stop that reads "0 cr".

**The green side of the rule is the side the bet actually wins on**, which
for a Higher bet is above the break-even and for a Lower bet is below it.
Green is where the credits above the rule read `+`, red where they read `-`,
in every case: a rule whose colours contradict its own numbers is worse than
no colour at all. Colour comes from which side of the break-even a segment
covers, never from the order the segments are drawn in (owner report,
2026-09-01: a Lower bet painted its winning low end red and its losing high
end green).

**Both ends of the range are always stops.** They carry the two numbers that
decide whether a bet is worth making at all: the whole stake gone at one end
and the most it can pay at the other. The break-even is always a stop too.
What this replaced chose its stops at the quarters of the range and dropped
any that came near the break-even; a bet breaking even at 86% of its range
therefore lost the top stop, and every credit figure on the ticket read as a
loss, never showing the bet could win anything (owner report, 2026-09-01).

**The interior stops sit at fixed thirds and never move.** An interior stop
is either at its third or not drawn at all, dropped only when the break-even
stands within a label's width of it, so the only label that ever travels is
the break-even's, which really is moving. Spacing them off the break-even
instead meant every drag of the stake slider slid every label sideways
(owner, 2026-09-01: "the numbers are kind of twitching when i move the
slider"). A figure that rounds to nothing reads `0 cr` and never `-0 cr`:
the break-even's worth is zero by construction but the float lands a hair
either side of it, and the stop flickered between the two.

**Hovering the line reads out the exact figure under the pointer**, into the
same two rows the stops use, so it adds no height. The standing labels give
up the row entirely while it is there, rather than dimming: the cursor lands
on one of them as often as not, and two labels in the same pixels read as
neither. It says what its numbers MEAN rather than only what they are ("you
lose 43 cr" over "if it settles at 67.9"), because a bare credit figure and
a bare value are two facts the reader has to join up themselves; at the
crossing it says "you break even". A line with no width on screen reads out
nothing rather than dividing by it.

**Every value on the line carries the same decimals.** The whole row shares
one divisor, taken from its largest value, and one decimal count: one if any
value needs one, none if none does. A row reading "0, 33.3, 66.7, 84, 100"
makes the value that happens to land on a whole number look like a different
kind of number (owner, 2026-09-01).

A stop at either end pins to the card so no label hangs off it, and a stop
near an edge leans away from that edge instead of straddling the pinned
label beside it.

**The stake and the value it buys are ONE LINE over the slider, and a trader
can type into either half** (owner, 2026-09-01: "X cr -> {X} value above the
slider where the user can edit both the input fields"). Typing a stake
spends a budget; typing a value bets to it, and the stake becomes the cost
of getting there, placed as the server's `{targetValue, maxBudget}` mode.
Same register as the single numeral it replaces: mono, underlined, no box,
no stepper chips. The arrow between them is what makes the pair read as one
instruction rather than two fields.

An untouched ticket has no bet to price, so it draws nothing at all: the
plain range bar it used to keep was the second of the card's two tracks and
is gone with it (2026-09-09). A held position is priced by the SALE it
would make, on the Sell tab, in proceeds and profit or loss against what
those shares cost, rather than by a settlement line for a bet nobody is
placing.

**A resting order names its LIMIT in that same line**, because it moves
nothing until it fills and so causes no landing to name. The right half is
the price input itself, in the same underlined register, with one line under
the slider saying what the pair means ("buy when the market falls under
it"); limit mode has no second price row of its own. Its rule prices the
FILL rather than a walk it never takes: the whole stake gone at the far end
of the range, a credit a share at the near one, and the colour change
exactly at the limit, which is the whole appeal of naming your own price. A
limit the market has already passed fills at once rather than resting, so
the ticket says so and draws nothing.

One degradation. A market with no range has no landing value, no break-even
and no payout to state, so the ticket falls back to a stake and a confirm
rather than inventing any of them.

**The value half of that line is an INPUT.** The numeral that answers "where
does my bet leave the market" also accepts the answer as the question.
Focus it, type a target, and the ticket sets the side (auto-flipping across
the current call) and the amount to whatever reaches that value, capped at
the trader's balance; blur returns the row to the derived display. The
dotted underline is the affordance.

**The value the ticket shows is the value the trade lands on.** Two rules
keep the promise. (1) Every buy preview replays the netting close first:
the ticket's math starts from the post-close book whenever the trader holds
the opposite side, because that is the book the server prices the buy
against (`src/lib/amm.ts`, pinned against the real server functions by
`src/lib/__tests__/amm-parity.test.ts`). The bet ceiling likewise counts
the close's proceeds, since the server lets a flip spend them. (2) A typed
target is placed as the server's `{targetValue, maxBudget}` mode, which
lands ON the target (budget permitting, netting and buybacks included)
rather than a client-approximated `{direction, amount}` buy; the confirm
reads "Bet to $X, up to N cr" so the instruction states the landing.
Editing the side or amount by hand returns to a plain budget buy. When
resting limit orders fill behind a trade, the page shows
`settledConsensus` (where the market came to rest), not the trade's own
post-price.

**A trader holds ONE net side, and gets there by REDEMPTION** (owner ask
2026-08-30, after Manifold). One higher share and one lower share pay
exactly 1 credit between them at any settlement value (`resolutionPayouts`
is `[1-p, p]`), so a matched pair is riskless. Buying the side opposite a
position you hold therefore does NOT sell that position: the buy happens
against the live book, and afterwards every matched pair the trader now
holds is redeemed for exactly 1 credit each. Both sides of the pair leave
the book, which moves the price by nothing at all, because an LMSR price
is a function of `q1 - q0` and redemption subtracts the same amount from
each. So a small contrarian bet is a small move and a small reduction,
and nobody ends up holding both sides.

What this replaced (2026-08-11 to 2026-08-30): the trade path sold the
ENTIRE opposite position into the AMM before the buy. A one-credit
contrarian nudge liquidated a whole position, at a spread the trader never
asked to pay, and moved the price by the size of that forced sale rather
than the size of the bet (owner report 2026-08-30: 25 credits moved a
market from $7,146 to $10,706, almost all of it the forced close).

Consequences worth knowing: the buy is funded from the BALANCE alone, so
holding a large opposite position no longer lets a trader spend more than
they have (the redemption pays out after the buy, not before). Redemption
is liability-neutral for the pool, which pays 1 credit now and sheds
exactly 1 credit of settlement liability. This is engine behavior
(`executeTradeInTx`, functions/src/services/trading.ts), not UI, and the
client preview mirrors it (`previewTrade`); `amm-parity.test.ts` fails if
the two ever disagree again. Buying the SAME side you hold just
accumulates.

**A redemption is not a trade in any list a person reads.** Redeeming a pair
writes two ledger rows, one per side, because the price replay rebuilds the
book by walking `trades` and a change to `markets.shares` with nothing behind
it replays as a different market. Those rows say nothing about what the
trader did: they move no price, they have no counterparty, and classifying
them by the sign of their cost showed one buy as three trades, two of them
sells the trader never placed. `trades.kind` marks them, and the rule follows
from what each surface is for. A tape of trades against a market omits them.
A participant's own record keeps them, because their balance moved, as ONE
row that says redeemed, carrying the pairs and the credits both sides paid.
Counts of trading activity, like the floor's trades-this-week, count trades.
The price replay reads every row, always.

### Where markets open

**Conditional (proposal) markets open ANCHORED**: a fresh pair opens at the
baseline market's current value rather than the range midpoint, and the
approved branch opens at baseline minus the proposal's ask, because
approval burns the ask into the resolving metric the day it is paid. **The
ask-adjustment applies only to a metric that the payment actually moves**:
the name must carry a currency tail, the same "(USD)" convention that puts
the $ on the headline, AND name itself "net", the owner's word for a number
already reduced by what he pays out. A gross revenue metric is not moved by
the payment at all, so its pair opens unadjusted; subtracting the ask from
it would clamp the approved branch at the range floor. Subtracting a dollar
ask from a metric counted in people or hours is a category error that
drives every approved branch to the range floor and prints the same fake
negative impact on every proposal. A non-monetary metric anchors both
branches at the baseline and lets traders price the whole difference.

**A baseline market opens at the metric's own current value**, not at the
range midpoint, however far out its period ends. A midpoint open is not a
forecast; it is an artifact of the range the operator happened to choose,
and it hands credits to whoever reads the metric first. Today's reading is
not an estimate of where the number lands in a year either, but it is the
only figure in the system that was actually measured, and it carries the
scale, the units and the direction of travel that the midpoint of an
arbitrary band does not. Depth sharpens the argument rather than softening
it: a deep pool is exactly what makes a wrong opening price expensive to
correct, so the market that most deserves a subsidy is the one that can
least afford to open in the middle of its range. Solvency uses the same
`anchoredMarketState` sizing the conditional pairs use: the LMSR b is sized
down so the subsidy exactly covers the anchored worst case
(`anchoredMarketState` in functions/src/lib/amm.ts); an off-center open
buys its anchor with a slightly thinner book, never with unminted credits.

The cost is paid in depth, and the operator controls it with the range. A
value sitting near a range edge clamps to [0.001, 0.999] and opens with a
thinner book than the same credits would buy at the middle (at the clamp,
about 1.8 times thinner than the old 2% floor bought, and 10 times thinner
than the centre), so a market on a number parked at the bottom of its band
is cheap to move. The fix is a range the number sits inside, not a midpoint
open that prices it somewhere it has never been.

**A metric sitting AT or past a range edge anchors at the edge**, never at
the midpoint. An LMSR cannot quote certainty, so the seeding clamps into
[0.001, 0.999] of the range, one part in a thousand, and the market opens
as low (or as high) as that. The midpoint is the worst answer available
there: a revenue metric reading $0 on a 0-1,000 range opened its daily
market at $500 and paid whoever pushed it back down. The old floor of 2%
was the same mistake at a smaller scale: a $5 reading on that range opened
every daily market, and every conditional branch under it, at $20, and a
valuation reading $0 on a 0-20,000,000 range opened at $400,000. A reading
inside the clamp opens at the reading itself; a reading at the edge opens
one part in a thousand from it, which is the closest a solvent book gets.

**A baseline book on a metric that already has a traded open book opens
at that book's price, not at the reading.** The traded book whose settlement
is nearest the new one's is the market's own forecast of the same number,
and the only price on the floor anyone has paid for; the reading is the
past, and on a metric that voids until measured it is not even a number.
A yearly valuation book that opened at the $0 reading, clamped to $20,000,
beside a September book five trades had carried to $820,000, told a
stranger the floor expected a forty-fold fall nobody believed and nobody
bet. Only a metric with no traded open book opens at the reading, as
above. A conditional pair keeps anchoring to its own baseline.

**Every path that opens a book on an untraded baseline market opens it the
same way.** The daily spawn, the refresh that funds a market which opened
unfunded because the balance was short, a hand-made market from
`POST /api/predictions/markets` with or without auto-fund, the bulk top-up
and a single participant's liquidity injection all reach one function
(`anchorUntradedMarketTx` in functions/src/services/marketLiquidity.ts), so
which endpoint paid for the book cannot change the price it opens at. It is
called from inside `applyAgentLiquidityInjectionTx` rather than by each
caller, because there were five such paths and one of them remembered.

It declines in exactly the cases where there is no blank book to place: a
market that is already traded, one that is already anchored (shares
outstanding with no trade behind them is a price, not a blank), and a
conditional branch, whose opening price is the baseline adjusted for the
branch and the ask and therefore `services/proposals.ts`'s question rather
than this one. `anchor-ownership.test.ts` fails if a second opinion about
opening price appears, and `every-open-anchors.test.ts` pins each path.

### Discussion, Positions, Trades

Under the bet buttons sits the conversation: a quiet "Discussion (N)"
toggle expanding the thread in place, hairline rows, mono names, and the
underline composer for signed-in traders ("Sign up to join the
conversation" otherwise). The subject follows the one view: the baseline
market's thread normally, the selected proposal's proposal thread when one
is open. Reading is public via GET /api/marketplace/:idOrSlug/comments
(Open workspaces only); writing uses the same authenticated message
endpoints API participants use.

Beside Discussion sit Positions and Trades. **For a proposal they cover
BOTH branch markets, not the branch on screen.** A proposal opens on "if
approved", and a proposal whose trades all sit on the declined branch
would otherwise answer "Trades (0)", which reads as the trades having been
lost. The panel fetches both branches, sums the counts, merges the rows
(trades newest first) and labels each row with its world ("if approved" /
"if declined") so a bet is never invisible because of which world the
reader happens to be looking at. The baseline market has one world and
carries no label.

### The decision bar

A manage-capable session (the owner) gets a decision bar on a selected
contract: "Approve, pay $N" as the one money-colored pill, and Decline,
which opens the published-reason field in place (the charter promises the
reason lands on the proposal, so the confirm stays off until a reason is
typed). Nobody else ever renders the bar; the backend enforces manage
regardless.

### The floor's live poll

**The floor's live poll (every fifteen seconds) refreshes DATA, never the
view.** The selected proposal, the branch toggle, an expanded description
and the drawn chart are the viewer's state, and a tick may only overwrite
prices and histories in place. Two specific rules follow: view state resets
on a proposal change and nowhere else, and a history refresh never blanks
first, or the chart collapses to its single-point fallback for a frame and
reads as a blink.

**Stale-tab guard.** The floor is designed to be left open, so every
deploy strands open tabs on old code indefinitely; an SPA never reloads
itself and index.html is no-cache, so only a reload picks a deploy up. The
floor therefore checks every five minutes (first check five minutes after
load, paused while the tab is hidden) whether the served index.html
references a different `/assets/index-*` bundle than the one running, and
when it does, renders one quiet fixed pill in the bottom-right, "new
version · reload", which reloads on click. It never reloads on its own:
yanking a composed bet or a selected branch out from under the visitor is
worse than stale code. In dev (no built bundle in the served page) the
check is inert.

### The proposals board (under the trade)

**The proposals board sits under the trade, at the column's full width**
(revised 2026-09-09, moving it out of the right rail, which the ticket now
holds). It renders for everyone, under a bare "Proposals" label, with
proposing routed to /signup when anonymous. What it gives up is the
always-on-screen slot; what it buys is a row wide enough to be acted on,
which is the point of the change.

**Proposing is a quiet way in, never a main action** (owner ask 2026-09-09:
"for traders that might be too confusing to be this prominent ... they are
there to mostly trade not proposa actions"). One plain accent line under the
last row, "+ Propose work on this number", in the register a text link
wears: no band, no filled button, no sub-line pricing the offer. Somebody
who came to post work will find one line; somebody who came to trade is not
asked to consider becoming a contractor before they have read a price. The
control is still there for everyone the workspace allows, and the dialog it
opens is unchanged.

**Nothing summarises the board above it** (owner ask 2026-09-09, removing
the count line of the same day: "like i think the way it isdisplayed below is
engouh"). The rows say how many there are and when they decide; a sentence
counting them is a second telling of what is already on screen, and it spent
its row selling proposing to a reader who came to trade.

**The board is ordered by what needs a ruling first** (revised 2026-09-09,
replacing pool-first of 2026-09-02): soonest decision at the top, with the
pool breaking a tie, so a proposal closing today is never below one closing
next week. Pool-first put the biggest claimed impact on the floor at the
bottom of the list because nobody had funded it, which is a ranking that
answers a question no reader asked. Between two proposals closing the same day depth is
still what decides. Five pending rows and a "show all" line: four fit today and
twenty would not, and the decided fold under it is unchanged.

**The row is two lines, and only one of them is loud.** The first line is
the title and, right-aligned, the impact: if-done minus if-not-done,
green/red, "open" while unpriced, under a single column label ("impact if
done", or "impact by <date>" when the horizon on screen has a date) rather
than a label per row. The second line is the facts as an ICON ROW
(`.pubws-prow-meta`), the same vocabulary the market's own facts use: the
proposer, the USD ask, the countdown to the decision, and the pool behind
the pair.
Icons, not words, because four labelled facts under every row is a
paragraph per proposal; each icon carries its words as a hover title. The
rows are ranked by pool as before. **Nothing is stacked on the right edge**:
the impact and the two verbs sit on one horizontal line with the title, and
a fact that cannot fit there goes to the icon row instead. The right edge
growing a fourth item is what made this row unreadable in a 340px rail
(Viktor, 2026-09-09: "4 things below each otherh seem like too much").

**Every row can be traded from where it is read** (2026-09-09): a compact
Higher / Lower pair (`.pubws-dir--mini`) at the end of the row, which selects
that proposal and opens the ticket on that side, exactly as pressing the row
and then a verb would (and the ticket is already on screen, in the rail, so
nothing scrolls).

**And a manager rules from the row.** Beside those two verbs, for a
manage-capable session only, Approve and Decline in the decision bar's own
vocabulary. Both confirm in place: Decline opens its published reason ON the
row with the confirm off until a reason is typed, because the charter's
promise has to be kept where the ruling happens, and **Approve confirms too**,
naming the money it pays, because a list is a place to mis-click and
approving IS the payment. Neither renders on the row the page is already
pointed at, whose own ruling band is on screen.
Four pending proposals is a morning's work and should not be four page
loads. The bar on the proposal's own page is the same two controls with the
same rules; neither is a second implementation of the other. Nobody but a
manager ever renders either, and the backend enforces manage regardless. Kalshi repeats a pressable price on
every row of its ladder; a priced row with nothing to press is a table, not
a market. The pair is hidden on a decided proposal, which nothing can be
traded on any more, and on an unfunded one, which has no market to trade
against.

**A proposal prints what is behind it, and the ballot is ordered by it.**
Under the impact, in the drop the market's own pool rows wear, every proposal
carries the credits behind its forecast: both branches of every pair, added
up, because half the money is not the number a reader comparing two proposals
wants. Quiet and mono, so the impact stays the headline it has always been.
The pending list is ranked by that pool, deepest first, with impact breaking
a tie (owner decision 2026-09-02: "proposals are ordered by total liquidity
available"). A proposal nobody has funded sits at the bottom rather than at
the top by accident of its own unpriced delta. Decided proposals stay ranked by impact: nothing can be funded into
them any more.

**A proposal has a number and an address.** Every proposal carries a
short number, `#7`, assigned in order of posting within its floor, never
reused and never renumbered when another proposal is removed, so a person
can name one in conversation ("what does #7 mean?") without reading a UUID
out of the API; the payload ships it as `number` beside `id`. The row
prints the number in mono before the title, and nothing else: no link
control, because **selecting a proposal changes the page's address** (owner
decision 2026-09-04): the address bar reads `telarchy.com/<slug>#proposal=7`
while proposal #7 is open, so copying the address bar is copying the
proposal, and deselecting restores the floor's own address. The address is
replaced, never pushed, so the back button still leaves the floor rather
than stepping through every proposal the visitor looked at. The same
anchor is what a notification links to, by id (`#proposal=<id>`), and both
forms open the same proposal. A visitor who wanted to
ask about a proposal and could not say which one (Otto conversation,
2026-09-04) is who this is for.

**The proposer sees their own proposal.** Posting selects the new proposal,
so the page's one market view points at it the moment the dialog closes
and the row is on screen wherever the ranking put it, which for an unfunded
proposal is the bottom of the ballot. A pending proposal posted by the
signed-in participant prints "yours" among its facts, so their own rows read
as theirs from then on. Before this, a stranger's first $0 proposal landed
last, unmarked, and its author reloaded the floor and could not find it.

**The board opens on the live ballot; decided proposals are folded away.**
An approved or declined proposal is history: nothing about it can be traded
on or influenced any more, and decided proposals carry the largest impacts,
so ranking them in with the pending ones buried the handful a visitor could
still act on under the archive of ones they could not. The list therefore
shows the pending proposals, and ONE hairline row at the foot of it stands
for the rest: the count on the left ("7 decided"), SHOW or HIDE in the
accent on the right, and a chevron that turns. Expanded, the decided
proposals appear beneath that row as the same rows they always were,
newest decision first: the decided list is a record of what the owner
did, and a record reads in the order it happened, so the proposal decided
most recently is at the top and impact, which ordered them while they
were live, no longer orders them. A proposal whose decision time is
missing sorts last, and impact breaks a tie. The row is only there when there is something on both
sides of it to separate: a board with nothing decided has no fold, and a
board with nothing pending has no ballot to bury, so it shows the decided
proposals as the list and no fold either. Two rules protect the
selection, which is what the page's one market view is pointed at: a
selected decided proposal forces the fold open, because a
`#proposal=<id>` link from a notification must never land on a row the
fold is hiding; and hiding the fold while a decided proposal is selected
releases that selection, so the control can never be dead.

**The board is a
selector, not a second trading surface**: selecting a proposal re-points
the page's ONE market view and ONE ticket at that proposal's conditional
pair, rather than growing a smaller market underneath. Both branches are
on the page (every proposal branches into two worlds and both are visible):
an "if approved" / "if declined" pill toggle under the headline picks
which branch the view shows and the ticket trades (approved by default,
green for approved, red for declined, matching the chart).


**"+ Propose"** opens a dialog that is the ticket's STRUCTURE,
not just its underlines: the USD ask is the hero numeric at the top
exactly where the ticket puts its bet amount ($ unit, mono, auto-width
underline), the title / pitch fields are quiet left-aligned underlines with
small left labels, and the whole deal rides the confirm button itself (the
cost belongs at the moment of commitment, on the final button, not only
near the first press; there is no separate line under the fields and no
facts table): `.ticket-go` carries a quieter second line
(`.ticket-go-sub`) saying that posting is free and what approval pays; the
board itself no longer says it, because the line that carried that phrase
was the band that has been removed. Posting a proposal costs nothing; the only credits a proposer can
put in are the optional `liquiditySubsidy` on the branch markets, and the
credits back on approval are the workspace's `proposalReward`, which is 0
unless the workspace sets it. Color only speaks as state: accent focus,
red errors and the full title counter, green ONLY on the placed flash; the
confirm is the neutral `.ticket-go` whose main label progresses "Suggest a
proposal" (disabled, invalid) to "Offer this for $N" (ready) to
"Submitting..." to "Added to ballot" (green flash, sub-line hidden, then
the dialog closes). A $0 proposal is a valid proposal and needs no payment
details; a non-zero ask with no account payment details shows a warning
and disables the confirm. The ask is sent as `askUsd` and stored on the
proposal; when non-zero it is *also* composed into the title as "$N: ..."
because that reads well and travels into the activity log and share text,
but the stored column is what anything financial reads. Rows prefer
`askUsd` and fall back to parsing the title only for proposals created
before the column existed. There is no paid-to field: payment details
belong in account settings, not in a proposal; the account settings dialog
edits them, and the server refuses a paid proposal without them.

A proposer stakes only what they choose to subsidise: `liquiditySubsidy` is
charged per branch market, and it comes back in full at decision time,
declined refunding via the void and approved via the owner buying out the
proposer's LP position (see notes in the telarchy umbrella). Omitted, it is
nothing, and the branch markets open unfunded.

### The account dialog

The account is a full dialog (`AccountDialog`); the avatar's popover
keeps only a glance (name, credits, "Account settings", log out). **The
dialog IS the account.** It carries the picture (the avatar IS the
control: click, pick a file, frame it, saved), the username, the bio shown
on the public profile, structured payment details, the credit balance with
USDC top-up, payout wallet and withdrawal (`AccountCredits`, rendered only
where the instance has USDC settlement on, so a simulation instance never
shows a deposit box), the Manifold import, the prize season with its claim
button (`SeasonEntryPanel`; entering happens on the floor rail and the
public leaderboard, not here), and the password change, collapsed behind a
link because most sessions open this dialog for a picture or a payout
address. All of it is in the ticket language.

The dialog is FILED, not stacked. Four underline tabs across the top,
Profile, Money, Notifications, Security, one section on screen at
a time. The rail is the table of contents the long form never had: a
setting becomes something a reader can see exists instead of something
they have to scroll into. Underline tabs, not pills, so the rail cannot be
mistaken for the provider pills a few lines below it.

**Notifications** is one of those sections (tab id `emails`): three
toggles for the notifications a participant gets by mail (a comment under
my proposal, a reply in a thread I am in, every new proposal), each saving
on the click with no separate confirm, because a switch that needs a Save
button reads as a form rather than a switch. This dialog is the only place
they are edited. The `/account` URL resolves: it redirects to the floor
with `#account`. `<floor>#account` opens the dialog; `<floor>#emails`
opens it on the notifications section and is what every notification
email links to.

Agent setup, owned bots, funding, and API-key management live on `/agents`,
not inside account settings. The account menu links to **Agents & keys** at
`/agents`. The page follows `docs/audience-pages.md`. Its two local task links, Your connections and Set up an agent, switch the contents of one document column. This is a focused task switch, with no console navigation or sidebar. The first visit opens setup without requiring login. Agents uses the floor’s compact visual register: a modest Fraunces page title, mono uppercase task-strip labels, existing `.pubws-seg` controls, small section labels and hairline rows with actions alongside their facts. It has no oversized poster heading or illustration.

Payment details are STRUCTURED (providers, not one broad text field): a
pill row picks the provider (PayPal, Bank, Crypto, Revolut, Wise, Other),
each provider asks only for its own fields (crypto adds a network pill
row), and the server validates per provider (IBAN mod-97, per-network
address shapes) with the refusal surfacing verbatim beside the save. The
stored object lives in `agents.payout_method`; its human-readable summary
is derived into `agents.payout_handle`, which is what paid-proposal
proposals snapshot.

The Manifold import row: a flat grant for an established account, priced in
the earn table (`GET /api/earn`) and never scaled by mana, once per account
pair, verified by a one-time code in the Manifold bio. The account must be at
least 90 days old, not flagged as a bot, and either have traded in the last 60
days or have markets other people traded; anything else is a 400 naming the
condition it failed.

**Framing the picture** (zoom plus x and y offset, not just a centre
crop). Picking a file does not save it; it opens a framing step that takes
over the dialog body (the identity head, tabs and panel step aside; the
title reads "Frame your picture" with the same close). The step is a
wide stage showing the whole picture, with everything outside a round
220px frame (the avatar's own shape) dimmed to the card colour, so what
is being cut off is visible while it is being cut. Under it, one zoom row
(a "−" and a "+" around the ticket slider, 1x with the short side filling
the frame, up to 4x), a one-line hint, then Cancel and "Use this
picture" right-aligned in one row. The picture is draggable on the stage
(pointer drag, or arrow keys when the stage has focus), and the frame is
never uncovered: offset and zoom clamp so the picture always fills it.
"Use this picture" renders exactly what the frame shows to the 256px
square that POST /api/auth/profile stores and returns to the dialog;
Cancel drops the pick and returns with the old picture. Nothing about the
framing is stored separately: the stored image IS the framed result, so
every viewer (rail avatar, leaderboards, participant page) sees the same
crop with no per-surface math.

**The floor's one modal says when it has more below.** `FloorModal` fades
its bottom edge into the card colour with a chevron under it, and both
vanish at the end of the scroll. The cue is drawn on a wrapper, never
inside the scroller, because a cue that scrolls away with the content it
describes is not a cue. Every dialog gets it, not only the account.

### Otto

**Otto** is the floor's market maker: a named character in the
bottom-right corner who has read the brief and will say what he makes of
it. He also acts: signed in, he calls the API with that person's own
account, so the panel's closing line says "he can do what you can do and
nothing more" and one opener is a thing to do rather than a thing to ask.
Signed out, the same line says reading is all he can do and what signing
up would change; offering an action that will come back 401 wastes the one
minute a stranger gives you. Closed he is one line with a serif O,
deliberately not a circle with a speech bubble in it, because a bubble is
the universal mark of a support widget and he is not support. Open he is
a panel in the same ruled language as the rest of the page: his turns are
flush left in the page's own voice, the visitor's are set apart by an
accent rule rather than a coloured pill, so it stays a document instead of
becoming a messenger app. Three openers name this floor's own subjects,
because a blank chat is a blank page. One line under the composer says the
opinions are his and not the company's. On a phone he takes the sheet; a
23rem panel on a 390px screen is a joke.

**Two doors, one conversation.** A pill in the corner is easy to miss
while reading, and the place a visitor's question actually forms is the
paragraph that just ran out of answers, so **the last line of "What is
<name>?" is a row that opens him** (`.pubws-know-ask`): full width,
hairline top and bottom, the serif O on the left and an arrow on the right
that leans out on hover. It is a row rather than a button beside the
heading: at the end of the prose it is the next thing to read instead of a
control competing with a label. It opens the same panel the dock opens:
the floor owns the open state (`TradePage`), never a second Otto with half
the conversation. The closed dock is **ink**, not bone, for the same
reason: the one thing floating over a bone document should look like the
one thing you can press, and it does not compete with the bet buttons
because they are the page's colour and he is its ink.

He lives in the corner rather than in the column because a reader needs
him at whatever point of the page their question arrives, and because the
page's job is the market. There is no corner bubble and no separate "ask"
bar in the column. The prompt for pointing your own AI at the same brief
is a SETTING (account dialog, "Your AI"), not another door on the page.

### The bell

**The bell** sits in the top bar left of the avatar, signed in only. At
rest it is drawn in the same icon family as the bug and Discord marks
(1.7 stroke, tertiary ink, accent on hover). With news the WHOLE control
lights: the bell takes the accent, sits in a soft amber field with a
hairline ring, and carries a mono count, still no red dot. A fresh
arrival pulses the ring once, and only on a rise, never on a poll that
changed nothing, because a page that twitches at rest teaches people to
ignore it. Its panel is a ruled list, one row per event, and unread rows
carry an amber hairline down the left edge as the only unread marker (a
badge per row turns twelve rows into a field of noise). Opening a row
reads THAT row: the count drops by one, its hairline goes, and the rest
stay as they were. "Mark all read" stays for the sweep.

**A row lands on the thing it names.** `/<slug>#proposal=<id>&comment=<id>`
selects the proposal, opens its thread, scrolls the named comment into
view and runs `.is-flashed` on it: one wash of the accent that fades out
over 1.8s. Rows with no comment flash the proposal headline instead. The
class is shared, so anything the floor ever needs to point at flashes the
same way. It is deliberately not a selected state, because a highlight
that stays turns into something to dismiss and the reader already knows
what they clicked. Under reduced motion the wash still happens (it is the
answer to "which one?") and the scroll stops gliding.

### The rails, and the standings under the verbs

The board is signed-in only; the anonymous poster stays clean.
**The right rail is the ticket** (revised 2026-09-09, replacing the
proposals board that used to hold it): from 1120px up the floor is the
market in the centre column with the trade ticket alone in a sticky right
rail, separated by a vertical 1px `var(--border-color)` hairline, so what a
trader does is on screen from the moment the page opens instead of waiting
below the fold for a press. The ticket is mounted from the first paint in its
untouched state, both sides quoted and no side chosen; the two verbs under
the chart seed its side rather than summoning it, and it is keyed by that
side so pressing the other verb re-seeds it instead of being a dead click.
**The ticket names its own subject, INSIDE the card** (owner report
2026-09-09, of a "YOUR TRADE" eyebrow and a hairline stranded above the card
with "net revenue, this month · 30 Sep" under it: "i dont like the net
revenue this month text theer the way it is .. it looks super weird"; the
model is Kalshi's own ticket, which carries the event and the subject in the
card between its BUY/SELL row and its side prices). Under the tab rule: one
quiet line of context and one bold line naming the thing being traded. On a
market the context is the FLOOR and nothing else ("LookPilot" / "Net
revenue, this month"): the clock is already in the title, and a settle day
beside it said the same date twice (owner report 2026-09-09, "ther eis twice
the date"). On a proposal it is the number, the world and the deadline over
the proposal's own title ("#11 · if approved · decides 15 Sept"), none of
which the title repeats. Nothing above the card names it: a
label, a subject and a hairline outside a card that has a header of its own
is the same header said twice, in a column 293px wide. On
viewports >=1500px a narrow left column returns for this market's own
context and the centre grows to 960px, so the chart and both numbers get
the room and the question line sits on one row (the three-column rule of
2026-09-06, Viktor; design record in the telarchy umbrella,
`notes/floor-boards-yc-and-venues-2026-09-04.md`). Between 1120px and
1500px there is no room for three (a 1280px laptop squeezed the centre to
509px with three tracks). **The left column exists only in the plain market
view**: with a proposal selected the floor is centre plus ticket at every
width, because a proposal's page is about the proposal and its two
branches, not about the metric's definition (Viktor, 2026-09-06). **The
left column is about THIS market and never about other people**: the season
block and the announcements. Nothing on the first screen ranks anyone,
because every venue that works puts title, number, chart and trade control
first and nothing about other people above the fold, and a board of the
same dozen names at 25 visitors a day reads as "no one is really using
this" rather than as proof. **The definition is not in that column
either**: since 2026-09-09 the rule the market settles on is the one block
under the trade, which is what makes it unrepeatable at any width and
retires both the summary line and the width test that used to hide it.
What remains in the know block under the market is the checklist for a
manager and the subject block.

**Social proof is real use, not a ranking, and facts are the icon row,
never a sentence** (owner rule 2026-09-03, and again 2026-09-06 when a
prose count strip was cut). Since 2026-09-09 the counts themselves live
in the chart's footer, where two of the three take one word each; what
remains under the bet verbs is the owner's Inject and Buy controls.
The season is ADVERTISED, not narrated (Viktor, 2026-09-06: "season can
be advertised better than with these weird words"): the block leads with
the money as its hero line in the mono numeral style of the market's own
numbers, "$1,000 in prizes", then one short line of the terms, "Season 0
ends in 26 days. Free to enter.", then the "Enter the season" / "See the
season" control. Three lines, nothing else: no trader or volume count in
it, no "and", no running sentence. It sits in the left column under the
definition.

**The standings are footers, not rails.** Under the facts row, two
compact blocks side by side on desktop and stacked on a phone
(`.pubws-standings`): "Top traders" and "Top contractors", THREE rows each
(the rail showed five), the same `.pubws-lb-head` anatomy (tiny uppercase
label, right-aligned mono meta, hairline, rows), and one "Show full
leaderboard" link to `/leaderboard` under the pair. They keep every
ranking rule below and the fifteen-second poll. **With a proposal
selected, the traders footer becomes "Traders on this proposal"**: the
same rows, restricted to accounts with a position on either branch of the
selected pair, ranked by that position's marked profit, with the meta "this
proposal"; when nobody holds one it says "nobody yet" in one row rather
than hiding. The contractors footer does not change, since the contractor
score is workspace-wide by construction.

**The order under the trade is the same at every width** (2026-09-09): the
two bet verbs, then the ticket, then the proposals board, then the propose
band, then how this settles, then the market's own activity, then the
standings footers, then the announcements and the rest. Everything after the
verbs is ONE grid item (`.pubws-tail`), and the ticket rail is its own,
placed in the DOM between them: so the document order IS the phone order and
the grid alone puts the rail beside the market on a wide screen. Nothing is
rendered twice to achieve it. On a phone this replaces an order that put both standings, the
definition and the announcements between the trade and the proposals, so
paid work began at 2327px of a 4240px page. A visitor comes to price the
number or to be paid for moving it, and both of those now happen in the
first screen and the one after it. The floor column keeps a small gap under
the top bar on narrow viewports. The loading ghosts draw the same columns.

**Both standings are scoped to THIS workspace.** The traders footer passes the
workspace to `/api/leaderboard` (`?workspaceId=<id or slug>`), so a
trader's number on a floor is the profit they made ON that floor; the
contractor board is per workspace by construction. The cross-workspace
board lives at `/leaderboard`, where the question genuinely is
platform-wide.

**"Show full leaderboard" is a link to `/leaderboard`, never a board opened
in place.** The link sits directly under the two footers it extends and is
their only full-width control; the season's own control lives in the
season block in the left column.

**The blocks share one anatomy.** Every block, footer or rail, opens
with a header row (`.pubws-lb-head`): the tiny uppercase label on the
left, a right-aligned mono meta on the right, a hairline underneath, rows
following directly. The meta says what the numbers are: "this market" over
the traders, "impact" over the contractors, "impact by Sep" over the
proposals, and the season's countdown over the season block (the one meta
in primary colour and bold, because it is the number that says whether to
act today). The proposals board's column label is that header's meta.

**Both leaderboards rank on what the market says right now, not on what
has settled.** The footers show three rows each; both update on the
floor's fifteen-second poll, so a single trade reorders them without a
reload.

- **Top traders** rank by trading profit marked to market: payouts
  collected on resolved markets, plus the current worth of every open
  position (shares x the market's live consensus factor), minus the net
  cash paid for those positions (sells count negative). An unresolved
  position counts the moment its price moves; nothing waits for
  resolution. On `/leaderboard` each row also prints the split under the
  total, "settled" (final: resolutions and refunds) and "open" (still a
  mark), so a reader can tell realised money from paper (`docs/seasons.md`,
  "The score"). The rail's five compact rows print the total only. The
  number is measured off the trades, not off the balance, so credits the
  platform handed an account never enter it. **No account is excluded.**
  Anyone who has ever traded in a public workspace is on the board. **A
  cancelled market is valued at its refund, not skipped**: a void pays
  back the net cash you still had in it, floored at zero (see
  `docs/vision.md`), so a market that was cancelled under you nets to
  exactly zero, while a realised gain you took out before the cancel
  stands. Trades on markets whose rows are gone entirely cannot be valued
  and count nothing. The row shows the signed profit in credits. **An
  untraded market never enters the board or a profile**: a market nobody
  traded and nobody holds a position on cannot have moved a balance, so the
  board, the season standings and the profile's stats are computed over
  the traded set only and answer the same with or without it (the reads
  are bounded by trades, not by a workspace's market count; telarchy
  umbrella, `notes/snake-load-audit-2026-09-10.md`).
- **Top contractors** rank by the market's valuation of the proposals
  they posted, NOT by dollars collected. A proposal's value is its priced
  impact: the approved branch's consensus minus the declined branch's, on
  the workspace's hero metric (the soonest-resolving baseline market's
  metric), taking the largest-magnitude horizon when a proposal is priced
  on several. A pair is priced as soon as both branches hold liquidity; no
  trade is required, because an opening price is the market's price until
  someone moves it. A pending proposal is valued live, at the pair's
  current prices, so a proposal posted minutes ago scores the moment its
  books are funded. A decided proposal is valued at the moment the owner
  ruled: the prices of the pairs still open at that moment are recorded on
  approval or decline and never re-read afterwards (a horizon that had
  already settled or been retired before the decision is not something the
  owner ruled on, so it is not in the record), because whatever happens to either book later (the
  losing branch is voided, the winning one keeps trading, an untraded book
  is re-anchored) is not what the decision was priced on. Approved
  proposals score that recorded impact; declined, withdrawn, and removed
  proposals count zero, because the work never happens. A proposal whose
  pair is not priced yet contributes zero rather than dropping its poster
  from the board. The score is signed and carried in the hero metric's
  own unit (a proposal the market thinks hurts the number reads
  negative); dollars earned on approved proposals drop to the row's second
  line, alongside the proposal count. House accounts are NOT excluded
  here: a contractor's score is priced by other people, so it cannot be
  self-granted. The rail scores every pending proposal plus the 200 most
  recently posted approved ones (`CONTRACTOR_DECIDED_WINDOW`), never a
  workspace's whole history: it is rebuilt on every floor poll and home
  build, and a decided proposal's books are not read at all, since its
  recorded pair is what it is valued on (same audit note).

**The board is at most five seconds behind the trades, and a reader's own
trade shows up on their next read.** The server-side board cache TTL is
five seconds: the floor polls every fifteen seconds (every five while a
pending proposal decides within five minutes, so a one-minute window is
watched at the rate it moves), and a cache longer
than the poll makes successive polls alternate between a fresh answer and
a stale one, which reads as the board twitching backwards. Five seconds
still collapses an arrival burst into one aggregation per key while
sitting safely under every poll interval. Placing a trade additionally
drops the cache on the spot, so the trader who just moved a price is never
told the price did not move. `/leaderboard` itself polls on the same
fifteen-second cadence while the tab is visible and refreshes on tab
return; a poll replaces rows in place and never blanks the list, and a
failed poll keeps the rows it has. The page's public data loads once and
polls; only the viewer's own season-entry state re-fetches when the
session resolves, because re-fetching everything on auth settle repaints
the whole board a second after it appeared.

**A season entrant's row always carries a prize figure, on `/leaderboard`
AND on the floor's Top traders footer.** While the season is a draft there
is no projection to make (no baselines exist), so the chip shows the
ladder's top rung, plainly: "$500", never "up to $500". Once the season
runs, the chip shows the projected payout at the current standing, from
the same `settleSeason` the settlement uses; the number is the entrant's
GLOBAL season standing even on a workspace-scoped rail, because the prize
is a season fact. An entrant currently outside the rungs shows "entered"
(rail: "in"). A bare "$0" is never rendered: before the start it would
read as "wins nothing" rather than "not decided yet". The chip is
prominent by design: accent-colored, heavier than the credits number
beside it, because it is real dollars.

### The know block: definition, announcements, subject

Under the floor column, the know block is three labeled sections:

**"What is this market?"** is the metric's own stored description
(`.pubws-know`): what the number is and when it settles, verbatim from the
metric row, rendered as markdown (same stack as the announcements body,
plus remark-breaks so a plain newline is a line break: owners write this
text over the API and a collapsed paragraph misquotes what the market
settles on). It is never paraphrased in the UI, because the description is
part of the metric's definition and the words shown are exactly the words
the market settles on. A manager edits it in place; every edit is on the
record and rendered below the definition so a trader can see whether the
wording moved after they took their position (docs/market-integrity.md,
I1). The floor does not plot the metric's measured values here; the
history fields stay in the API.

**Announcements** is the owner's disclosure surface (`docs/vision.md`,
"Workspace announcements"), so it sits in the owner-prose zone rather than
beside the market. On the floor it is one row (`.pubws-annline`): a
three-column grid of headline, day, and an arrow, hairline above and
below so it reads as an entry in a ledger rather than a paragraph of
prose. The headline comes from `src/lib/announcement-headline.ts` and
nowhere else. Hover and keyboard focus take the headline and the arrow to
the accent and nudge the arrow 2px (reduced-motion drops the nudge). The
section's corner control is "All N" when the record holds more than one,
and nothing when it holds one, because a count that always reads "All 1"
is furniture. The section renders nothing at all when the workspace has
never published one and the visitor cannot manage it; it is present only
when the Public group grants read (`announcementCount` is absent on a
counts-only floor).

**Attribution.** An announcement published by a participant who is not
the workspace owner carries `publishedBy`, and both surfaces print it: the
floor's one-row line appends the nickname after the day in the `when`
cell, and each entry on `AnnouncementsPage` shows "by <nickname>" beside
its timestamp in the same muted meta style as the edited marker. The
page's guarantee sentence says the record holds what the owner, or a
publisher the owner named, has said. Nothing is printed when `publishedBy`
is null: the owner's own words stay unlabelled.

**"What is <name>?"** (`SubjectAbout`) is the product in its own words plus
the primary sources: one sentence on what the product IS, then described
links a forecaster can audit without trusting this page (for LookPilot:
the data room, "the official numbers this market settles on"; the Steam
store page, "the product, as players see it"; SteamDB, "third-party sales
estimates"). Mono names with hairline underlines that warm to the accent;
external, new tab. A manager edits the text in place (the `SubjectAbout`
editor pattern: hairlines, `jobform-line` textarea, ticket buttons). Its
last line is the row that opens Otto (see "Otto").

**The live view is a segment of the chart slot** (`LiveView`, revised
2026-09-11). The owner's own picture of the thing the market steers is
drawn natively on the floor, from the owner's feed, in the one chart's
slot: a workspace whose setting `liveFeed` names a feed gets a third
segment button in the chart's control row, LIVE, beside VALUE and CALL,
and LIVE is the segment such a floor opens on (a mode remembered for the
session still wins on a later load; a remembered LIVE on a floor with no
feed falls back to VALUE). A floor whose `liveFeed` is null has two
segments, exactly as before, and nothing else on the page moves. The
owner asked for this in place of the framed page on another host (Viktor,
2026-09-11: "it should all be doable within the telarchy.com it should
replace the snake.telarchy.com.. i dont like it being there separately";
record in `notes/decisions/ui-conventions.md`).

The setting is `liveFeed` on `PUT /api/workspaces/:id/settings`, plain
`manage`: `{ kind, url }` or null to clear, where `kind` names the feed's
shape from a short allow-list (today only `snake`) and `url` is the https
origin the feed is served from, at most 500 characters. Anything else
(http, an unknown kind, a bare string, a missing field) is 400 and leaves
the stored value alone. It is served on the public floor payload as
`liveFeed` (`{ kind, url }` or null). The older `liveViewUrl` (an https
page framed in a sandboxed iframe above "What is <name>?", `FloorLiveView`)
is deprecated: it still works for a floor that has only it, and it renders
nothing once `liveFeed` is set, so a floor never shows the game twice.

The browser never reads the owner's host. The app proxies the feed on the
marketplace router, public with no key, and the bodies are the upstream's
JSON passed through with `cache-control: no-store` to the browser:

- `GET /api/marketplace/:slug/live` is `${url}/state`, cached in memory for
  2 seconds per workspace with never more than one upstream fetch in
  flight per workspace, a 5-second upstream timeout, and a 502 JSON
  (`{ error }`) when the upstream fails, times out, or answers non-JSON.
- `GET /api/marketplace/:slug/live/games` is `${url}/games`, cached 30
  seconds per workspace.
- `GET /api/marketplace/:slug/live/history?game=&from=&limit=` is
  `${url}/history` with those three query fields passed through, cached
  30 seconds per workspace and query; `limit` is capped at 2000.

A floor with no feed answers 404 on all three; a private floor 403.

**The snake feed** (`kind: "snake"`, `SnakeLive`) is the shape the
telarchy-snake service publishes (its `docs/snake.md`, "The feed").
`/state` carries `game: { snake: [{x,y}] (head first), food: {x,y},
heading, length, step, deaths, complete, size, gameNumber }`, `grid` (the
board's side in cells), `gameNumber`, `next: { action, direction, decided,
seconds }`, `open: { step, decideAt, deadline, cells, directions:
{forward,left,right}, proposal: {id,number,url}, quotes:
{forward:{m60:{price,lead,marketId,reason?}},left,right} }` (one
proposal a step, an option per action: `price` the option book's
consensus, `lead` its price minus the best other option's, both null while
unpriced; the page still reads the older shape, one proposal per action
with `approved`/`declined` quotes, and treats approved minus declined as
the action's number),
`recentDecisions[]`, `recentTrades[]` (newest first, `{ handle, action,
cost, ... }`), `commentary`, `complete`, `nextGameAt`. `/games` is
`{ games: [{ number, size, startedAt, endedAt|null, steps, bestLength,
deaths }] }`; `/history` is `{ game: {number,size,startedAt,endedAt},
total, from, steps: [{ step, at, snake, food, heading, action, direction,
undecided, prices:{forward,left,right}, length, deaths }] }`, each step the
state after its move. Below, an action's **number** is its option's `lead`
on `m60`.

What LIVE draws, in the chart's slot under the same control row (the
segment toggle in the left cell, the metric caption centred), is exactly
two things and then the replay row (revised 2026-09-11, Viktor: "in live
keep only the visualziaiton not the trading buttons just the snake on the
grid.. and next move.. maybe text"):

1. **The grid** (`.snake-board`, an svg sized by `grid`): one cell per
   square, the snake as one rounded band along its cells with the head
   marked (a lighter disc and two eyes on the side it moves towards), the
   food a round dot, and **one shadow arrow per open action**
   (`.snake-arrow`, revised 2026-09-11, Viktor: "show 'shadow' arrows on
   the visualization of the snake that when clicked go to the
   corresponding proposal on which i can trade"): a thin arrow in the
   accent, shaft and head, from just outside the head's cell into the cell
   each of the three actions would move to (`open.directions`), so it reads
   as a move rather than as a mark floating in a square (revised
   2026-09-11, Viktor: a fat chevron "looks just as shitty"), each one a link to the step's proposal
   on this floor (`/{slug}/p/{open.proposal.number}`, opened in place,
   never a new tab). **How bright a chevron is follows its action's live
   number** (Viktor: "make the highlight of the arrows depend on how high
   the predicted impact is"): the highest draws at 0.9, the lowest at 0.3,
   the rest in proportion between them, an unpriced option at 0.3, and all
   three at 0.55 when fewer than two are priced or they tie. Once
   `next.decided` only the chosen action's chevron stays, solid. While no step is open
   the single arrow follows `next.direction` (the heading itself when
   that is unreadable, forward being the default). When a move's cell
   is off the grid there is no cell to draw a chevron in, so it is drawn
   as a bar along that wall instead (`.is-wall`, two points across the
   head's cell, inset by half a stroke), which reads as the wall it is
   and keeps the mark clickable; **nothing is ever painted outside the
   board**, strokes included, which is what the chevron pressed on the
   edge used to do (revised 2026-09-11, Viktor: "make better design and
   mainly so it doesnt behave weirdly near corners"). In replay
   the arrow is the entry's `direction`, solid, so scrubbing shows where
   it went (record in `notes/decisions/ui-conventions.md`). **A move
   transitions, it does not snap**: the band and the head are drawn as
   paths that transition to their new cells over 250ms (`transition: d`
   and `transition: transform` on `.snake-snake` and `.snake-head-mark`),
   and an arrow fades between its open and its decided shading rather
   than flipping (`transition: stroke-opacity`). Under
   `prefers-reduced-motion: reduce` none of that animates and every state
   change is instant. The grid keeps the last state it read while a poll
   is in flight or fails, so it never blanks between reads.
2. **The next move** (`.snake-next`), one left-aligned text line, the
   leader's action in words: "Next move: turn left in 0:31" while the step
   is open (the countdown from `next.seconds`, ticking by the second
   between polls, in `.snake-clock`), "Next move: turn left, deciding"
   from the moment that countdown would print 0:00 until the ruling lands
   (never over a stale read: a page that cannot see the feed says so
   instead, since it does not know that anything is being decided; and a
   step that has run out stays run out until the next one opens, because
   the service's own count came back 2, 1, 0, 1 across a boundary)
   (the service rules a moment after the step closes and opens the next a
   moment after that, and a line sitting on "in 0:00" for those seconds
   hides the one transition the page exists to show), "Next move: turn
   left, decided" once `next.decided` and until the move, and "Next move:
   continue forward (default)" while nothing is readable (`next` absent, or its action
   unreadable). Before the first poll the line reads "Loading"; after a
   failed one "Feed unavailable"; between games "Waiting for the next
   game".
Nothing else is in the segment: no tiles, no status line (length, game
number, grid size), no why line, no row of picks (both drawn and removed
on 2026-09-11, Viktor: "remove this whole thing from there its redundant
imo", the arrows on the grid already show the three moves and which
leads), no plain line under the title, no trade, no commentary, and no
button or link other than the three arrows on the grid and the replay
row's. No impact number is printed in the segment: the arrows' shading
is the only reading of the impacts.

**The feed drives the floor** (2026-09-11, Viktor: "make sure the whole
page is properly dynamic and reactive to the fast updating snake"). A
floor with a feed reads it every 2 seconds, and that read, not the
15-second floor poll, is what moves the page: when the feed's open step
changes or its `next.decided` flips, the floor payload is reloaded at
once, so the three new proposals are on the board and the ruling is on
the page within a poll of the feed, never a quarter of a minute later.
Clicking a chevron selects that proposal exactly as a board row does.
Opening a proposal, by a row, a chevron or its address, scrolls its head
into view: the page never lands a reader on a proposal whose title is
above the fold they are looking at.

**A pending row keeps its place for its whole life** (2026-09-11, of a
click on "Turn left" that opened the next minute's "Continue forward").
The proposals board orders pending rows by deadline, then by the feed's
own action order (Continue, Turn left, Turn right, the order the feed
lists an open step's proposals in, remembered per proposal from the first
read that names it), then by creation time and number. Nothing about a row's price, pool
or impact ever moves it, so the row under the pointer is the row a click
lands on. A row decided while the page is open holds its place for ten
seconds, its ruling showing where it stands, before it joins the decided
fold, and the next minute's rows are added under it rather than in front
of it; a row held that way does not count against the five-row fold.

**Every countdown on the floor reads one clock.** Under an hour a
deadline is m:ss everywhere it appears and ticks every second: the board
rows, the proposal head's chip and the next-move line under the grid all
read the page's clock, which runs at one second while a pending proposal
decides within the hour and at one minute otherwise.

**The reading's age is the newest reading's age.** The NOW cell's
"read 1m ago" is the true age of the newest reading the page holds,
ticking with that same clock. On a fed floor the feed's own step is that
reading whenever it is newer than the payload's last one (the open step's
`openedAt` and the game's `length`), so the cell reads "read just now"
the second the snake moves instead of waiting for the next floor poll.
The page keeps the newest reading it has SEEN, so the seconds in which
the feed names no step at all (one closed, the next not yet open) do not
make the reading it just showed a minute old again. **The open step's prices
read from the feed**: while a proposal the feed names is pending and has
one pair, that pair's approved and declined prices and its impact, on
the world cells, the impact chip and its board row, are the feed's
latest 60-move quotes, so a price moves within a feed poll rather than a
floor poll. A fed floor keeps the 15-second floor poll; the 5-second
near-deadline poll is for floors with no feed, since here the feed
reloads the payload at every step and ruling. A feed read older than 8
seconds says so on the next-move line ("feed 12s old") in place of the
countdown, which stops rather than count down a minute the page cannot
see.

**A proposal past its deadline reads as closed before the ruling lands.**
The moment `decideBy` passes on a pending proposal the ticket closes and
the two verbs are dead, with one mono line in the ticket's place,
"Trading closed at the deadline. The ruling lands in a moment; this page
updates on its own." (on a quiet floor that moment can be the lapse, said
the same way). That line is the same element from the close through the
ruling and it does not leave: when the ruling lands it reads "Trading
closed. Decided: approved." (declined and lapsed the same way), so the
rail never empties under a reader who was looking at the ticket. When the
ruling arrives the head carries it: the status
pill of the board fold (`.pubws-ballot-status`, approved, declined or
lapsed) before the number in the title row, and the clock fact reads
"approved 16:30:58" (the ruling's word and its instant to the second, in
the viewer's zone) instead of "decided 11 Sep". How the rest of the
decided page reads is a design in front of Viktor (the decided-proposal
canvas, 2026-09-11) and is not settled here.

**Telarchy style, not the external board's.** The segment is set in the
floor's own tokens and nothing else: the board's ground is the chart
area's (`var(--bg-secondary)`) with a hairline grid in
`var(--border-color)`, the snake in the floor's green (`var(--higher)`,
the Higher button's colour) with the head in the same green and the eyes
in the ground colour, the food in the floor's red (`var(--lower)`). No
glow, no shadow, no near-black board, no external font, no yellow (the
accent is amber and it marks only the countdown while the step is open).
The next-move line is in `var(--font-mono)` at the chart's headline
weight (600, tabular numerals, `var(--text-primary)`), the clock in the
accent while open and `var(--text-tertiary)` once decided. The replay
controls are the chart's range chips (`.mchart-range`: mono 0.68rem,
weight 600, no border, `var(--bg-tertiary)` when active) and the game
picker a select in the same type; the scrubber is the native range input
in the ticket slider's language (a 6px track in `var(--border-color)`
filled to the thumb in `var(--text-secondary)`, a 4px upright thumb in
`var(--text-primary)`). The grid takes the column's full width, the
next-move line sits under it, the replay row under that and wraps on a
phone. No multi-line text is centred.

**Replay** sits under the chips (`.snake-replay`): a game picker
(from `/live/games`, newest first, "Game 3 · 12x12 · best 9"), a
scrubber (a range input), play/pause, a speed (1x is one entry per
second, 10x), and a LIVE button that returns to realtime.

The scrubber indexes ENTRIES of the recording, not moves: `/history`
answers `total` recorded entries, `from` is the 0-based entry offset in
the recording, and each entry's `step` is the move number it records, so
on a partial game (`partial: true` in `/games`, a log that starts late)
entry 0 is a step far above 0 (game 1 on production: 38 entries for
steps 202..239, while `/games` says `steps: 239`). The scrubber's range
is therefore 0..`total - 1` of the loaded history, never the game's
`steps` from `/games`; until the first window is in, the scrubber is
disabled rather than sized by a number that does not index anything.
The newest game's first window is fetched with the games list so the
scrubber is usable at once; in realtime it rests at the end of that game.
Loaded entries are kept per game by entry index (`from + i`), and the
drawn entry is the one at the scrubber's index. Touching the scrubber or
the picker leaves realtime: the view loads the window around that entry
(`from`/`limit` 300, further windows fetched as the scrubber reaches
them) and draws that entry's snake and food on the same grid, and the
next-move line reads the move the entry records, "Step 231: turned left"
("Step 202: start" for an entry with no action, "Step 203: continued
forward (default)" for one the market left undecided). Picking a game
opens it at its first entry; Play from realtime opens the newest game at
its first entry. Play advances one entry per tick at the chosen speed and
holds at the game's last entry (the button reads Play again). LIVE drops
the replay, draws the polled state again and the next-move line returns.
The poll never stops during replay, so LIVE is instant. No library: the
range input and a timer.

### The announcements page

`AnnouncementsPage` (`/:slug/announcements`) is a poster head over a
document body: the workspace name as a tiny uppercase back-link, the
Fraunces headline "Announcements", and one left-aligned sentence naming the
guarantee, over a left aligned `.pubws-doc` column of hairline-separated
entries. Each entry's publication instant is set in `var(--font-mono)`,
which is the page's one structural device: in an append-only record the
time is the entry's identity. Each entry renders its body as markdown, its
published date, and, when the row was edited, both timestamps plus a
disclosure of what was first published. The compose box (the
`SubjectAbout` editor pattern) and the per-entry Edit control live here,
not on the floor; the edit box carries the warning that the original stays
public. Under 560px the row becomes two: the headline takes the width and
the day and arrow drop beneath it, because baseline-aligning a date against
a headline that has wrapped leaves it floating beside the first line. The
back-link is labelled with the slug until the workspace payload lands and
the real name replaces it; the label is uppercased, so on every floor
whose slug and name differ only in case the swap is invisible, and the
page never sits on a generic label while a 21KB call it does not otherwise
need comes back.

### The page ends: two lines and the door

**A floor stops explaining itself after the market.** The page above the
fold is the explanation and it SHOWS rather than tells: the company's name,
the number, its chart, and two priced sides a visitor can act on. **What the
company sells is behind an (i) beside its name** (owner ask 2026-09-10),
rather than standing as a line of prose under the name: a trader who came
for the number reads the name and the number, and the one who does not
know the company is one gesture from the sentence. **The (i) is an inline
disclosure, not a popup** (2026-09-11, Viktor, of the headline painting
across the open popup): a press, or Enter on the focused button, opens
the sentence as a block in normal flow directly under the name
(`.pubws-ws-what`, left-aligned, the column's width, readable at 400px),
pushing everything below it down; a second press closes it. Closed by
default, never on hover (a hover that moves the page is a page that
jumps), and nothing on the page overlaps it or is painted over by it. The
button carries `aria-expanded` and `aria-controls` for the block. The
identity block is therefore one line tall until asked, and "What is
<company>?" below the market still carries the full text. Below that, "What is this market?" carries the metric's
own definition, which is the settlement text a trader needs, and "What is
<company>?" carries the company's. That is already twice; a numbered
explainer and a pair of cards under it answered the same question a third
and fourth time (cut 2026-09-01, on YC's own reviews of pages that have to
introduce themselves: a stranger decides in five to ten seconds at the TOP
of a page, and repeating yourself further down is not extra clarity, see
`notes/yc-landing-explainer-2026-09-01.md`).

What survives is three cells on one hairline-ruled board (`.pubws-end`,
revised 2026-09-04; before it, two sentences and a separate email row),
full width under the three columns, each cell a mono small-caps label, one
sentence in the display face, and one control:

1. "NEW HERE?": "Telarchy prices what a decision does to a number before
   anyone commits." and the link "How it works" to the guide, because
   that is the one thing the working market cannot show.
2. "DO THE WORK": "Offer to do it and name your price. The owner pays in
   real money if the market says it clears." and the link "Offer a
   proposal", which SCROLLS to the proposal rail rather than duplicating
   its control.
3. "YOUR OWN NUMBERS": the company-facing slogan, "See what a decision
   does to your numbers before you say yes.", over the email field and
   its "Get set up" button (the same request as before: answered within
   days, never a waitlist; the confirmation reads "Got it. We will get
   back to you within a few days."). This cell is where the owner
   sentence lives on every floor.

The links are quiet accent text with an arrow, never buttons: the one
control this page wants pressed is above them.

The ballot, charter, decided list, pitch and footer are deliberately not
rendered; the API still ships them, so each returns as a render change.

## The guides (/guides)

The guides are content: `docs/guides/*.md`, served as markdown at
`/api/guides` for agents and rendered by `GuidesPage` for people. `/guides` is
the index, grouped by the category order the API already returns, each row a
hairline with the title as the link and its one-line description under it;
`/guides/:section` renders one guide through the same `.pubws-doc` markdown
style the legal pages use. Both live in the `.pubws` poster language, not in
the app chrome, because the reader is usually not signed in.

The routes are load-bearing beyond the page: the sitemap, `robots.txt`,
`llms.txt` and the site's own copy all point at `/guides`, and `guides` is a
reserved slug on the server. Until 2026-08-30 no route existed, so every one
of those promises resolved to the workspace-slug route and answered "There is
no market at this address"; a crawl of the live site found it. A link the
site advertises and does not serve is worse than no link, so the routes and
the advertisements change together.

### Guide document rendering

Each guide uses one 760px document column, with readable heading levels, paragraph spacing, lists, blockquotes and inline code. GitHub-flavored Markdown tables and fenced code render structurally. Wide tables and code scroll inside their own containers on small screens. Internal guide links retain the current preview base; relative Markdown guide links resolve to the corresponding guide route. The index and articles share the site top bar.

## Text contrast

The three text tokens meet WCAG AA for normal text (4.5:1) against
`--bg-primary` and `--bg-secondary` in both themes, and
`src/__tests__/contrast.test.ts` pins exactly those pairings. The one with no
headroom is `--text-tertiary`, which carries the small caps eyebrows and table
labels and is the token most likely to drift pale: 4.98:1 on the light
`--bg-primary` and 4.56:1 on the light `--bg-secondary`, against 6.21:1 and
5.84:1 on the same two surfaces in the dark theme.

Two pairings sit below that floor. `--text-tertiary` on the light
`--bg-tertiary` is 4.09:1, so that surface does not carry tertiary normal text.
Hairline borders are deliberately below it too; they are structure, not text,
and lifting them to a text contrast would turn the hairlines into rules and
change the design language. Check a new token with a contrast ratio, not by
eye.

## The marketplace (/marketplace)

`telarchy.com/marketplace` renders standalone in the same design language
(`.pubws-topbar`, Fraunces, mono numerals, one accent). The listings are
one hairline-ruled BOARD (`.mkt-board`), not a row of boxed cards: a grid of
`repeat(auto-fill, minmax(19rem, 1fr))` cells separated by 1px
`var(--border-color)` rules (a 1px gap over the border colour, closed by a
rule underneath), each cell on the page background, so the page reads as a
single instrument that grows with the list rather than as five panels. A
cell carries, in this order: the workspace name (Fraunces), one mono
caption line in small caps naming the metric and when it settles ("NET
REVENUE · SETTLES 30 SEP", the day in short form with the full date as the
hover title), the live number as the largest thing in the
cell (accent mono, 2.1rem), the owner's own one-line description (two
lines, then clipped), THE MARKET ITSELF as a full-width step-line spark of
the hero market's real trade history ending on the live-call dot (same
held-call semantics as the poster chart, value range padded 35% so a quiet
market still draws through the middle instead of along the floor of the
box), and a footer of the activity behind it as the market page's facts
row (`MarketFacts`): icons and bare numbers, never a sentence. Four facts
in this order, each a hover title that says what it counts: people =
participants, drop = the credits actually sitting in the pools of the
workspace's open markets (never the LMSR parameter), bars = trades this
week, page = proposals priced now. The drop counts every open book on the
floor: the baseline markets AND both branches of every proposal still on
the ballot (pending, trading open), since the credits behind a live
proposal are as much a trader's to win as the credits behind the baseline.
A decided or lapsed proposal's books are settled or voided and count
nothing; a floor whose ballot the payload does not carry (counts only)
sums its baseline markets alone. Numbers take the facts row's short form
(`4,200`, `25k`, `1.2m`). A fact that has not arrived yet is left out of
the row rather than shown as zero; the proposals cell appears only when
there are any. Hovering a cell lifts its background to `bg-secondary`;
nothing moves.

The grid is ordered by that liquidity, deepest first, because pool depth is
what a trader can actually win and the row of cards is where they choose.
The caller's own not-yet-public cards take part in the same order rather
than pinning to the front. Cards whose liquidity has not landed yet, or
that tie, keep their arrival order, so the grid does not jump as payloads
come in except to move a card up to its place.

The last cell of the board is always the listing cell, and it is the only
interactive one: it spans two columns where the row has room, and it is
where the company-facing sentence lives on the home page (owner pick
2026-09-04, cell B on the floor canvas): a mono small-caps label "YOUR OWN
NUMBERS", then "See what a decision does to your numbers before you say
yes." in the display face, then "List the metrics you care about.
Traders, human or AI, price every proposal against them; you approve on a
calibrated number.", then an accent "Create your own" link with an arrow.
The headline above the board stays trader-first; this cell is the owner's
door. Signed in the link opens the create dialog; signed out it is the
door to signing up. Listing is part of the marketplace, never a quiet line
underneath it.

**Card copy says only what is unique.** The per-card line is the
workspace's `description`, which is the workspace ONE-LINER (a few words
naming what this is), not a call to action. When every card recites the
same "propose a proposal and a price" pitch, the pitch belongs in the
page's lead paragraph and the cards say what only they can say: "Webcam
head tracker for sims, sold on Steam", "This platform, running on itself".

While the board loads it follows the rule in "While a page loads": the
board is drawn at once as GHOST cells in the exact geometry of the real
ones (`.mkt-ghost`, `role="status"`, `aria-label="Loading"`), and on a
full document load the server has already put the whole home payload in
the HTML (`GET /api/marketplace/home`, inlined as `#telarchy-home`), so a
visitor who arrives at telarchy.com sees the numbers in the first paint and
the ghosts only on a client-side return to the page. The home page makes
ONE request, never one per card; the season strip is part of the same
payload. When the payload lands the cells rise in 60 ms steps, top to
bottom (`.mkt-rise`), and each spark fades in once. Never a dot, never a
spinner, never a blank.

Above the board, the headline and the lead are the one place the whole
mechanism is stated in plain words. The headline is "Forecast a decision's
impact before it's made. Get paid when you're right." and the lead is
"Revenue, users, a game's score, updated by the people running them.
Forecast how each open decision moves them, free, human or AI. Or put your
own decision up and read the forecast before you act." The last sentence
is the owner's door: "put your own decision up" is a link to /owners, so
the page that speaks to forecasters first still hands an owner their route
in the first paragraph rather than in the footer. The subject of the
sentence is the decision, not the metric: what Telarchy sells is knowing
what a choice will do to the numbers its owner cares about before the
choice is made, and the owner need not be a company (a team or a game
lists its numbers the same way), so the headline never says "company".
Plain words on purpose: never "bet" (gambling to a cautious owner), never
"priced" (market jargon for what is simply a forecast), never "real
numbers" (nothing on the page is more real than a forecast); the mechanism
is explained once someone has clicked through. The lead names the metrics
and speaks to both sides, the forecaster (human or AI, always both) and the
person with a decision to put up. Never "one number": the pitch is the set
an owner cares about (owner rule 2026-08-27). The paid-proposal mechanism
belongs to each market's own page, not the front door. The season sits
between them as ONE line on hairlines (`.mkt-season`): the season name in
accent small caps, the clock in mono, the prize sentence ("$1,000 in real
money, split among the traders in proportion to their profit", the rule in
docs/seasons.md) with its operative words ("Free to enter, no purchase, no
stake"), and the door as a pill on
the right. A faint radial accent glow (`.mkt-glow`, 9% accent at the
centre, gone by 62%) sits behind the headline for depth; it is the only
gradient on the page.

## The cockpit (/admin)

`telarchy.com/admin` is the owner's own page: who showed up, where they
came from, who signed up, who is waiting, and what people reported. It is
the one surface in the product with an audience of one, and it reads the
platform-admin endpoints (`GET /api/admin/floor-stats`, `GET
/api/feedback`); the server gates both on the `platformAdmin` flag, so the
page is a renderer, never the guard.

Two rules it does not share with the public pages:

- **It is indistinguishable from a URL that does not exist.** Anyone who is
  not a platform admin - signed out, signed in, or curious - is bounced to
  the floor exactly the way any unrecognised path is. There is no "you are
  not allowed" screen, because that screen tells a stranger the page is
  real, and the page paints NOTHING until the check comes back: a headline
  reading "Admin" for the second the session check takes says the same
  thing.
- **Nothing is summarised away.** The waitlist is people awaiting a reply
  and a report is someone who hit a wall and took the trouble to say so, so
  both render in full, open reports first. Numbers are the only thing
  rolled up.

Everything else is the floor's language, deliberately: `TopBar`, one 760px
column, a Fraunces headline, tiny uppercase `.pubws-h2` labels, hairline
rows, mono numerals, one accent. A day row carries a hairline-thin amber
bar scaled to the busiest day (`.adm-bar`) rather than a chart, because the
question is "did anyone show up today", not the shape of a curve. Visitor
kind (person / server / proxy) is a neutral chip, not a colour code. The
page reloads itself every 20 seconds so it can be left open during a
launch.

The cockpit does not appear in its own numbers: `/admin` document loads are
not written to the visitor log at all (`functions/src/lib/visit-log.ts`), so
the owner reading the page does not raise the visits, uniques or top-pages
figures that are supposed to mean a stranger showed up. Filtering it on read
instead would move those hits into the "bot hits" count, which is a
different lie.

### The cockpit is tabbed, and only the open tab costs anything

`/admin` carries every operational surface there is: outreach, the X
workbench, the data room's plan entries, traffic, the people to pay, the earn
table, what the floors were asked, and what people reported. On one page that is a scroll nobody reads
to the bottom of, and worse, it is one page's worth of queries every poll
whether or not anyone is looking at them.

So the page is a set of tabs, one group of surfaces each, and **the page
loads and polls only what the open tab needs**. Opening the outreach tab
must not read the visitor log. This is the same rule as the one below,
approached from the other side: the cheapest query is the one nobody asked
for.

The open tab is in the URL fragment, so a reload comes back where the owner
was and a link can point at one surface.

### The cockpit may never take the site down

`/admin` is left open for hours, so its cost is a running cost rather than a
page load. Three rules keep it from becoming an outage, all of them learned
from one on 2026-09-09, when the page was left open overnight and the whole
site answered 503 for two hours
(`notes/incident-admin-poll-outage-2026-09-09.md`).

- **Every expensive cockpit read is cached server-side.** `floor-stats` and
  `journeys` each read the visitor log, which no page load can afford to do
  on demand; both are served from a short-lived cache, so a page polling
  every twenty seconds cannot ask the database more than once a minute.
  Data a minute old is the right trade for a dashboard nobody is watching
  in real time.
- **The page backs off when a request fails.** A failing backend must never
  be hammered by its own console: after a failed poll the next one waits
  longer, doubling up to five minutes, and a successful poll resets it. A
  poll is also skipped while the previous one is still in flight, so slow
  responses cannot stack.
- **The visitor log is indexed on time.** Every read of it is a time range,
  and it grows forever between purges.

The arithmetic behind the rules: production runs at most four instances with
a four-connection pool each, so sixteen database connections serve the whole
site. Four cockpit reads every twenty seconds, one of them taking seconds,
consume that budget on their own, and then every other request fails waiting
for a connection with `timeout exceeded when trying to connect`, which reads
like a database outage and is not one. A dashboard's running cost has to be
a small fraction of the connection budget, not most of it.

### Journeys: what one visitor did, in order

The counts say a stranger showed up; they never say what happened next. A
journey is one visitor's ordered path through the site in a single sitting,
which is the only thing on the page that can answer "where did they stop".
It is reconstructed from the visitor log already being written, so it covers
every anonymous visitor without a script, a cookie or a consent banner.

A journey is defined by four rules, and they are rules rather than
preferences because the owner reads a conclusion off them:

- **One visitor is one address AND one user agent.** An office or a phone
  network puts many people behind a single address, and merging them would
  invent a journey nobody took. Splitting one real person across two
  browsers is the safer error of the two.
- **Thirty idle minutes ends the sitting.** The next hit from that visitor
  starts a new journey, so somebody who returns the next day reads as two
  visits rather than one impossible six-hour session.
- **Where they came from is the FIRST hit's referer**, never the last. The
  question is which channel delivered them.
- **Only humanish rows take part**, by `humanVisitFilter()`, the same rule
  the counts and the public data room use. A crawler walking forty pages
  would otherwise be the most interesting journey on the page.
- **A step is a PAGE, and a page is a path with no file extension.** The log
  catches every request that falls through to the app, so a missing
  `/favicon.ico`, an `/assets/*.js` chunk and a scanner's `/lala.php` all sit
  in it beside real page loads. Reading them as steps made `/favicon.ico` the
  second most common place a visitor "stopped", which is the exact question
  this block exists to answer, so it may not be wrong. The rule is the
  extension rather than a list of known pages precisely because a page added
  next year has no extension and is therefore included without anyone
  remembering to add it, while a new asset type is excluded the same way.
  `/__/` infrastructure paths and the operator's own paths are not pages
  either, by the rule that already keeps the cockpit out of its own numbers.

A journey shows its entry path, its exit path, the steps in between with the
seconds between them, and its duration. A single-hit journey is a bounce and
is labelled as one: it is the most common outcome and the page must not hide
it inside an average.

Journeys are the cheap half of session replay: they give the order of pages,
not the clicks inside a page. The recorded-DOM version and what it would
cost is `notes/session-replay-2026-09-01.md`.

The cockpit shares no code with the deleted console.

## Reusing a component's classes: mind the cascade order

Several blocks (the proposal form, the account dialog, the Manifold import)
compose the ticket's own classes and then correct one or two properties.
`style.css` is one long file and the `.ticket-*` base rules live near the
bottom, so **a correction written as a bare single class loses to the base
rule it is trying to override**: equal specificity, later source position
wins. The rule fails silently, which is worse than failing loudly, because
the markup and the intent both read correctly.

Write such corrections with a descendant selector that raises specificity
(`.jobform .jobform-ask`, not `.jobform-ask`), or move the block below the
base rules. When a layout override "does nothing", check source order
before rewriting the markup.

An empty required numeric field floors at 4ch with a normal-weight
placeholder, so it reads as a field awaiting digits rather than as a
glyph; the hug-the-digits behaviour applies to amounts being actively
edited.

## When in doubt

- Strip color before adding it.
- Add whitespace before adding a divider.
- Use a hairline before using a card.
- Match an existing pattern before inventing one.

### What a market says about itself, and what your position is worth

Three facts sit at the right end of the Discussion / Positions / Trades
row, as three icons with bare numbers (people, drop, bars: the shape
Manifold's market header uses): how many
distinct participants have traded this market, how many credits are in its
pool (the liquidity put up by the owner and others, which is what winnings
come out of), and how many credits have been traded on it over its life.
Each carries its meaning as a hover; none is a sentence, because they are
counts on a row of counts.

A proposal shows the same three, about the branch on screen. A conditional
market is a market like any other: it has its own pool, its own traders and
its own traded credits, and none of them is the baseline's. So the row
follows the toggle, reading the approved world's numbers under "if
approved" and the declined world's under "if declined", and an owner's
Inject beside them injects into that branch and no other.

**A held position is a card under the bet buttons**, label over number,
four cells and a Sell button: "Your position" (side and shares), "Pays up
to" (one credit per share if the number lands at the range's edge the
position bets on, less in between), "Worth now" (what selling the whole
position would fetch at the market's current call, the honest analogue of
Manifold's expected value), "Spent" (what it cost) and "Profit" (the
difference, with its percentage, green or red). Sell opens the manage
dialog, which keeps the sell slider.

**The ticket says the most a bet can pay** as "Up to N cr +P%" beside the
breakeven and the slope: N is the shares bought (one credit each at the
range's edge), P the return on the spend if it lands there. It is a ceiling
with its condition in the hover, never the headline: the breakeven line
stays first, because a share's payout is linear in the settled value and
"to win N" alone, as Manifold prints it for a yes/no share, would read as
a promise here.

## The data room

`telarchy.com/data-room` (`DataRoomPage`, `.dr-*`) is the public actions log
and the one page that fixes its own palette: it renders on the site's dark
tokens whatever the visitor's theme is, because it is an instrument rather
than a page about the product. It sets `data-theme="dark"` on its own root
and takes the tokens that are already defined there; it does not invent a
second palette. Everything else is the site's language, amber accent
included.

It takes a wide 1180px column rather than the document's 760px. Under the
masthead and the stamp sits one filter row: a mono chip per kind that
toggles, the floor select, and the participant chip when one is set; every
change rewrites the URL query, and the page holds no filter the URL does not
show. The log is grouped by UTC day under a sticky mono rule in the accent,
and a row is a four-column grid: the time in tabular mono, the kind as a
coloured dot beside its uppercase name, the actor in bold as a filter button
followed by the sentence as the link to the thing, and the floor as a mono
filter button on the right. On a phone the time spans two lines with the
kind and floor above the sentence. A kind's colour is never the only place
its name appears. A row the minute's poll brought in is tinted in its kind's
colour until the pointer moves. Spec: `docs/data-room.md`.

**The tabs.** Under the masthead sits one tab row (`.dr-tabs`): Log,
What is planned, Documentation, Vision, mono uppercase, the current one
underlined in the accent, each a link to its address (`/data-room`,
`/data-room/planned`, `/data-room/docs`, `/data-room/vision`). The stamp,
the filter row and the log belong to the Log tab only.

**"What is planned"** (`PlannedTimeline`, `.dr-tl-*`) is the owner's
hand-written calendar: one time axis with a now-line and shaded past, a
segmented control for today, week and month, one row per open entry (title
line with a mono due meta, a thin bar beneath) with the soonest due on top,
eight rows shown and "All N" unfolding the rest, and under it the entries
without a date. It draws exactly what `GET /api/data-room/planned` returns
(`docs/data-room.md`, "What is planned"). Same head anatomy as the log's
day rules: mono label, the floor's name as the meta, hairline. The title is
never drawn inside or beside its bar; a row opens the entry's own words.
There are no controls on it for anyone: entries are written in the cockpit
(`/admin`, "Plans" tab, `.adm-*` language like the other cards). With
nothing planned it says "Nothing planned yet." in one line.

**Documentation** renders the guides (`GuideIndex`, `OneGuide`, the same
components as `/guides`) inside the room's column and palette, with the
room's tab row above them. **Vision** renders one markdown document the
same way an announcement body is rendered, under the tab row, with its
"updated" date in mono.

## The frontend never speaks HTTP directly

`src/lib/api.ts` is the one module that calls `fetch`. Everything else, page
or component, calls a method on `api`. That is not tidiness: the parity guard
that proves the UI has no capability the public API lacks reads that single
file, so a component doing its own `fetch` is a capability nobody can see. It
is also what makes "an assistant acting as you can do what you can do, and
nothing more" true by construction rather than by review.

`api-parity.test.ts` fails the build on a `fetch(` anywhere else under `src/`.

## Telling somebody there are credits to earn

Discovery goes where the lack is felt, not where attention is cheapest
(owner ask 2026-08-30; design
https://claude.ai/code/artifact/9794469a-2222-4fb9-938a-c519b412d771).
Two surfaces, no banners:

- **The bet ticket's ceiling.** The stake slider maxes at the balance, so
  a trader meets that wall the first time they try to say something
  meaningful. The line appears only when the stake has reached the
  balance, and names the number they could have rather than the tasks.
- **The balance itself.** Everywhere the balance is shown it links to
  `/earn` and carries what is unclaimed in the accent colour.

The Manifold link dialog is one action a step: name the account, then put
the code in the bio, with the code as the subject of its own step rather
than a word inside a sentence. The reassurance that the code can come
back out is said ONCE, on the success screen, because that is the only
moment it is both true and actionable; it is not on `/earn` and not on
the step that asks for it (owner ask 2026-08-31, "i dont want you to be
too spammy again").

`/earn` itself is the price list and nothing else: a row per earn, its
number, and the button that does it. Two of its rows are not one-time
grants and are shown differently: trading profit has no ceiling and no
number ("no limit"), and the daily streak shows the range its multiplier
spans. Neither counts toward "earned" or "left to claim", because that
tally has to mean a number somebody can finish.

What counts as "left to earn" is the unclaimed one-time rows PLUS today's
daily streak while it is unearned, added together. The streak was missing
from that sum until 2026-08-31 and the door vanished for anyone who had
finished the one-time list, though trading that day was still worth 25 to
100 credits to them; a door that cannot see a recurring earn is a door
that retires the moment the platform starts paying for habit.

The numeric earning hint disappears when nothing is available or the read
fails. The balance itself remains a Get credits link; it never claims an
unavailable reward. A signed-out visitor keeps the Manifold pitch in the top bar
instead, because that is the recruiting line that brought them.

Agents carries a visible Back link beside its heading. Entry through the shared Agents shortcut records the previous internal path, query and fragment; switching agent tasks preserves that destination. Direct entry falls back to the floor. All setup and management actions use the floor’s control radii, input surfaces, typography and focus states, including expanded key and funding forms.
