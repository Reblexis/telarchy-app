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

## Trading floor (root slug page)

`telarchy.com/<slug>` (`TradePage`, `.pubws-*` styles; `/marketplace/:idOrSlug`
canonicalizes here) renders **standalone** (as every page does) and renders
**the market and nothing else**. The page is the redesign of 2026-09-08
(record: the telarchy umbrella's `notes/floor-critique-2026-09-08.md`;
redesigned 2026-09-08, Viktor: nothing had to stay as before); the history
of the surface before it is `notes/decisions/ui-conventions.md`.

**The floor reads top to bottom in the order a trader decides**: the
question, the market's call and the reading, the two verbs with a payout
already quoted for a stake, one chart with the reading and the call's
history, then the people. A verb press opens the inline ticket; nothing
trades on one press. The left rail is the way to the next book and the
season; the right rail is the proposals board, in view on the fold. Selecting
a proposal turns the centre column into the pair. A visitor who does not own
the floor sees, under the floor identity, one door to running a floor for
their own company. Otto is one row, not a dock.

**Widths.** From 1400px the floor is THREE columns, 220 / 700 / 300 with
40px gutters, the page at most 1440 wide with 48px side padding, each rail
separated from the centre by a vertical 1px `var(--border-color)` hairline
so the three read as one instrument. From 1120px to 1399px it is TWO
columns, the centre at 680 beside the 300 proposals rail, and the left
rail's content moves (see "The rails"). Under 1120px it is ONE column in
this order: top bar, floor head (with the owner row or the run-a-floor
row), question, books row, numbers band, verbs and ticket, position,
chart, activity, Otto row, proposals (count line, rows, "+ Propose"),
season, announcements, standings, footer. Under 480px the same column runs
at 16px padding. The loading ghosts draw the same columns at every tier.

### The top bar and the account menu

The top bar is full-bleed, pinned to the viewport corners: the Telarchy
logo lockup at the landing nav's 3rem in the top-left, linking to the home
board, vertically centered; top-right, after the session check settles and
faded in so signed-in visitors never see a flash, in this order: "Earn
credits" as a text link carrying the total the earn table offers ("Earn
credits +10,025", see "Telling somebody there are credits to earn"), the
bell (see "The bell"), "Otto" (a text link opening his panel; owner and
signed-in participants only), the credits pill (`946k cr`, mono, the
tradeable balance), and the account menu: a round avatar (the account's
`image`, which OAuth providers populate and the menu can set, else
initials) opening a small popover that keeps only a glance (name, credits
to trade and credits earned, Discord, report a bug, the theme toggle,
"Account settings", log out). Signed out the right side is "Log in" and
"Sign up" only: there is no "Earn credits" for a stranger, because the
verbs panel's "free credits to start" line carries that offer where the
stake is. The bar owns a stacking layer above the floor rails so
the popover paints over them; the bar deliberately ignores the content
column. "Log in" never wraps. The workspace owner does not see "Earn
credits" on the bar of their own floor.

On a phone (640px and under) the bar stays at the top of the viewport while
the page scrolls: sticky, on the page background, one thin row. A floor is
nine screens tall on that display and the logo is the only way back to the
home board, so a bar that scrolls away leaves a phone reader with no way
home short of scrolling to the top. On wider screens it scrolls with the
page.

The mark at 2rem stands in for the lockup wherever the lockup does not fit,
which is every width under a tablet's 768px: the lockup is 4.4 times as
wide as it is tall, and the row carrying it measures 708px before the
viewport's own margins.

The logo is never what gives way. Whatever the viewport, the logo on it
keeps its own proportions and its full height: it is not squeezed narrower
than it is drawn, and a bar too tight for everything on it narrows the
controls instead. In order, the row sheds the Otto link (under 560px; his
row in the column is the door there) and then "Earn credits" (under 480px,
where it moves into the account popover beside the balance it already
prints). Under 480px the bar is the mark, the bell, the credits pill and
the avatar (signed in) or the mark, "Log in" and "Sign up" (signed out).
Every control survives every width, and no width pushes the bar past the
edge of the screen.

The theme toggle lives in the account popover, not on the bar: one quiet
row showing the theme it would switch TO (a moon on a light page, a sun on
a dark one). The site follows the OS theme until the visitor touches it; a
click flips between light and dark and the choice is kept per browser
(localStorage `telarchy-theme`, applied as `data-theme` on the html element
before first paint, so a reload never flashes the other theme). Clearing
the stored value returns to following the OS. Signed out, the toggle sits
at the foot of the "Log in" door. The bug, Discord and theme icons are no
longer drawn on the bar (removed 2026-09-08): the bar carries the balance,
the funding door, the bell and Otto, and everything about the account is
in the account menu.

The picture is saved via POST /api/auth/profile { image }: there is no
blob store in this stack, so the account dialog renders the pick to a
256px JPEG and sends it inline as a base64 data:image (png, jpeg or webp,
at most ~96KB encoded), and the endpoint otherwise accepts only http(s)
URLs (what OAuth providers populate), so the value can never become a
javascript: vector in an img src.

### The floor head, the owner row and the run-a-floor row

The floor identity is the first thing in the centre column
(`.pubws-head`), two lines and a row:

- **Line 1**: the tiny uppercase label "FLOOR" on the left and, right
  aligned, an icon row in mono of the floor's facts (`.pubws-head-facts`):
  "22 traders · 38k cr in pools · 5 books", each fact behind its glyph
  (a person for traders, a pool glyph for the credits, a book for the
  books; the pool glyph is a droplet, never a caret, which reads as a
  menu). The same glyph set is used by every icon row on the floor, the
  proposal rows included. The counts are the floor's,
  never one book's: distinct accounts that have traded on any of its
  books, the credits in every open book on the floor, the number of open
  baseline books. Facts are an icon row, never a sentence (owner rule
  2026-09-03).
- **Line 2**: the workspace name in the Fraunces display face at 30px, and
  under it the owner's one-liner in the secondary register ("This
  platform, running on itself."). A workspace with no one-liner prints the
  name alone. For the owner an "Edit" control follows the one-liner and
  opens the identity dialog (name, one-liner).
- **The owner row** (`.pubws-owner-row`), directly under the identity at
  EVERY width, owner only: one ruled row of the owner's three jobs, each a
  direct route, separated by middle dots: "Report a number" (opens the
  Report dialog on the book on screen; see "The numbers band"), "1 proposal
  needs your decision" (selects the oldest proposal that counts, see "The
  proposals board", and reads "No proposal needs your decision" in the
  tertiary register when none does), "Manage books" (opens the metric
  sheet, docs/owner-on-the-floor.md, dialog 2). On a floor whose every
  metric the platform syncs the first item reads "Readings synced hourly"
  in the tertiary register and is not a control, because there is nothing
  to report. The row is the owner's table of contents: every owner action
  the page carries is reachable from it without scrolling.
- **The run-a-floor row** (`.pubws-run-row`), in the same position, for
  everyone who is not the owner (signed out or signed in): one ruled row,
  "Run a floor for your company →" as the link and, on the same row in the
  tertiary register, "free · you fund books in credits · prizes paid by
  Telarchy". Pressing it opens a panel in place under the row, not a
  dialog: three underline fields, "Company name" (prefilled "Acme"), "A
  number you run on" (prefilled "Signups"), "Its value now" (prefilled
  "41"), and beside them (under them on a phone) a live rendering of a
  floor head built from the fields as they are typed: FLOOR · the name ·
  "What will be Acme's Signups this month?" · NOW 41 with the "Report"
  control in the cell (the previewed floor is owner-reported by
  construction, so the owner sees the control they would use) ·
  MARKET'S CALL "opens at 41", with the three cost facts as an icon row under it: "Floor ·
  free", "Books · funded in credits by you", "Proposals · paid in dollars
  only when you approve". A button "Create this floor" and the link "How
  Telarchy works" (to the guide) close the panel. Signed out, the button
  opens sign-up with the three fields kept for after it; signed in, it
  opens the setup door with the three fields prefilled. The row costs the
  trader one line and answers, on the first screen, what this is, what
  theirs would look like and what it costs. It replaces the "Your own
  numbers? Run a floor" door of the old left column and the "What is
  Telarchy?" paragraph, neither of which is rendered.

### Books on this floor

The floor prices a SET of metrics, and every one of them is one number read
on several dates, so the floor is a grid of books, metrics x dates. Every
open book is listed once, with its call, in one place per tier:

- **From 1400px the left rail carries the list** (`.pubws-books`): the
  label "BOOKS ON THIS FLOOR", then one row per open baseline book, the
  metric and its clock in text on the left ("Active traders · this month ·
  30 Sep"), the market's call in amber mono on the right and the book's
  pool in the drop register under it. The book on screen carries a 2px
  ink rule down its left edge. Rows are grouped under their metric's name
  when the floor has more than eight; under that they are one list,
  metric order first (see "Which market is THE number"), soonest date
  first within a metric. Pressing a row selects that book (one market id,
  see "The question line"). For the owner "Manage metrics and dates" sits
  under the list and opens the metric sheet.
- **Under 1400px the list is a row under the question** (`.pubws-books-row`):
  one ruled row reading "Books on this floor ▾ · 5 books · next settles
  8 Sep" (the count of open baseline books and the soonest settle day
  among them), opening the same list as a panel anchored to the row, with
  the same rows, the same ink rule on the selected book and the owner's
  "Manage metrics and dates". The panel closes on a pick, on Escape and on
  a click outside; the row is a `button` with `aria-expanded` and the
  panel a `listbox` of `option`s. Under 1120px, where the proposals board
  is a column below the fold, the row carries a second item after the
  books, "11 proposals · largest impact +3.7", which jumps to the board.

The two are one component rendered in two places, never two lists. The
chips above the question (`.pubws-chip`, the metric and date menus of
2026-09-04) are not rendered any more: the pickers live inside the
question sentence and the books list shows every book with its number,
which the chips never did.

### The question line: the pickers, and the sentence

The question is one sentence in the Fraunces display face at 32px,
left-aligned, directly under the floor head (under the books row below
1400px): **"What will be {company}'s {metric} {date}?"** Nothing sits
above it but the identity, and nothing under it but the numbers band.

- The scaffold words sit a register quieter (`.pubws-instrument-ask`);
  the metric and the date are the sentence's ink. The company is named
  possessively even though the identity block already carries the name,
  because the sentence needs its subject (a deliberate relaxation of the
  say-it-once rule, for grammar; the metric word still strips a leading
  copy of the company's name via `captionLabel`).
- **The sentence's metric and date are the pickers** (`.pubws-ask-word`,
  the dotted underline that marks a clickable word everywhere on the
  floor). Pressing the metric word opens the metric menu
  (`.pubws-chip-menu`): the floor's metrics in metric order, primary
  first, the selected one marked. Pressing the date word opens the date
  menu: the metric's open dates soonest first, each named by its clock
  and settle day ("this month · 30 Sep"). Menus close on a pick, on
  Escape and on a click outside; each word is a `button` with
  `aria-expanded`, the menu a `listbox` of `option`s, so a keyboard
  reader gets the same control. With one option the word is plain text
  and no control. The owner's "Manage metrics" and "Manage dates" entries
  are not in these menus: the owner row and the books list carry them.
- A named clock reads as its own adverb, "today", "this week", "this
  month", with no preposition; any other date reads as "on" plus its
  settle day ("on 30 Sep"), computed by `dateQuestionOf`. The word's
  tooltip carries the full settle instant.
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
  is no flat walk across the grid, and no cycle-on-click: a word that
  steps to "the next" book reads as random once there are more than two.
- **The question is an `h2` that is a block child of `.pubws-center`.**
  Controls on the line go INSIDE the heading, never in a wrapper around
  it: a flex row between `.pubws-center` and a heading drops it into a
  narrow column beside the numbers, four words tall and over the rail,
  because the heading's placement comes from rules that assume it is a
  block child of the column.
- **With a proposal selected the question moves under the proposal's
  headline and carries the condition** (see "The proposal view"): "If
  {who} is paid ${ask} to do this, what will {company}'s {metric} {date}
  be?", the same two pickers inside it, at 16px. There is no branch toggle
  in the sentence: both branches are on screen.
- **No per-horizon role caption, and no cross-horizon conflict mark.** One
  clock at a time, with a way to the others, is the whole rule, on the
  headline and on a proposal alike.

**Metric names are short handles.** A segment has to fit beside its
siblings and the metric word has to scan inside the sentence, so a floor
metric's name is the noun a reader would say
("LookPilot net revenue (USD)", "Active traders", "Implied valuation
(USD)"): about twenty characters before the unit tail, three of them side
by side in the 660px column. The definition, including the window
("trailing 30 days", "trailing 7 days"), lives in the description, which
the floor prints behind "Full definition" under the numbers band, and
which is the settlement text anyway. The window does NOT go in the name: `metricLabelOf` strips the
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
not printed in the sentence; the date menu, the books list and the
word's tooltip carry it, and the call's caption in the numbers band reads
"FOR <settle day>" (`settleNoteOf`). That division is also what keeps the year boundary
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
floor offers them one at a time through the pickers and the books list,
with no second chart shown at once.

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

### A proposal keeps the question, and says which world it is

Selecting a proposal keeps the floor head, the rails and the footer and
turns the centre column into the pair (the whole layout is "The proposal
view" below). The question does not disappear: it moves under the
proposal's headline as one line in the question's own voice, naming the
world the number belongs to:

```
        Ship an open-source reference trading agent with a tutorial
        If telarchy-agents is paid $200 to do this, what will Telarchy's
        Active traders this month be?
```

Everything the floor already does then works unchanged: the pickers change
the horizon and the conditional pair follows, because `pair` resolves by
the horizon on screen. The big numbers stay the metric's own numbers in
the metric's own unit, one per branch, never an "impact" abstraction that
exists nowhere else on the floor; the difference is stated beside them
with its unit. A proposal's effect on both horizons at once is deliberately
not shown (that is the cross-horizon conflict mark, which does not exist).

- **The question is rendered for both states**, not duplicated into two
  branches. A second copy is how the two drift.
- **The back affordance survives**: "← Back to the market" is the first
  line of the proposal view.
- **The world line is one sentence, not a label plus a value.** It reads as
  English because a stranger has to understand what the number is
  conditional on before the number means anything. "Is paid" names the
  approved world; the declined world is on screen beside it, so there is
  no "is not paid" phrase and no `WorldWord` toggle (removed 2026-09-08:
  both branches have their own ticket).
- **With one open horizon nothing changes**: same question, same line.

The pair's prices, histories and positions all come from the branch
markets, never the baseline: each ticket's probability and liquidity is
its own branch's, or payouts, the bet ghost and position worth are all
computed against the wrong curve. Positions refetch on a proposal change,
because they belong to the markets on screen.

A manager edits a proposal in place: the words save without touching the
market; the price only moves while nobody has traded the pair, and the
server says so plainly when it will not (docs/market-integrity.md, I1b).
Same three fields as posting one, same order.

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
is opened, and when that pair is unpriced the board prints "no price yet", exactly
as the pair band says "no price yet": the largest-delta fallback
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

**What the floor says.** Under the numbers band, before the settlement
line, one line reads "Settles 30 September 2026, or N/A (all bets
refunded) if there is still no reading" for a flagged metric that has no
reading yet; once a reading exists the line is not rendered, because the
call's caption already names the day. The flag travels on
`horizonHistories` as `resolvesNaUntilMeasured` beside `resetsEvery`, and
`measured` says whether a reading exists, so the page never infers either
from the points array (a resetting metric ships an empty array inside a
fresh period, which is not "unmeasured").

The metrics that use the flag ("Implied valuation (USD)" on both public
floors) are defined in docs/metrics.md.

### The numbers band and the settlement line

**The numbers band** (`.pubws-numbers`) sits directly under the question:
two cells on hairlines the way the home board draws its cells, a 1px
`var(--border-color)` rule above and below the row and one between the
cells, each cell a mono small-caps caption line first and the value under
it at the price size (`.pubws-price`, mono, tabular, 40px), both values
left-aligned in their cells so the two numbers start on the same vertical
rhythm. On a phone the band keeps two cells side by side and the caption
wraps to a second line rather than truncating. The call comes FIRST: it is
the thing traded, and the reading is its evidence.

- **The market's call** (`.pubws-stat--call`, amber): caption "MARKET'S
  CALL · FOR 30 SEP · IN 22 DAYS" (the day being forecast, which is the day
  before the settle instant, exactly as the date menu names it, and the
  countdown ticking by the minute with the exact UTC instant as its hover
  title; "SETTLING" once it is), the value, the metric's unit after it in
  text at the body size ("19.8 active traders"), and, when the call moved
  today, "▲ +0.3 today" in small mono (`▼` when it fell; nothing when it
  did not move). The countdown carries the distance ALONE: the exact instant
  is its hover title, never a second line of type.
- **The reading** (`.pubws-stat--now`, ink): caption "NOW · READ 35M AGO"
  for an owner-reported metric (`timeAgoOf` from the latest reading's
  instant, the exact UTC instant as its hover title), because a reading is
  only trustworthy with its age on it, and the value. A count of people or
  things prints as a whole number ("9", never "9.00"); decimals are for
  forecasts and money. A metric with no reading yet prints "no reading
  yet" in the value's place and no age. **For the owner the reading cell is
  also the reporting cell**: a "Report" button sits in the cell on an
  owner-reported book (value, time, note; the dialog shows the range and
  the last reading). A metric the platform syncs shows no button; its
  caption reads "NOW · SYNCED HOURLY · UNCHANGED SINCE 5 SEP" when the
  value has not moved and "NOW · SYNCED 20M AGO · HOURLY" when it has, and
  the caption links to the source, so the age line never contradicts
  itself.

The price carries the metric's currency symbol when the trimmed
parenthetical tail names one (e.g. "USD" -> "$"; the same prefix runs
through every numeral on the chart). A market with no price yet (no
liquidity) keeps the question, prints "no price yet" in the call's cell,
keeps the reading, and renders the verbs panel in its unfunded state, which
is where the offer to fund it lives (see "The verbs and the inline
ticket"); the books list is how a reader leaves it for a market that has
one.

**The settlement line** (`.pubws-instrument-sum`) is one line in the
tertiary register under the band: "Settles on:" then the metric's
settlement summary, clamped to one line with an ellipsis (two lines on a
phone, under 480px, where one line holds too few words to check). The summary is a
stored field on the metric beside its definition (the metric sheet's
"summary line"), written by the owner; a metric with no summary prints the
first sentence of its definition (`firstSentenceOf`) clamped the same way,
and a metric with neither prints no line. **"Full definition" sits OUTSIDE
the clamped text**, its own control pinned to the right end of the line
(the summary's clamp width is the line minus the control), never
truncated, so the clamp can never swallow it: pressing it expands, in place and left-aligned
(`.pubws-instrument-more`), the definition rendered as markdown (same stack
as the announcements body, plus remark-breaks so a plain newline is a line
break: owners write this text over the API and a collapsed paragraph
misquotes what the market settles on), the source URL when the metric has
one, the range, the settle instant, and "unchanged since" for a synced
metric. The definition is never paraphrased in the UI, because it is part
of the metric's definition and the words shown are exactly the words the
market settles on; every edit is on the record and rendered under the
definition so a trader can see whether the wording moved after they took
their position (docs/market-integrity.md, I1). For the owner "Edit" sits
beside "Full definition", outside the clamp too, and opens the metric
sheet (name, definition, summary line, range, dates with their two funding
numbers, final-after). **The definition is on screen once at every width**,
here and nowhere else: the old "What is this market?" block and the
left-column copy of the definition are not rendered.

### The verbs and the inline ticket

The verbs panel (`.pubws-verbs`) is one `--bg-secondary` panel under the
settlement line, three rows, the same for a signed-in trader and a
stranger:

- **Row 1, the stake and the book's facts.** "Stake" and one mono field
  prefilled 25 (`DEFAULT_STAKE`) with "cr" after it, then the preset chips
  "10 25 100 500"; a chip sets the field. The stake is remembered per
  session (sessionStorage), so a trader who bets 100 once is quoted at 100
  from then on. Right-aligned on the same row, a compact icon row of THIS
  book's own facts (`.pubws-facts`): traders, pool, last trade ("21
  traders · 38k cr · last trade 2h ago"), with the hover titles the icon
  rows carry everywhere. On a phone the facts row drops under row 3.
- **Row 2, the verbs.** Two equal buttons: green "Bet Higher ↑" and red
  "Bet Lower ↓" (`--higher` / `--lower`), the verb one line and, under it,
  its payout preview one line, never more (a verb that wraps reads as two
  buttons); the preview prices the stake in the field: "25 cr pays 63 cr at 50 · +38" under
  Higher (what the stake pays if the number settles at the top of the
  range, and the profit) and "25 cr pays 41 cr at 0 · +16" under Lower
  (at the floor of the range). The previews are quoted by the same LMSR
  preview the ticket uses (`previewTrade`, `src/lib/amm.ts`, pinned to
  the server by `amm-parity.test.ts`) for the stake in the field; they
  never divide the stake by the displayed call, and they refresh on every
  stake change. A quote in flight leaves the last figures in place and
  marks them stale (tertiary) rather than blanking.
- **Row 3, the range line**, tertiary, one line, states BOTH directions:
  "Range 0 to 50 · Higher shares pay 1 cr at 50, Lower shares pay 1 cr at
  0; in between, in proportion · you can sell any time". Short, because a
  sentence of explanation under a number reads as a warning rather than
  as its unit (owner, 2026-08-31); this line is the rule the two previews
  follow, and a Polymarket regular who expects "put 100, get X" has both
  on the buttons (critics' round 2026-09-08).

**Pressing a verb opens the ticket INLINE under the verbs** (owner ask
2026-08-28, replacing the modal of 2026-08-10): the panel grows in the
page's flow (`.pubws-ticket-inline`, a chromeless wrapper: the ticket's
OWN card is the one card, at the column's full width, after Manifold's bet
panel; a card inside a card is the shipped mistake this sentence exists to
prevent), so the question, the numbers band and the chart stay on screen
while the bet is composed and the composed bet's ghost draws on the chart.
The ticket is titled by the verb, the book and its clock ("Bet Higher ·
Active traders · this month") and carries, in mono rows, the quote it is
about to place: "Stake 25 cr", "Shares 63.1", "Pays at 50  63 cr", "Profit
at 50  +38 cr" (the top-of-range stop for Higher, the floor stop for
Lower), "Break-even  19.8" (the settled value at which this bet returns
exactly its stake, quoted by the preview service, never the displayed
call copied) and "Call after your bet  19.9" (where the book lands once
the bet is placed, the same landing the ghost draws), then the stake-and-value
line over the slider and the payoff line described under "The ticket", then
"Confirm Bet Higher" and "Cancel". The rows and the payoff line's stops are
one preview; they cannot disagree. The quote refreshes on every stake
change and the confirm is disabled while a quote is in flight. Pressing the
other verb re-seeds the ticket's side rather than being a dead click;
Cancel collapses it and drops the ghost.

**Signed out, rows 1 to 3 are identical**, and under row 3 one line reads
"Sign up to trade · free credits to start". Pressing a verb opens the
sign-up door inside the same panel, under the verbs, in the ticket's place:
"Sign up to place this bet", the chosen verb and stake echoed above the
form ("Bet Higher · 25 cr · pays 63 cr at 50"), the OAuth buttons
("Continue with Google", "Continue with GitHub"), "or", the email field
("you@example.com", "Continue") and "Already have an account? Log in". The
question and the numbers band stay on screen above it. After sign-up the
page returns to this floor and opens the ticket with that verb, that stake
and a fresh quote. The ticket is the pitch and signing up IS the intent
signal; there is no demo ticket for a stranger to compose (replaced
2026-09-08: the verbs already quote the stake, which is what the demo
ticket existed to show).

**An unfunded market never shows bet buttons.** A branch market can exist
with no liquidity, in which case it has no price and the server refuses
every trade against it. The floor borrows the baseline's call to DRAW such
a branch (a blank chart is worse than an honest prior), but that borrowed
number must not decide whether the page offers a bet: `funded` is carried
separately from it, and an unfunded market replaces the two verbs with one
line saying nobody has funded a book for this market yet and, for anyone
signed in, "Inject liquidity". Composing a bet and meeting "this market has
no liquidity" at submit is the bug this rule exists to prevent.

**The offer to fund a book appears ONCE per book on screen**, in the panel
where that book is traded: this one on the plain view, and the branch's own
column on a proposal (P6). The numbers band and the pair band print "no
price yet" and stop there, and the activity tab row's "Inject liquidity"
(which is deepening, not funding) is not drawn while the book on screen is
unfunded. An unfunded floor used to carry three of the same button on one
screen (reconciled 2026-09-08).

**The desk adds nothing around the verbs.** The wallet balance lives in the
credits pill and the account menu, not under the ticket; a held position is
its own row (see "Your position"); resting limit orders are listed inside
the ticket in manage mode.

### Your position

When the visitor holds shares in the book on screen, one ruled icon row
(`.pubws-position`) sits under the verbs panel, labelled "YOUR POSITION":
the side and shares ("▼ Lower · 702 sh", the glyph in the side's colour),
"pays up to 702 cr" (a share pays 1 cr at that side's edge of the range),
"worth 422 cr" (the AMM sell preview, live), "spent 500 cr" (net cash paid,
sells counted negative), the marked profit "−78.4 cr (−16%)" in green or
red (hidden while it is still zero), and a "Sell" button that opens the
inline ticket in manage mode, which keeps the held-position rows and the
resting orders. On a proposal the row sits under the ticket of the branch
the position is on. A trader holds ONE net side (see "The ticket"), so the
row is never two rows.

### The ticket

The mechanics below are the ticket's, whichever panel opened it (the plain
book's or a branch's). The bet ticket carries NO held-position row and no
resting orders (owner ask 2026-08-28: selling is the position row's job,
and the strip made the card tall); managing
a held position opens the same inline ticket in manage mode, which keeps
both. **Hiding those rows never means withholding the position from the
ticket**: the "New value" preview NETS against it, because buying the
opposite side closes the held position on the server first and the buy
prices against the post-close book. Handing the bet ticket an empty
positions list to hide the rows made it quote a landing the trade never
reached (owner report 2026-08-30), so the rows are gated on manage mode
and the data flows in both.

The ticket (`TradeTicket`) follows Manifold's bet-panel layout: a card
(`--bg-secondary`, 14px radius) with the Lower/Higher pills top left and a
Quick/Limit toggle top right. It is the one card on the page, and
exactly ONE element in it carries a fill, the confirm, which is what makes
that button unmistakably the action. Progressive disclosure: an untouched
ticket is only the two side pills, and the card grows when a side is
picked (the amount, the confirm, the fine print and, when it exists, the
price mode all appear once a side is chosen), so an untouched ticket asks
exactly one question.

**An untouched ticket still quotes both sides.** Each side pill carries
what a credit spent on that side can come back as (the ceiling below), so
a trader who opened the ticket on Higher can read Lower without switching;
the floor's two verbs outside the ticket quote the stake instead ("The
verbs and the inline ticket"), and the range line under them is the rule
the payoff line inside the ticket draws. Lower/Higher are two
words, not boxes; state is carried by colour and a fill on the chosen one,
with the floor's ▲/▼ glyph keeping its --higher/--lower colour even while
the word is quiet, since direction is the fastest thing on the page to read.

**The pill's quote is how much is on the table** (owner, 2026-08-31).
Each side pill says the most that can ever be won on it from where the
market stands, in credits: "up to 700 cr". There IS such a ceiling and it is exact,
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

This is the number the pills carry because it answers what a trader asks
next, which is whether there is anything here worth their time. A price in cents, and the multiple it
implies, are near-identical across every live market; the depth is not, and
"up to 12 cr" sends somebody away in one glance where "up to 3.4x" never
would. It also says which side the market maker is exposed on: 700 credits
behind Higher and 42 behind Lower is a description of where the cheap
opportunity is. The wording lives in `maxWinLabel` in
`src/lib/market-quote.ts`, the one place it is computed; the payoff line's
top stop is the same figure. What it replaced, the cents price, was
itself the fix for a trader who could not price a trade without pressing a
button first (`notes/quroe-churn-2026-08-27.md`); the verbs now price the
stake before the click and the payoff line prices the actual bet after it,
so nothing is lost by quoting depth on the pills.

The amount inside the ticket is one bare underlined mono numeral (no
boxed field; the preset chips live on the verbs panel's stake row and seed
this numeral) with a slider under it, its fill in the chosen side's
colour. The slider spans 1 cr to the trader's whole balance on a LOGARITHMIC track (a linear 0-to-balance slider
crams every bet a sane trader would place into the leftmost pixels once
the balance is in the thousands), so equal drag multiplies the stake
rather than adds to it; 1..100 cr gets about as much track as
100..10,000. Dragging snaps to two significant digits (150, 1,900) so the
numeral reads as a chosen stake, not a decoded pixel (1,943); the two
ends stay exact, 1 cr and the full balance. The mapping lives in
`src/lib/bet-slider.ts` and nowhere else.

The balance is the only ceiling, and the track ends there. Nothing else may
limit a stake: a screen that offers a size the server refuses reads as a
broken product rather than as a rule, so a size the ticket can reach is a size
the trade route accepts.

The win is a picture, not a table. Payout is linear in the settled value,
so what a bet is worth is a straight line, and the honest way to state a
line is to price points on it: the payoff line's scale gives five, the two
ends of the range and the quarters, each with the credits the bet wins or
loses if the number settles there. The confirm is full width, tinted by
the side, and always states what it will do ("Confirm Bet Higher", "Bet
25 cr on Higher" when the stake changed inside the ticket);
success flashes "Placed" on the button itself; errors render inside the
ticket. Held positions sit at the top of the ticket as rows (tinted
direction, mono payout, a Sell pill).

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

An untouched ticket has no bet to price, so it keeps the plain range bar
marked only at the current value, which is exactly where a share bought
right now breaks even, with the range's ends labelled underneath. A held
position IS a bet, so it is priced the same way, at what it actually paid.

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

### The chart

**One chart, the number's own, with the market's call drawn on it**
(`NumberChart`, `.pubws-numchart`), under the verbs panel (under the
position row when there is one). A newcomer reads the floor top to bottom:
what the number is, what the market says, what it reads now, then the
picture of both on one axis. The second chart, "how the call moved"
(`MarketChart` as a half-height strip), is not rendered any more (removed
2026-09-08): the call's history is the thin amber line on this one, and
two charts stacked with a stat each read to a Manifold trader as two
different numbers.

The control row (`.pubws-chart-cap`) carries the metric's own name as the
tiny uppercase label on the left (`captionLabel`, the leading company name
stripped) and the range words on the right; the stats are above, so the
row has nothing else. What the plot draws:

- **The reading**: an ink step line of the metric's readings up to a "now"
  rule, a dot at each reading and a dashed hold from the last one to now
  (the value in force), ending at the reading's value with its label. A
  step line read as a staircase; readings are joined by straight
  segments. **The vertical axis never magnifies a wobble into a cliff**:
  it spans at least a tenth of the largest value drawn (readings, markers
  and a pair), so a reading that moved a third of a percent draws as a
  small step and only a real move fills the plot.
- **The market's call over time**: a thin amber step line, the selected
  market's consensus since it opened (fetched by market id from
  `/api/marketplace/:id/markets/:marketId/history`; the series STARTS at
  the price the market opened at, stamped with its creation time, because
  an anchored pair traded once is otherwise a single point and draws as a
  cliff), ending at now with a small label ("19.8"). A market nobody has
  traded draws the line flat at its opening price.
- **The connector and the settle marker**: from the call's end at now a
  DOTTED amber connector runs to the settle marker, an amber dot at the
  selected market's settle instant labelled "19.8 · settles". The
  connector is dotted so it never reads as a forecast path; the future
  zone right of the now rule is lightly tinted.
- **The y range defaults to the data with padding**: the axis spans the
  readings, the calls and the markers in the window, padded a tenth
  above and below, never the whole settlement range (a 0-to-50 axis
  under a number that moves between 9 and 20 is a flat line). The range
  rails, a faint rule at the range's top ("50") and one at the bottom
  ("0"), are drawn only when they fall inside twice the data span, so the
  payout words on the verbs have a picture whenever the picture is
  legible; otherwise the axis label states "range 0 to 50" in the corner
  of the plot instead.
- **Settle labels sit INSIDE the plot**, to the left of their marker, and
  the plot keeps a right margin the width of the widest label, so "19.8 ·
  settles" is never clipped by the column edge and never overlaps the
  marker on a phone.
- **Other open dates**: every other open market of this metric as a grey,
  unlabelled dot at its settle instant carrying its call; one that falls
  outside the window is not drawn.
- **Hover or tap**: a crosshair snapping to the nearest reading on the
  past side (the dot sits on a real point of the line; the tooltip names
  the date, the reading and the call at that moment) and to the nearest
  market's call on the future side.
- **A legend under the plot** (`.nchart-legend`) names the marks in a few
  words each: "━ reading", "─ market's call", "● settles 30 Sep", and
  "● other open dates" only when there are any.

**The window follows the selected horizon** rather than stretching to show
every marker: roughly two days for a day market, a week for a week market,
a month for anything further, always ending at the selected settle
instant; the range words (`2D 1W ALL`, `1W 1M ALL`, `1M 3M ALL` by
granularity) override it, and a range longer than the metric's history is
not offered. **Switching books tweens the axis and the lines** over about
400ms, ease-out, rather than snapping, so a reader sees where the window
went. The composed bet's ghost draws on the chart: the ticket's landing
value moves the selected marker's ghost (`preview`). The lines draw
themselves on load with one set of keyframes and timing, and the dots,
markers and hold appear after them (none of it under reduced motion).

**A metric with no reading yet draws no line and no zero**: the past side
says "no reading yet", the hover says the same, the future side still
shows the markets' calls, and the N/A line under the numbers band says
what a bet on it is. A metric's creation is not a reading: a metric
declared `resolvesNaUntilMeasured` logs nothing until its first real
value, which is what lets its markets void rather than settle on 0. Hiding
the chart on such a metric read as the graph collapsing (owner report
2026-08-28), so it keeps its canvas in the component's own "no reading
yet" state with the market's marker.

**With a proposal selected the chart carries the pair** ("The proposal
view", P7): the reading in ink, the market's own call as the thin amber
step, and the two branch calls as green and red step lines from the day
the pair opened, ending at now, each with a dotted connector in its colour
to its own settle marker on the selected date; only the selected date's
markers are labelled, with the branch values and the difference at the
pair band's precision. Labels never collide: the dots stay where the values
are, the labels keep a minimum gap and stay inside the plot, and a label
that had to move gets a hairline leader to its dot. The legend becomes
"━ reading", "─ market now", "─ if approved", "─ if declined", and each
legend item toggles its line, so four lines on a phone can be read one at
a time. Whichever branch the markets price higher sits on top.

The chart is 100% of the centre column at every tier; on a phone the
canvas is taller and narrower, chosen at mount. The chart honours the
actual-vs-forecast rule below: a resetting metric shows only its own
period.

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

### Activity: Discussion, Positions, Activity

Under the chart sits the conversation and the tape (`.pubws-activity`):
three underline tabs, "Discussion (0)", "Positions (21)", "Activity (54)",
and right-aligned on the tab row the book's pool ("38k cr pool") and, on a
funded book, "Inject liquidity" (anyone signed in; an unfunded book is
funded from its own panel, once, see "The verbs and the inline ticket").
With a proposal on screen the row reads both pools ("295 cr · 329 cr") and
carries no control, because each branch is deepened from its own column.
**Activity is open by default**,
the newest eight rows, each: who, bought or sold N Higher or Lower at what
price, "moved the call 19.6 → 19.8", and when; then "Show all 54", which
expands the rest in place. A redemption is not a row here (see "The
ticket"). Positions lists every held position on the book, largest first.
Discussion is the thread, hairline rows, mono names, and the underline
composer for signed-in traders ("Sign up to join the conversation"
otherwise). The subject follows the one view: the baseline market's thread
normally, the selected proposal's proposal thread when one is open.
Reading is public via GET /api/marketplace/:idOrSlug/comments (Open
workspaces only); writing uses the same authenticated message endpoints
API participants use.

**For a proposal the tabs cover BOTH branch markets.** A proposal whose
trades all sit on the declined branch would otherwise answer "Activity
(0)", which reads as the trades having been lost. The panel fetches both
branches, sums the counts, merges the rows (newest first) and labels each
row with its world ("approved" / "declined", a small mono tag) so a bet is
never invisible because of which book the reader happens to be looking at;
the right side of the tab row reads both pools ("295 cr · 329 cr") and
"Inject liquidity". The baseline market has one world and carries no tag.

### The Otto row

Under the activity block sits one ruled row (`.pubws-otto-row`): the serif
O on the left, "Otto runs this market with you →" as the link, and, right
aligned on the same row, "connect your own AI" (to the account dialog's
"Your AI" section). A second line in the tertiary register: "Trades, funds
and reports as you." For the owner the row reads "Otto runs this floor with
you →" and "Reports numbers, funds books, decides proposals, all by chat."
Signed out the second line says reading is all he can do and what signing
up would change. The corner dock and the row at the foot of "What is
<name>?" are not rendered (removed 2026-09-08: the dock covered proposal
rows at the foot of the page); this row and the top bar's "Otto" link are
the two doors, and both open the one panel (see "Otto").

### The proposal view

Selecting a proposal (`#proposal=<number>`, see "The proposals board")
keeps the floor head, the owner or run-a-floor row, both rails and the
footer, and turns the centre column into the pair, in this order at every
width. The selected row in the rail carries the ink rule.

The pair band replaces the numbers band and the settlement line: the
numbers that matter here are the two branches' own, and the books row
belongs to the plain view.

- **P1, back and label**: "← Back to the market" on the left (deselects,
  restores the floor's address) and, right, "PROPOSAL #3 · PENDING ·
  EDITED 20 AUG" in the tiny uppercase register (the status word is
  PENDING, APPROVED, DECLINED or REMOVED; the edited day only when the
  words were edited).
- **P2, headline and the conditional question**: the proposal's title in
  Fraunces at 32px, then the question line (see "A proposal keeps the
  question").
- **P3, the work**: label "THE WORK", the first two sentences of the
  proposal's body, then "full scope", which expands the whole text in
  place (markdown, left-aligned); "full scope" sits outside the clamped
  text. The owner and the proposer get "Edit proposal" on the label line.
  Under the text an icon row in mono: "Asks $200 · paid to
  telarchy-agents · if approved" ("Asks $0" for a free proposal; the
  proposer's nickname always, because this is the payee). The owner reads
  what is promised before any button; the trader reads why the branches
  might differ.
- **P4, the pair band** (`.pubws-pair`): three cells on hairlines in the
  numbers band's anatomy. "IF APPROVED" and its call in green mono at the
  price size, under it that book's own facts as the floor's icon row
  (`MarketFacts`: traders, pool, last trade), because facts on the floor are
  an icon row and never a sentence; "IF DECLINED" and its call in red, its own line
  under it; "DIFFERENCE IN MARKET CALLS · ACTIVE TRADERS" (the metric's
  unit in the caption) and the difference, approved minus declined,
  signed, in INK, so green never reads as a verdict, with one tertiary
  line under it that says why the pair sits where it does in the trader's
  terms: "two thin books, both below the market's own 19.8". **The band
  has to add up at a glance** (critics' round 2 of 2026-09-08: "17.0,
  17.0, difference +0.04" reads as wrong): the two calls print with enough
  decimals to reconcile the difference (two when the difference needs
  them: 17.04, 17.00, +0.04), and the chart's branch labels and the rail's
  impact use the same rule (`formatImpact`: two decimals under 1, one
  decimal under 100, whole above; never "+0.0" for a number that is not
  zero). A pair with no liquidity prints "no price yet" in both call cells
  and "nothing to read yet" in the difference cell; the offer to fund a
  branch is in that branch's own column (P6), once. On a phone the three cells stay side
  by side at 22px numbers.
- **P5, the decision band** (`.pubws-decide`, `--bg-secondary`), owner
  only, and it PRECEDES the tickets in DOM order at every width, because a
  decision is laid out as a decision before it is asked. Left, one
  sentence in the product's terms: "Approving pays telarchy-agents $200
  now. The if-declined book is voided and stakes returned; the if-approved
  book pays at the real number. Declining is the reverse and pays
  nothing." Right, three controls: "Approve, pay $200" (the one ink
  button; it opens the payment review: recipient, the ask, the payout
  details the proposal snapshotted, the total, and the confirm "Approve
  and pay $200"; approving IS the payment, there is no later step),
  "Decline" (outline; opens a short review with the published-reason
  field, the charter promising the reason lands on the proposal, so
  "Decline proposal" stays off until a reason is typed) and "Remove" (a
  text link: voids both books and refunds everyone, after one confirm
  naming that; the word stays "Remove", never "Spam", because it names
  what happens to the books, not why). The sentence follows what the
  server does: a plain decline voids the if-approved book and keeps
  if-declined live to its target date; remove voids both. Everyone else
  sees one line in the band's place: "The owner decides. Approving is the
  payment." The band is rendered while the proposal is pending; a decided
  proposal prints its decision and day there instead ("Approved 2 Sep ·
  paid $200"). Nobody but a manage-capable session ever renders the
  buttons; the backend enforces manage regardless.
- **P6, two tickets side by side**, stacked (approved first) whenever the
  centre column is narrower than 900px, so on a laptop's 680 column and
  on a phone, each a verbs panel as in "The verbs and the inline ticket",
  headed by its branch word in its colour and lightly tinted in it: "IF
  APPROVED · 17.04" / "IF DECLINED · 17.00". Each has the stake row (the
  two fields mirror one another: a stake typed in either is the stake in
  both) and its own verbs with previews quoted from ITS branch's book.
  The branch name lives in the ticket's title, not inside the verb: the
  verbs read "Bet Higher ↑" and "Bet Lower ↓" with their one-line
  previews exactly as on the plain view, and a verb opens the inline
  ticket in that column titled "Bet Higher · if approved". Under each
  ticket its branch rule, in the product's terms, approved: "If the owner
  declines, this book is voided and your stake returns."; declined: "If
  the owner approves, this book is voided and your stake returns."; and
  under both, once: "The book left standing pays at the real number on 30
  Sep." A position on a branch sits under that branch's ticket (see "Your
  position"). An unfunded branch renders the unfunded state in its column,
  which is where that book is funded; a funded branch carries "Inject
  liquidity" at the end of its heading instead, so the column offers the
  control exactly once either way and the pair's activity row offers it not
  at all. There is no "switch" link and no pill toggle: both books are on
  screen with their own tickets (removed 2026-09-08).
- **P7, the chart**, with the pair drawn as "The chart" says.
- **P8, activity for the pair**, as "Activity" says.
- **P9, standings**: "TRADERS ON THIS PROPOSAL" (see "The rails") beside
  "TOP CONTRACTORS".

### The floor's live poll

**The floor's live poll (every fifteen seconds) refreshes DATA, never the
view.** The selected proposal, an open ticket, an expanded description and
the drawn chart are the viewer's state, and a tick may only overwrite
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

### The proposals board (right rail)

The proposals board IS the right rail (`.pubws-ballot`), in view on the
fold at every width where there is a rail, under the label "PROPOSALS" with
the right-aligned mono meta "impact on 30 Sep" (the date of the horizon on
screen), and one quiet line that says what a row is to a trader ("Each is a
pair of books: the number if approved, the number if declined. Trade
either.", `.pubws-ballot-why`). It renders for everyone, with proposing
routed to /signup when anonymous.

**The owner's rail is an inbox.** One more ruled line under the caption,
for the owner, in ink: "1 payment request ↓". It counts the proposals
that are PENDING, carry a non-zero ask, and were proposed by someone other
than the owner; the line is labelled by what it counts. A pending proposal
with a zero ask, or one the owner posted, is still pending and is not
counted. That line is the header of the group under it: those rows come
FIRST, each with an ink "decide" tag beside its ask, then a thin rule,
then every other pending row by absolute impact. With none the line reads
"No payment requests" in the tertiary register and there is no group and
no rule. The owner row under the floor head reads the same count as "1
proposal needs your decision" and selects the first row of the group. For
everyone else the line reads "11 open · largest impact +3.7" and there is
no group.

**Rows are sorted by absolute impact, largest first, ties by pool**
(revised 2026-09-08, superseding the pool-first order of 2026-09-02: the
board is the ranking the owner acts on, and what a proposal does to the
number is that ranking; the owner's inbox group above is the one
exception). A pair with no liquidity sorts last. Each row
(`.pubws-ballot-row`) is: the number in mono and the title (wrapping to at
most two lines); under the title, in small mono, the two calls of the pair
on screen, "if approved 17.04 · if declined 17.00" (at the pair band's
precision), beside the row's icon row, "$200 ask · 5,381 cr · by
telarchy-agents", in the floor head's glyph set (the pool glyph before
the credits): the ask ALWAYS shown ("$0 ask" when zero, hover title "paid
to the proposer on approval"), the credits behind both branches of the
pair added up (hover "credits behind the pair"), and the proposer named
only when they are not the viewer. The impact sits right-aligned in
ink mono, approved minus declined of the pair on screen; "±0" in the
tertiary register when the two calls are equal; "no price yet" with an
"Inject" link (anyone signed in) when the pair has no liquidity. The two
calls and the impact print for the pair of the horizon on screen (see "A
proposal ships every pair of the grid"). There is no "yours" tag on a row:
the foot says "9 of 11 are yours" for the owner, and a proposer's own rows
read as theirs because the proposer is not named on them.

**The foot** (`.pubws-ballot-foot`): the decided fold ("22 decided ·
show", below), the button "+ Propose", and one line: "Free to post. If
approved you are paid the ask in real money" plus ", plus 500 cr" when the
workspace sets a non-zero `proposalReward`. That phrase is the same one the
propose dialog prints on its confirm, so the two surfaces never disagree.
Under 1120px the board sits after the Otto row in the column, before the
season and the standings, because a proposal is the next thing to trade
and the standings are proof.

**A proposal has a number and an address.** Every proposal carries a
short number, `#7`, assigned in order of posting within its floor, never
reused and never renumbered when another proposal is removed, so a person
can name one in conversation ("what does #7 mean?") without reading a UUID
out of the API; the payload ships it as `number` beside `id`. The row
prints the number in mono before the title and carries no link control,
because **selecting a proposal changes the page's address** (owner
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
proposal is the bottom of the ballot. Before this, a stranger's first $0
proposal landed last, unmarked, and its author reloaded the floor and could
not find it.

**The board opens on the live ballot; decided proposals are folded away.**
An approved or declined proposal is history: nothing about it can be traded
on or influenced any more, and decided proposals carry the largest impacts,
so ranking them in with the pending ones buried the handful a visitor could
still act on under the archive of ones they could not. The list therefore
shows the pending proposals, and ONE hairline row at the foot of it stands
for the rest: the count on the left ("22 decided"), "show" or "hide" in
the accent on the right, and a chevron that turns. Expanded, the decided
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

**The board is a selector, not a second trading surface**: selecting a
proposal re-points the page's ONE market view at that proposal's
conditional pair and renders the proposal view, rather than growing a
smaller market underneath. Both branches are on the page with their own
tickets; there is no branch pill under the headline.

**"+ Propose"** opens a dialog that is the ticket's STRUCTURE,
not just its underlines: the USD ask is the hero numeric at the top
exactly where the ticket puts its bet amount ($ unit, mono, auto-width
underline), the title / pitch fields are quiet left-aligned underlines with
small left labels, and the whole deal rides the confirm button itself (the
cost belongs at the moment of commitment, on the final button, not only
near the first press; there is no separate line under the fields and no
facts table): `.ticket-go` carries a quieter second line
(`.ticket-go-sub`) saying that posting is free and what approval pays, the
exact phrase the board's foot shows so the two surfaces never disagree. Posting a proposal costs nothing; the only credits a proposer can
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
keeps only a glance (name, credits, Discord, report a bug, the theme
toggle, "Account settings", log out). **The
dialog IS the account.** It carries the picture (the avatar IS the
control: click, pick a file, frame it, saved), the username, the bio shown
on the public profile, structured payment details, the credit balance with
USDC top-up, payout wallet and withdrawal (`AccountCredits`, rendered only
where the instance has USDC settlement on, so a simulation instance never
shows a deposit box), the Manifold import, the prize season with its claim
button (`SeasonEntryPanel`; entering happens in the floor's season block and
on the public leaderboard, not here), and the password change, collapsed behind a
link because most sessions open this dialog for a picture or a payout
address. All of it is in the ticket language.

The dialog is FILED, not stacked. Five underline tabs across the top,
Profile, Money, Notifications, Your AI, Security, one section on screen at
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

**Your AI** (tab id `ai`) answers two different questions that share a
name. Above: the prompt for an agent YOU run, a copyable block that points
it at the floor's public brief. Below: the agents Telarchy runs for you
(`MyAgents`), which are separate participants with their own balance and
their own rank on the public leaderboard.

Each owned agent is one row, in the order an owner asks: has it done
anything, what has it earned, what has it got left. A bot that has never
traded says "no trades yet" rather than showing 0.00 profit, because most
of them have never traded and a confident zero reads as a result rather
than as a state. The earned number is the leaderboard's own number, so
this private view and the public board cannot disagree. Each row funds in
place: an amount and Send, out of the owner's balance, and the list
reloads afterwards so the balance on screen is the balance that exists.

Creating one is here too, with a starting-credits field, because the
credits leave the owner's balance in the same call that creates the bot
(`initialCredits`) and there is no other moment at which a bot is
reliably funded. The returned key gets a panel of its own that says it is
shown once: the server keeps only a hash, so a key not copied off that
screen is a key nobody can recover.

There is no button to take credits BACK. Transfers are self-initiated by
the API, so an owner cannot pull from a bot and the default bot key has
no wallet scope, which means a button would fail silently. Whether that
should change is an open rules question, not an oversight.

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

**Otto** is the floor's market maker: a named character who has read the
brief and will say what he makes of it. He also acts: signed in, he calls
the API with that person's own account, so the panel's closing line says
"he can do what you can do and nothing more" and one opener is a thing to
do rather than a thing to ask. Signed out, the same line says reading is
all he can do and what signing up would change; offering an action that
will come back 401 wastes the one minute a stranger gives you. Open he is a
panel in the same ruled language as the rest of the page: his turns are
flush left in the page's own voice, the visitor's are set apart by an
accent rule rather than a coloured pill, so it stays a document instead of
becoming a messenger app. Three openers name this floor's own subjects,
because a blank chat is a blank page. One line under the composer says the
opinions are his and not the company's. On a phone he takes the sheet; a
23rem panel on a 390px screen is a joke.

**Two doors, one conversation.** The Otto row in the column (see "The Otto
row") and the "Otto" link in the top bar open the same panel: the floor
owns the open state (`TradePage`), never a second Otto with half the
conversation. The row is where a reader's question forms, at the end of
the market; the bar link is for the reader who is anywhere else on a
nine-screen page. The serif O is his mark, deliberately not a circle with
a speech bubble in it, because a bubble is the universal mark of a support
widget and he is not support. The corner dock is not rendered (removed
2026-09-08: it sat on proposal rows and the chart's forecast corner at
the foot of the page, and a floating pill is easy to miss while reading).
The prompt for pointing your own AI at the same brief is a SETTING
(account dialog, "Your AI"); the row's "connect your own AI" link goes
there, and there is no other door on the page.

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

### The rails: books, season, announcements, standings

From 1400px the floor is three columns (revised 2026-09-08; the record of
the 1500px three-column cut of 2026-09-06 and its rails is
`notes/floor-critique-2026-09-08.md`). **The left rail is about THIS floor
and never about other people**: from the top, the books list ("Books on
this floor"), the season block, the announcements. Nothing on the first
screen ranks anyone, because every venue that works puts title, number,
chart and trade control first and nothing about other people above the
fold, and a board of the same dozen names at 25 visitors a day reads as
"no one is really using this" rather than as proof. The right rail is the
proposals board. **The left rail exists only in the plain market view**:
with a proposal selected the floor is two columns at every width, the
pair beside the proposals, because a proposal's page is about the
proposal and its two branches (Viktor, 2026-09-06). Between 1120px and
1399px there is no room for three: the books list becomes the row under
the question, and the season and the announcements move under the
standings in the centre column. Under 1120px everything stacks in the
order the section head gives.

**The season block** (`.pubws-season`): label "SEASON 0", one icon row in
mono, "$1,000 prizes · 23 days left · 22 in", the button "Enter the
season" (or "You are in"), and one line, "Free to enter. Prizes paid by
Telarchy." The season is ADVERTISED, not narrated (Viktor, 2026-09-06):
the prize is the hero figure, the terms are the icon row, nothing runs on.
For the owner one more line says what the floor costs, because an owner
reads "free to enter" as their own bill (critics' round 2026-09-08): "This
floor costs you nothing. You fund books in credits when you open them.
Approved proposals cost their ask, in dollars." The same three facts are
in the run-a-floor row and the footer's third cell for a prospective
owner; nowhere else. The one-line season advert under the stat row of the
old layout is not rendered.

**Announcements** (`.pubws-annline`) is the owner's disclosure surface
(`docs/vision.md`, "Workspace announcements"): label "ANNOUNCEMENTS" with
the corner control "All 5" (to `/:slug/announcements`) when the record
holds more than one, and nothing when it holds one, because a count that
always reads "All 1" is furniture. Under it the latest two entries, each a
row of headline and day, hairline above and below so it reads as an entry
in a ledger rather than a paragraph of prose. The headline comes from
`src/lib/announcement-headline.ts` and nowhere else. Hover and keyboard
focus take the headline and the arrow to the accent and nudge the arrow
2px (reduced-motion drops the nudge). The block renders nothing at all
when the workspace has never published one and the visitor cannot manage
it; it is present only when the Public group grants read
(`announcementCount` is absent on a counts-only floor). For the owner
"Edit" sits on each row.

**Attribution.** An announcement published by a participant who is not
the workspace owner carries `publishedBy`, and both surfaces print it: the
floor's one-row line appends the nickname after the day in the `when`
cell, and each entry on `AnnouncementsPage` shows "by <nickname>" beside
its timestamp in the same muted meta style as the edited marker. The
page's guarantee sentence says the record holds what the owner, or a
publisher the owner named, has said. Nothing is printed when `publishedBy`
is null: the owner's own words stay unlabelled.

**The standings sit under the Otto row, two blocks side by side on desktop
and stacked on a phone** (`.pubws-standings`): "TOP TRADERS" with the meta
"this market" and "TOP CONTRACTORS" with the meta "impact", the same
`.pubws-lb-head` anatomy (tiny uppercase label, right-aligned mono meta,
hairline, rows), THREE rows each plus the viewer's own row when they are
ranked below the three ("21 Viktor36 −66 cr", their rank in front), and
one foot under the pair: "IN = in the season · $ = prizes claimed · Full
leaderboard", the link to `/leaderboard`, never a board opened in place.
The three-column standings rails of the old layout, five rows a side, are
not rendered (removed 2026-09-08). Every mark on a row has a hover title
("IN" is in the season; the amber dollar figure is real prize money
claimed; the leaf is a linked forecasting record). A contractor row's
second line carries the proposal count, the live count and the dollars
earned ("19 proposals · 9 live · $1,080 earned"). **With a proposal
selected, the traders block becomes "TRADERS ON THIS PROPOSAL"** with the
meta "this proposal": the same rows, restricted to accounts with a
position on either branch of the selected pair, ranked by that position's
marked profit, the second line naming the position count; when nobody
holds one it says "nobody yet" in one row rather than hiding. The
contractors block does not change, since the contractor score is
workspace-wide by construction.

**The blocks share one anatomy.** Every block, rail or footer, opens with
a header row (`.pubws-lb-head`): the tiny uppercase label on the left, a
right-aligned mono meta on the right, a hairline underneath, rows
following directly. The meta says what the numbers are: "this market" over
the traders, "impact" over the contractors, "impact on 30 Sep" over the
proposals. Both blocks keep every ranking rule below and the
fifteen-second poll.

**Both standings are scoped to THIS workspace.** The traders block passes the
workspace to `/api/leaderboard` (`?workspaceId=<id or slug>`), so a
trader's number on a floor is the profit they made ON that floor; the
contractor board is per workspace by construction. The cross-workspace
board lives at `/leaderboard`, where the question genuinely is
platform-wide.

**Both leaderboards rank on what the market says right now, not on what
has settled.** The blocks show three rows each; both update on the
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
  "The score"). The floor's compact rows print the total only. The
  number is measured off the trades, not off the balance, so credits the
  platform handed an account never enter it. **No account is excluded.**
  Anyone who has ever traded in a public workspace is on the board. **A
  cancelled market is valued at its refund, not skipped**: a void pays
  back the net cash you still had in it, floored at zero (see
  `docs/vision.md`), so a market that was cancelled under you nets to
  exactly zero, while a realised gain you took out before the cancel
  stands. Trades on markets whose rows are gone entirely cannot be valued
  and count nothing. The row shows the signed profit in credits.
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
  self-granted.

**The board is at most five seconds behind the trades, and a reader's own
trade shows up on their next read.** The server-side board cache TTL is
five seconds: the floor polls every fifteen seconds, and a cache longer
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
AND on the floor's Top traders block.** While the season is a draft there
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

### The know block

The know block under the market is not rendered (removed 2026-09-08). Its
three sections went where they are read: "What is this market?" is the
definition behind "Full definition" under the numbers band; the
announcements are in the left rail; "What is <name>?" (`SubjectAbout`, the
product in its own words with its primary sources) and the "What is
Telarchy?" paragraph are answered by the floor's one-liner, the
run-a-floor row and the footer, and the metric's source URL is in the
definition disclosure. The API still ships the subject text and its links;
rendering them again is a render change, not a data one.

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

### The page ends: three cells and the door

**A floor stops explaining itself after the market.** The page above the
fold is the explanation and it SHOWS rather than tells: the company's name,
one line of what it sells, the question, the call and the reading, the
chart, and two priced verbs a visitor can act on; the settlement line
carries the metric's own definition one press away. A numbered explainer
and a pair of cards under it answered the same question again (cut
2026-09-01, on YC's own reviews of pages that have to introduce
themselves: a stranger decides in five to ten seconds at the TOP of a
page, and repeating yourself further down is not extra clarity, see
`notes/yc-landing-explainer-2026-09-01.md`).

What survives is three cells on one hairline-ruled board (`.pubws-end`),
full width under the columns, left-aligned, each cell a mono small-caps
label, one sentence in the display face, and one control:

1. "NEW HERE?": "Telarchy prices what a decision does to a number before
   anyone commits." and the link "How it works →" to the guide, because
   that is the one thing the working market cannot show.
2. "DO THE WORK": "Offer to do it and name your price. The owner pays in
   real money if approved." and the link "Offer a proposal →", which
   SCROLLS to the proposals board's "+ Propose" rather than duplicating
   its control.
3. "YOUR OWN NUMBERS": "List the numbers your company runs on and let
   people price them." then, in the secondary register, "Free. You fund
   the books in credits; prizes come from Telarchy.", over the email field
   ("you@example.com") and its "Get set up" button (the same request as
   before: answered within days, never a waitlist; the confirmation reads
   "Got it. We will get back to you within a few days."). This cell and
   the run-a-floor row are the two places the owner sentence lives on
   every floor.

The links are quiet accent text with an arrow, never buttons: the one
control this page wants pressed is above them.

The charter and pitch are deliberately not rendered; the API still ships
them, so each returns as a render change.

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
week, page = proposals priced now. Numbers take the facts row's short form
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
mechanism is stated in plain words. The headline is "Forecast a company's
metrics. Get paid when you're right." and the lead is "Revenue, users,
active traders, updated by the people running them. Forecast free, human or
AI, or list your own number and see the forecast before you decide." Plain
words on purpose: never "bet" (gambling to a cautious owner), never
"priced" (market jargon for what is simply a forecast), never "real
numbers" (nothing on the page is more real than a forecast); the mechanism
is explained once someone has clicked through. The lead names the metrics
and speaks to both sides, the trader (human or AI, always both) and the
person with a number to put up. Never "one number": the pitch is the set a
company cares about (owner rule 2026-08-27). The paid-proposal mechanism
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

`telarchy.com/data-room` (`DataRoomPage`, `.dr-*`) is a document, so it takes
the 760px column, not the poster's 660px. It is one scrolling page with a
sticky index of its own sections under the top bar, not a sidebar and not a
route per section: a sidebar is the thing that was deleted, and a reader of a
business document scrolls.

Its figures follow the page rules exactly: tiny uppercase section labels,
hairline rows with an amber rule behind a count, mono tabular numerals, and
charts hand-rolled as inline SVG (a bar per day, one line for a metric's
readings) rather than a chart library, because the only shapes needed are a
column and a line. A number the feed refused to compute renders as "not
published", never as zero. Spec: `docs/data-room.md`.

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
Three surfaces, no banners:

- **The bet ticket's ceiling.** The stake slider maxes at the balance, so
  a trader meets that wall the first time they try to say something
  meaningful. The line appears only when the stake has reached the
  balance, and names the number they could have rather than the tasks.
- **The balance itself.** Everywhere the balance is shown it links to
  `/earn` and carries what is unclaimed in the accent colour.
- **The top bar's earn door**, for signed-in accounts only.

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

Every one of them renders nothing when the account has nothing left to
earn, and nothing when the read fails. That absence is the rule: a
permanent "earn credits" affordance is furniture, while one that appears
because there is money on the table and leaves once it is taken is
information. A signed-out visitor keeps the Manifold pitch in the top bar
instead, because that is the recruiting line that brought them.
