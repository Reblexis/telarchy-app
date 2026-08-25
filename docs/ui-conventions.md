# UI conventions

How Telarchy's pages are laid out and styled. There is exactly one design
language left (owner decision 2026-08-19: the old GUI is gone), so this doc
is short: everything public is a `.pubws` page, and anything that does not
look like the trading floor is a bug.

## What was deleted, and why it is not coming back by accident

**2026-08-19 (Viktor): "could you get completely rid of the old gui for
now?"** The console went out of the tree, not behind a flag: `AppLayout`,
the sidebar, the nine workspace tabs (overview, metrics, markets,
proposals, sources, activity, settings, check-in, participants), the
console marketplace and leaderboard, the landing page, /start, /welcome,
/claim, /create-workspace, the guides and tutorial engine, /benchmark, the
platform-admin /admin and /agents cockpits, the API-key portal, the agent
portal, and the `/alpha` wall that used to hide them. (`/admin` came back
on 2026-08-19, rewritten in this language rather than restored; see "The
cockpit" below. Nothing else on that list has.) Git history is the
archive; every API endpoint they drove is still live and documented in
`GET /api/help`, so the operator drives those by hand until a surface for
them exists in this language.

Two consequences worth knowing before writing new UI:

- There is no app shell. Every page renders standalone and carries its own
  top bar. If you find yourself wanting a sidebar, you are rebuilding the
  thing that was deleted.
- There is no `page-content`, no tabs and no `max-width: 1080px` tier. The
  poster column is 660px (`.pubws-main`), a document column is 760px
  (`.pubws-doc`), a door is 26rem (`.pubws-auth`). Pick one of those.

## Every internal link is base-aware (2026-08-21)

The app is built twice, at `/` and at `/beta/` (docs/infra/deploy.md), so a
root-absolute URL written into a component silently walks a /beta visitor
back onto the production build (owner report 2026-08-21: "beta doesnt link
to other beta links.. all beta pages should link to other beta pages...").
The rule: internal navigation uses react-router `<Link>`/`navigate()`,
which inherit the basename; the rare genuine URL (a server endpoint such
as /api/data-room, a fetch of the served index or /api/waitlist) goes
through `withBase` from `src/lib/base-path.ts`, the only file allowed to
read `import.meta.env.BASE_URL`. All four rules are enforced by
`src/lib/__tests__/internal-links-ownership.test.ts`, which fails the
suite on any new root-absolute href, location assignment, or root fetch.

## Page layout

Every page is `<div className="pubws">` with a `.pubws-topbar` and one
centered column. The top bar carries the wordmark on the left and, on the
right, either a Log in link or the account menu; it matches the width of
the column beneath it (`--narrow` for doors, `--wide` for documents) so the
wordmark never floats aligned to nothing.

Horizontal padding belongs to the column (`.pubws-main`, `.pubws-doc`),
never to the blocks inside it, so left edges align down the page.

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

## Trading floor (root slug page)

`telarchy.com/<slug>` (`TradePage`, `.pubws-*` styles; `/marketplace/:idOrSlug`
canonicalizes here) renders **standalone** (as every page does now) and in the
minimal phase (owner decision, 2026-08-09) it renders **the market and
nothing else**: full-bleed top bar pinned to the viewport corners (the
Telarchy logo lockup at the landing nav's 3rem in the top-left, linking
home, vertically centered; top-right, after the session check settles and
faded in so signed-in visitors never see a flash, either a Log in link or,
when signed in, the account menu: a round avatar (the account's `image`,
which OAuth providers populate and the menu can set, else initials)
opening a small panel with the handle and email, credits to trade and
credits earned, a picture setter, a link to /account and Log out. The
picture is a URL, not an upload (no blob store in this stack), saved via
POST /api/auth/profile { image } which accepts http(s) only so the value
can never become a javascript: or data: vector in an img src. The bar owns
a stacking layer above the floor rails so the panel paints over them; the bar deliberately ignores the 660px content
column, which left the logo floating aligned to nothing), one headline naming the prediction (the metric's
name alone, its parenthetical unit tail trimmed for display; no settle date
beside it, since the name carries its own horizon and at a year boundary a
settle date reads a day late, the 2026 period ending at the instant January
1 begins) set in the Fraunces display face (an exception to the
tiny-uppercase-label rule: it is the page's only statement of what the
market is), the consensus as a large mono
price with a since-open chip (both carrying the metric's currency symbol
when the trimmed parenthetical tail names one, e.g. "USD" -> "$"; the same
prefix runs through every numeral in the chart), and the prediction
chart (`MarketChart`: one amber step line of the market's call over its
lifetime, gradient fill, labeled end dot, crosshair; the series STARTS at the
price the market opened at, stamped with its creation time, because a pair
that opens anchored and has traded once is otherwise a single point, which
draws as a flat line and a cliff at the live dot and reads as if every trade
happened at once (owner report 2026-08-19); breaks out of the
column to min(92vw, 760px), capped so the whole anonymous poster through
the CTA fits a 900px-tall desktop viewport; phones get a taller, narrower
canvas chosen at mount). The page is two-tier by intent (owner decision,
2026-08-09): the anonymous view is a poster free of explanatory context
(no hook sentence, no settle fineprint, no captions) with exactly one
action under the chart: the trade ticket itself, in demo mode. A newcomer
composes a real bet (side, amount, payout line, the impact ghost on the
chart all work), and only the confirm differs: it reads "Sign up to bet"
and routes to /signup. The ticket is the pitch; signing up IS the intent
signal, and the signed-in view becomes the trader's desk. The desk adds,
around the trade ticket only, live position worth on each held row
("worth 31.2 cr +6.2", green/red delta from the AMM sell preview, the
delta hidden while it is still zero) and the trader's resting limit
orders. The wallet balance lives in the account menu, not under the
ticket (owner direction 2026-08-10).

The ticket itself follows Manifold's bet-panel layout (owner direction
2026-08-10, superseding the 2026-08-09 "not a panel" decision): a card
(`--bg-secondary`, 14px radius) with the Lower/Higher pills top left and
a Quick/Limit toggle top right. The amount is one bare underlined mono
numeral (no boxed field, no stepper chips; owner direction same day)
with a slider under it, its fill in the chosen side's colour. The
slider spans 1 cr to the trader's whole balance (the per-market cap
went 2026-08-11) on a LOGARITHMIC track (user report 2026-08-21: a
linear 0-to-balance slider crams every bet a sane trader would place
into the leftmost pixels once the balance is in the thousands), so
equal drag multiplies the stake rather than adds to it; 1..100 cr gets
about as much track as 100..10,000. Dragging snaps to two significant
digits (150, 1,900) so the numeral reads as a chosen stake, not a
decoded pixel (1,943); the two ends stay exact, 1 cr and the full
balance. The mapping lives in `src/lib/bet-slider.ts` and nowhere
else. The win is stated as breakeven plus slope, never as the
at-the-range-edge maximum: payout is linear in the settled value, so the
rows read "New value" (with the delta the bet would cause), "Wins above
$74,300", "Each $10k beyond +3.1 cr", as a small hairline-ruled table.
The confirm is full width, tinted by the side ("Bet 25 cr on Higher").
Under the bet buttons sits the conversation (owner ask 2026-08-11): a
quiet "Discussion (N)" toggle (renamed from "Comments" 2026-08-24, Viktor) expanding the thread in place, hairline
rows, mono names, and the underline composer for signed-in traders
("Sign up to join the conversation" otherwise). The subject follows the
one view: the baseline market's thread normally, the selected job's
proposal thread when one is open. Reading is public via
GET /api/marketplace/:idOrSlug/comments (Open workspaces only); writing
uses the same authenticated message endpoints API participants use.

Beside Discussion sit Positions and Trades. **For a contract they cover
BOTH branch markets, not the branch on screen (owner report 2026-08-21:
"why dont i see any trades made on the conditional markets").** A
contract opens on "if approved", and a contract whose trades all sat on
the declined branch answered "Trades (0)", which read as the trades
having been lost; they were one toggle away the whole time. The panel
fetches both branches, sums the counts, merges the rows (trades newest
first) and labels each row with its world ("if approved" / "if
declined") so a bet is never invisible because of which world the
reader happens to be looking at. The baseline market has one world and
carries no label.

A manage-capable session (the owner) gets a decision bar on a selected
job (owner ask 2026-08-11): "Approve, pay $N" as the one money-colored
pill, and Decline, which opens the published-reason field in place (the
charter promises the reason lands on the proposal, so the confirm stays
off until a reason is typed). Nobody else ever renders the bar; the
backend enforces manage regardless. Both rails carry the same top margin
on desktop so the "Top traders" and "Jobs" headings sit at the same
height (owner direction 2026-08-11: symmetry).

A trader holds ONE net side (owner decision 2026-08-11): buying the side
opposite to a position you already hold first closes that position, so
nobody ends up holding both higher and lower (a guaranteed-return bond
bought at a doubled spread, pure value leakage to the market). This is
engine behavior (`executeTradeInTx` netting, functions/src/services/
trading.ts), not UI: the trade path sells your opposite position before
executing the buy, and the proceeds return to your balance. Limit fills
skip netting (they build a position mechanically). Buying the SAME side
you hold just accumulates.

The "New value" fact row is an INPUT (owner direction 2026-08-11:
betting towards a value without a new field): the numeral that answers
"where does my bet leave the market" also accepts the answer as the
question. Focus it, type a target, and the ticket sets the side
(auto-flipping across the current call) and the amount to whatever
reaches that value, capped at the per-market maximum; blur returns the
row to the derived display. The dotted underline is the affordance.

**The value the ticket shows is the value the trade lands on** (owner
report 2026-08-22: it wasn't). Two rules keep the promise. (1) Every buy
preview replays the netting close first: the ticket's math starts from
the post-close book whenever the trader holds the opposite side, because
that is the book the server prices the buy against (`src/lib/amm.ts`,
pinned against the real server functions by
`src/lib/__tests__/amm-parity.test.ts`). The bet ceiling likewise counts
the close's proceeds, since the server lets a flip spend them. (2) A
typed target is placed as the server's `{targetValue, maxBudget}` mode,
which lands ON the target (budget permitting, netting and buybacks
included) rather than a client-approximated `{direction, amount}` buy;
the confirm reads "Bet to $X, up to N cr" so the instruction states the
landing. Editing the side or amount by hand returns to a plain budget
buy. When resting limit orders fill behind a trade, the page shows
`settledConsensus` (where the market came to rest), not the trade's own
post-price.

Conditional (job) markets open ANCHORED (owner decision 2026-08-11):
a fresh pair opens at the baseline market's current value rather than
the range midpoint, and the approved branch opens at baseline minus the
job's ask, because approval burns the ask into the resolving metric the
day it is paid. **The ask-adjustment applies only to a metric that the payment
actually moves** (corrected 2026-08-15, tightened the same day): the name
must carry a currency tail, the same "(USD)" convention that puts the $
on the headline, AND name itself "net", the owner's word for a number
already reduced by what he pays out. A gross revenue metric is not moved
by the payment at all, so its pair opens unadjusted; subtracting the ask
from it would clamp the approved branch at the range floor, which is the
same failure as the headcount case below wearing a different hat. Subtracting a
dollar ask from a metric counted in people or hours is a category error:
on Telarchy's own workspace it drove every approved branch to the range
floor and printed the same fake negative impact on every contract, which
a two-horizon board made impossible to miss. A non-monetary metric
anchors both branches at the baseline and lets traders price the whole
difference.

**A near-horizon baseline market opens at the metric's own current value**
(2026-08-15), not at the range midpoint, when its period ends within 45
days. Over a week the number cannot travel far, so a midpoint open is not
a forecast, it is an arithmetic error that hands credits to whoever reads
the metric first: LookPilot's weekly market opened at $75,000 against a
live $45,339. Beyond 45 days the midpoint stands, because today's reading
genuinely is not an estimate of the settle value (LookPilot's charter
argues exactly this for its December market) and the operator re-anchors
those with a published trade instead. Solvency uses the same
`anchoredMarketState` sizing the conditional pairs use. Solvency is preserved by sizing the LMSR b down so the
subsidy exactly covers the anchored worst case (`anchoredMarketState`
in functions/src/lib/amm.ts); an off-center open buys its anchor with a
slightly thinner book, never with unminted credits.

Progressive disclosure survives the card: an untouched ticket is only
the two side pills, and the card grows when a side is picked. Limit mode
swaps in a price input in the same underlined register and the confirm
becomes the whole instruction ("Buy Higher with 25 cr under $65,000"),
with breakeven exactly at the limit; see docs/limit-orders.md.
Below the ticket, the desk shows the jobs board (paid-jobs
round 1, owner charter of 2026-08-09) under a bare "Jobs" label. **One
number per job** (owner decision: as few numbers as possible): the impact,
which is if-done minus if-not-done, green/red, "open" while unpriced, under
a single right-aligned column label ("impact if done") rather than a label
per row. The two branch values are not shown. Rows carry the title, the
proposer, and the USD ask (the two required facts of a job), and are ranked
by impact, since the ballot is a ranking the owner acts on. **The board is
a selector, not a second trading surface** (owner decision, 2026-08-09):
selecting a job re-points the page's ONE market view and ONE ticket at
that job's conditional pair, rather than growing a smaller market
underneath. Both branches are on the page (owner decision 2026-08-10:
every proposal branches into two worlds and both are visible): an
"if approved" / "if declined" pill toggle under the headline picks which
branch the view shows and the ticket trades (approved by default, green
for approved, red for declined, matching the chart), and the chart draws
the OTHER branch as a quieter line in its colour, so the vertical gap
between the two lines is the priced impact of approving. In that mode the headline becomes the question the
market actually prices, naming who is paid and how much ("What is
<metric> @ <date> if <proposer> is paid $<ask> to do: <task>", the task in
ink and the rest a register quieter), the job's own description sits under
it as the details, a small "← <metric> @ <date>" link above returns to the
baseline, the price is the selected branch's call, the chip becomes the impact
(approved minus declined, the same number whichever branch is on screen)
instead of "since open", and the chart draws the branch's
own history (fetched per market from
`/api/marketplace/:id/markets/:marketId/history`, falling back to the
market's current call as a single point when nobody has traded it yet, so a
fresh job shows a chart rather than blank space). The ticket trades that
branch: its probability and liquidity must come from the active market, not
the baseline, or payouts, the bet ghost and position worth are all computed
against the wrong curve. The description is NOT repeated under the job row;
it belongs with the question. Positions refetch on every switch, because
they belong to the market on screen. **The floor's live poll (every five
seconds) refreshes DATA, never the view** (owner report 2026-08-13): the
selected job, the branch toggle, an expanded description and the drawn
chart are the viewer's state, and a tick may only overwrite prices and
histories in place. Two specific rules follow: view state resets on a job
change and nowhere else, and a history refresh never blanks first, or the
chart collapses to its single-point fallback for a frame and reads as a
blink. "+ Suggest a job"
opens a dialog that is the ticket's STRUCTURE, not just its underlines
(Codex redesign, revised 2026-08-10): the USD ask is the hero numeric at
the top exactly where the ticket puts its bet amount ($ unit, mono,
auto-width underline), the title / paid-to / pitch fields are quiet
left-aligned underlines with small left labels, and the whole deal rides
the confirm button itself (owner direction 2026-08-12: the cost belongs
at the moment of commitment, on the final button, not only near the
first press; supersedes the 2026-08-10 separate quiet line under the
fields, still no facts table): `.ticket-go` carries a quieter second
line (`.ticket-go-sub`), "500 cr to post · 1,000 cr back if approved",
the exact phrase the board shows under "+ Suggest a job" so the two
surfaces never disagree (the 1,000 is the
500 stake returned plus the workspace's 500 proposal reward). Color only speaks as state: accent focus, red errors and the
full title counter, green ONLY on the placed flash; the confirm is the
neutral `.ticket-go` whose main label progresses "Suggest job" (disabled,
invalid) to "Suggest job for $N" (ready) to "Submitting..." to "Added to
ballot" (green flash, sub-line hidden, then the dialog closes). A $0 job is a valid job
(owner decision 2026-08-10) and needs no payment details; a non-zero ask
with no account payment details shows a warning and disables the
confirm. The ask is sent as `askUsd` and stored on the proposal; when
non-zero it is *also* composed into the title as "$N: ..." because that
reads well and travels into the activity log and share text, but the
stored column is what anything financial reads. Rows prefer `askUsd` and fall back to
parsing the title only for proposals created before the column existed.
There is no paid-to field
(owner direction 2026-08-10, second pass: payment details belong in
account settings, not in a job): the account settings dialog edits them,
and the server refuses a paid job without them.

The account itself is a full dialog (`AccountDialog`, owner direction
2026-08-10: the corner popover got too cramped for management; spawn a
whole dialog like the proposal one). The avatar's popover keeps only a
glance (name, credits, "Account settings", log out); the dialog carries the picture (the avatar IS the control:
click, pick a file, saved), the username, structured payment details,
and the Manifold import, all in the ticket language. Payment details are
STRUCTURED (owner direction, same day: providers, not one broad text
field): a pill row picks the provider (PayPal, Bank, Crypto, Revolut,
Wise, Other), each provider asks only for its own fields (crypto adds a
network pill row), and the server validates per provider (IBAN mod-97,
per-network address shapes) with the refusal surfacing verbatim beside
the save. The stored object lives in `agents.payout_method`; its
human-readable summary is derived into `agents.payout_handle`, which is
what paid-job proposals snapshot. The dialog is FILED, not stacked
(owner report 2026-08-19: "I didn't even notice it's scrollable"). Five
underline tabs across the top, Profile, Money, Emails, Your AI, Security,
one section on screen at a time. The rail is the table of contents the long
form never had: a setting becomes something a reader can see exists
instead of something they have to scroll into. Underline tabs, not pills,
so the rail cannot be mistaken for the provider pills a few lines below
it. **Emails** is one of those sections: three toggles for the
notifications a participant gets by mail (a comment under my contract, a
reply in a thread I am in, every new contract), each saving on the click
with no separate confirm, because a switch that needs a Save button reads
as a form rather than a switch. This dialog is the only place they are
edited. `<floor>#account` opens the dialog, `<floor>#emails` opens it ON
that section, and that is where every notification email's "turn it off"
line points.

**The floor's one modal says when it has more below.** `FloorModal` fades
its bottom edge into the card colour with a chevron under it, and both
vanish at the end of the scroll. The cue is drawn on a wrapper, never
inside the scroller, because a cue that scrolls away with the content it
describes is not a cue. Every dialog gets it, not only the account.

**Otto** (owner direction 2026-08-20) is the floor's market maker: a named
character in the bottom-right corner who has read the brief and will say
what he makes of it. Since 2026-08-21 he also acts: signed in, he calls the
API with that person's own account, so the panel's closing line says "he can
do what you can do and nothing more" and one opener is a thing to do rather
than a thing to ask. Signed out, the same line says reading is all he can do
and what signing up would change; offering an action that will come back 401
wastes the one minute a stranger gives you. Closed he is one line with a serif O, deliberately not
a circle with a speech bubble in it, because a bubble is the universal mark
of a support widget and he is not support. Open he is a panel in the same
ruled language as the rest of the page: his turns are flush left in the
page's own voice, the visitor's are set apart by an accent rule rather than
a coloured pill, so it stays a document instead of becoming a messenger
app. Three openers name this floor's own subjects, because a blank chat is
a blank page. One line under the composer says the opinions are his and not
the company's. On a phone he takes the sheet; a 23rem panel on a 390px
screen is a joke.

**Two doors, one conversation** (owner direction 2026-08-21: make him
obvious). A pill in the corner is easy to miss while reading, and the place a
visitor's question actually forms is the paragraph that just ran out of
answers, so **the last line of "What is <name>?" is a row that opens him**:
full width, hairline top and bottom, the serif O on the left and an arrow on
the right that leans out on hover. It is a row rather than a button beside the
heading, which was the first attempt and read as a foreign object dropped into
a line of tracked capitals; at the end of the prose it is the next thing to
read instead of a control competing with a label. It opens the same panel the
dock opens: the floor owns the open state (`TradePage`), never a second Otto
with half the conversation. The
closed dock is **ink**, not bone, for the same reason: the one thing floating
over a bone document should look like the one thing you can press, and it does
not compete with the bet buttons because they are the page's colour and he is
its ink.

He lives in the corner rather than in the column because a reader needs him
at whatever point of the page their question arrives, and because the
page's job is the market. The prompt for pointing your own AI at the same
brief is a SETTING (account dialog, "Your AI"), not another door here.

**The floor's one modal says when it has more below.** `FloorModal` fades
its bottom edge into the card colour with a chevron under it, and both
vanish at the end of the scroll. The cue is drawn on a wrapper, never
inside the scroller, because a cue that scrolls away with the content it
describes is not a cue. Every dialog gets it, not only the account.

**Ask the floor** (owner ask 2026-08-20) is the LAST block in the decision
column, under the comments/positions/trades panel (owner direction, same
day), and deliberately NOT a corner bubble: a bubble reads as support
("having trouble?"), this is research, and it belongs where a reader lands
once the market, the conversation and the positions have all failed to
answer them. The bar is the ticket's underline input so it belongs to the
instrument rather than looking bolted on; three suggestion chips name this
floor's own subjects, because "ask anything" is a blank page and a blank
page is friction of its own. The answer lands in a ruled block with a
single accent rule down its left edge, followed by one line saying where
it came from, and it replaces the previous answer rather than growing a
chat transcript. Nothing else hangs off it: the prompt for pointing your
own AI at the same brief is a SETTING (account dialog, "Your AI"), not
another door on the page.

**The bell** (owner ask 2026-08-19) sits in the top bar left of the
avatar, signed in only. At rest it is drawn in the same icon family as
the bug and Discord marks (1.7 stroke, tertiary ink, accent on hover).
With news the WHOLE control lights (owner ask 2026-08-19: it was too
quiet to notice): the bell takes the accent, sits in a soft amber field
with a hairline ring, and carries a mono count, still no red dot. A fresh
arrival pulses the ring once, and only on a rise, never on a poll that
changed nothing, because a page that twitches at rest teaches people to
ignore it. Its panel is a ruled list, one row per event, and unread rows
carry an amber hairline down the left edge as the only unread marker (a
badge per row turns twelve rows into a field of noise). Opening a row reads THAT row: the count
drops by one, its hairline goes, and the rest stay as they were. "Mark
all read" stays for the sweep.

**A row lands on the thing it names.** `/<slug>#contract=<id>&comment=<id>`
selects the contract, opens its thread, scrolls the named comment into
view and runs `.is-flashed` on it: one wash of the accent that fades out
over 1.8s. Rows with no comment flash the contract headline instead. The
class is shared, so anything the floor ever needs to point at flashes the
same way. It is deliberately not a selected state, because a highlight
that stays turns into something to dismiss and the reader already knows
what they clicked. Under reduced motion the wash still happens (it is the
answer to "which one?") and the scroll stops gliding.

**The dialog IS the account (owner decision 2026-08-19, when the console
was deleted).** Everything the console's `/account` page uniquely held moved
in beside the rest: the bio shown on the public profile, the credit balance
with USDC top-up, payout wallet and withdrawal (`AccountCredits`, rendered
only where the instance has USDC settlement on, so a simulation instance
never shows a deposit box), the prize season with its claim button
(`SeasonEntryPanel`; entering still happens on the floor rail and the
public leaderboard, not here), and the password change, collapsed behind a
link because most sessions open this dialog for a picture or a payout
address. The `/account` URL still resolves: it redirects to the floor with
`#account`, which is what the unsubscribe link in every notification email
points at. The board is signed-in
only; the anonymous poster stays clean. On viewports >=1120px the page
becomes the trading floor proper: a three-column grid with the leaders
rail on the left and the action log on the right (composed
client-side from the public payload: new jobs, approve/decline decisions
color-coded --higher/--lower, and market moves; newest first, capped at
12). Both rails render for both tiers, hide entirely when empty, sit
sticky beside the poster, and the chart stops breaking out (100% of the
center column). Below 1120px the rails stack under the poster,
leaderboard first. At the bottom of the floor column sits
"Know LookPilot, trade it better" (`.pubws-know`, owner direction
2026-08-10; it replaced first the copied metric-value evidence row and
then a bare "sources" label that explained nothing): one sentence on what
the product IS (from LookPilot's own positioning: webcam head tracker for
sims, best-reviewed on Steam, no hardware, $14.99 once), then the metric's
stored definition a register quieter, then three described
links a forecaster can audit without trusting this page: the data room
("the official numbers this market settles on"), the Steam store page
("the product, as players see it"), and SteamDB ("third-party sales
estimates"). Mono names with hairline underlines that warm to the accent;
external, new tab.

**The page ends: "What is this?", then "What can you do?", then the owner
door (owner ask 2026-08-15, corrected the same day).** Comprehension before
action, and it keeps the two calls to action together instead of splitting
them around the explainer. The three beats say what the floor is; the two
cards, Trade and Do a contract, say what the reader may do; the email door
closes the page, so the asks escalate: place a bet, offer a contract, run
your own number.

Each card carries a drawing in the chart's own vocabulary, one sentence,
and a link that SCROLLS to the control it names rather than opening a
modal: the point is to show where the thing lives on a page the reader will
come back to. The two sides are not equally obvious, either. The bet
buttons are on screen, while "a stranger can propose paid work here and be
paid in real money" is the half nobody guesses, so the contract card is the
one that must say "real money".

**An unfunded market never shows bet buttons (owner report 2026-08-15).**
A branch market can exist with no liquidity, in which case it has no
price and the server refuses every trade against it. The floor borrows
the baseline's call to DRAW such a branch (a blank chart is worse than
an honest prior), but that borrowed number must not decide whether the
page offers a bet: `funded` is carried separately from it, and an
unfunded market replaces the two bet verbs with one line saying nobody
has funded a market for this job yet. Composing a bet and meeting
"this market has no liquidity" at submit is the bug this rule exists to
prevent.

**A floor shows ONE horizon: the furthest-resolving market** (owner
direction 2026-08-17, "lets remove the this week option completely, its
just too confusing and adds unnecessary complexity"). It is the headline
everywhere a single number is shown: the marketplace card, the share card an
unfurled link renders, the floor's opening view, the definition it quotes,
the chart it draws, the market its ticket trades, and the metric a
contractor's impact is denominated in. LookPilot is "net 2026 at $78,571",
full stop. Lists still ship soonest-first, so the API contract is unchanged;
one helper, `primaryMarket`, picks the primary server-side and
`primaryHorizonOf` picks the same one client-side, so the surfaces cannot
drift apart.

A workspace may still have other open baseline markets, and the API still
serves them (`GET /api/marketplace/:id` ships every one in `markets`).

**Amended 2026-08-20: the floor offers them, one at a time.** Arrows on the
caption's own line step between the open baseline markets, and everything below
follows because every surface reads one `HorizonView`. Still no second chart
shown at once and still no per-horizon role caption: those were the expensive
half and they stay deleted. The paragraph above described 2026-08-17 to
2026-08-20, when there was no selector at all; it is kept because "ONE horizon
is the headline" is still the rule, and only the "cannot reach the others" part
changed. See "one clock, not two" below for the whole arc, and "a contract
shows its impact on EVERY clock" for where this rule deliberately inverts.

**One model owns what a horizon is** (`src/lib/floor-horizons.ts`). Which
market is primary, its label, its settle day, its unit, its metric history,
its period start and the lookup of its price series all come from there, and
a price series is only ever fetched BY MARKET ID. Surfaces that decided
these from an array position disagreed the moment the order changed: the
weekly view drew the yearly market's price line and dropped to the week's
call, and the caption read "speed, not the decision" beside "end of 2026"
(both owner reports 2026-08-17). The payload labels its inline price replay
with `marketHistoryMarketId` so nothing has to guess, and a test greps the
frontend for a second copy of any of it. The module survives the second
clock's removal because that ownership rule is what it was for; only the
role vocabulary (decision vs pulse) is gone.

**Both rails are scoped to THIS workspace (owner report 2026-08-15: "why
are the contractors per workspace and traders globally sorted? it should
all be per workspace").** The contractor board always was; the trader
rail asked `/api/leaderboard` unscoped and answered with the whole
platform's traders, which is a different question from the one a visitor
standing on this floor is asking. It now passes the workspace
(`?workspaceId=<id or slug>`), so a trader's number on a floor is the
profit they made ON that floor. The cross-workspace board still lives at
`/leaderboard`, where the question genuinely is platform-wide.

**"Show full leaderboard" is a link to `/leaderboard`, never a board opened
in place (owner direction 2026-08-24: "show full leaderboard should lead to
a new page.. not open a leaderboard there").** This replaces the 2026-08-22
in-place expander, which stacked the season standings and the global board
under the rail. The link sits directly under the boards it extends, before
the season strip, and is the rail's only full-width control besides the
season's own "Enter the season". The rail's three blocks (traders,
contractors, season) share one gap (`1.7rem`); the season strip used to have
no gap rule at all and ran straight into the contractors' empty line (owner
report 2026-08-24: "this looks weird").

**The rail's blocks share one anatomy (owner decision 2026-08-24, Viktor:
"redesign the workspace sites", Option A of the canvas in the umbrella's
`notes/floor-redesign-2026-08-24.md`).** Every block on either rail opens
with a header row (`.pubws-lb-head`): the tiny uppercase label on the left,
a right-aligned mono meta on the right, a hairline underneath, rows
following directly. The meta says what the numbers are: "this market" over
the traders, "impact" over the contractors, "impact by Sep" over the
contracts, and the season's countdown over the season block (the one meta in
primary colour and bold, because it is the number that says whether to act
today). The contracts board's per-list column label used to sit alone above
the rows; it is that header's meta now. Below the poster on narrow
viewports the contracts come BEFORE the standings: the action before the
proof. The since-open chip sits on the price's baseline a full `1rem` off
the number, and drops centred underneath it below 480px. The floor column
keeps a small gap under the top bar on narrow viewports (the headline used
to touch it) and "Log in" never wraps.

**Both leaderboards rank on what the market says right now, not on what
has settled (owner direction 2026-08-14, Viktor).** The rail stacks two
blocks, traders then contractors, five rows each; both update on the
floor's five-second poll, so a single trade reorders them without a
reload.

- **Top traders** rank by trading profit marked to market: payouts
  collected on resolved markets, plus the current worth of every open
  position (shares x the market's live consensus factor), minus the net
  cash paid for those positions (sells count negative). An unresolved
  position counts the moment its price moves; nothing waits for
  resolution. On `/leaderboard` each row also prints the split under the
  total, "settled" (final: resolutions and refunds) and "open" (still a
  mark), so a reader can tell realised money from paper (owner direction
  2026-08-24, Viktor; `docs/seasons.md`, "The score"). The rail's five
  compact rows print the total only.
  The number is measured off the trades, not off the balance,
  so credits the platform handed an account never enter it. **No account
  is excluded (owner direction 2026-08-14, Viktor: "maybe the bug is that
  it doesn't count admin into traders").** This replaces the 2026-08-11
  rule, which ranked balance-minus-grant and therefore had to strike the
  owner and the market maker off by name to keep operator credits from
  topping the board; that exclusion was deleting the floor's most active
  traders. Anyone who has ever traded in a public workspace is on the
  board. **A cancelled market is valued at its refund, not skipped**: a
  void pays back the net cash you still had in it, floored at zero (see
  `docs/vision.md`), so a market that was cancelled under you nets to
  exactly zero, while a realised gain you took out before the cancel
  stands. Trades on markets whose rows are gone entirely cannot be valued
  and count nothing. The row shows the signed profit in credits.
- **Top contractors** rank by the market's current valuation of the jobs
  they posted, NOT by dollars collected. A job's value is its priced
  impact: the approved branch's consensus minus the declined branch's, on
  the workspace's hero metric (the soonest-resolving baseline market's
  metric), taking the largest-magnitude horizon when a job is priced on
  several. Pending and approved jobs both count, so a job posted minutes
  ago scores as soon as anyone prices it; declined, withdrawn, and removed
  jobs count zero, because the work never happens. A job the market has
  not priced yet contributes zero rather than dropping its poster from the
  board. The score is signed and carried in the hero metric's own unit
  (a job the market thinks hurts the number reads negative); dollars
  earned on approved jobs drop to the row's second line, alongside the job
  count. House accounts are NOT excluded here: a contractor's score is
  priced by other people, so it cannot be self-granted.

**The board is at most five seconds behind the trades, and a reader's own
trade shows up on their next read (owner report 2026-08-21: "the
leaderboard seems kinda laggy... and kinda twitchy").** The server-side
board cache TTL is five seconds, not thirty: the floor polls every
fifteen seconds, so a thirty-second cache made successive polls alternate
between a fresh answer and a stale one, which read as the board twitching
backwards. Five seconds still collapses an arrival burst into one
aggregation per key while sitting safely under every poll interval.
Placing a trade additionally drops the cache on the spot, so the trader
who just moved a price is never told the price did not move.
`/leaderboard` itself polls on the same fifteen-second cadence while the
tab is visible and refreshes on tab return; a poll replaces rows in
place and never blanks the list, and a failed poll keeps the rows it
has. The page's public data loads once and polls; only the viewer's own
season-entry state re-fetches when the session resolves, because
re-fetching everything on auth settle repainted the whole board a second
after it appeared.

**A season entrant's row always carries a prize figure, on `/leaderboard`
AND on the floor rail's Top traders (owner ask 2026-08-21: "show on
leaderboard prizes next to the people signed in season 0", then "it
should be on this leaderboard too" about the rail).** While the season is a draft there is no
projection to make (no baselines exist), so the chip shows the ladder's
top rung, plainly: "$500", never "up to $500" (owner revision 2026-08-21:
"just say $500 thats it"). Once the season runs, the chip shows the
projected payout at the current standing, from the same `settleSeason`
the settlement uses; the number is the entrant's GLOBAL season standing
even on a workspace-scoped rail, because the prize is a season fact. An
entrant currently outside the rungs shows "entered" (rail: "in"). A bare
"$0" is never rendered: before the start it would read as "wins nothing"
rather than "not decided yet". The chip is prominent by design (same
owner message): accent-colored, heavier than the credits number beside
it, because it is real dollars.

Below the floor (outside the rails column) sits the about section
(`.pubws-about`, owner direction 2026-08-10): three drawings in the
chart's own vocabulary (step line, branch pair, priced gap plus check),
one Fraunces sentence each (owner direction 2026-08-11: the mission
line below the beats was removed; the beats speak for themselves), and
one door: an inline email field
with a "Get set up" button (owner direction 2026-08-10: never call it a
waitlist; entering an email is a request answered within days, and the
confirmation says "Got it. We will get back to you within a few days",
not queue language). Minimal text is the constraint; the drawings reuse
product vocabulary, never stock decoration.

Under the chart, baseline view only, sits the metric's own stored
description (`.pubws-metric-desc`): what the number is and when it
settles, verbatim from the metric row. It is never edited from the page
and never paraphrased in the UI, because the description is part of the
metric's definition and changing the definition voids the open market;
the words shown are exactly the words the market settles on.
While a bet is composed in the
ticket (side + amount picked, not yet placed), the chart draws its impact
as a ghost: a dashed vertical off the
live call dot to a hollow dot at the value the call would move to, tinted
--higher/--lower, labeled with the would-be value, updating live with the
amount and vanishing when the side is deselected or the trade placed. The
y domain stretches to include the ghost so a big bet's reach is visible. The ticket
(`TradeTicket`) is **not a panel**: the poster around it is type floating on
the background, so a bordered card read as app furniture bolted onto a
printed page. It is a centered column of type in which exactly ONE element
carries a fill, the confirm, which is what makes that button unmistakably
the action. The ticket opens showing ONLY the side pair (owner direction, 2026-08-10,
following Manifold): the amount, the confirm, the fine print and, when it
exists, the price mode all appear once a side is chosen, so an untouched
ticket asks exactly one question. The interaction stays a deliberate
two-step: pick a side
(Lower/Higher as two words, not boxes; state carried by colour and a 2px
rule under the chosen one, with the ▲/▼ glyph keeping its --higher/--lower
colour even while the word is quiet, since direction is the fastest thing
on the page to read), pick an amount (large mono numerals typed straight
onto the background, with borderless 10/50/cap presets under them, active
in accent), then the confirm, which always states what it will do ("Place
25 cr on Higher"). Until a side is chosen the confirm is plain quiet text
reading "Pick a side", never a dimmed filled slab: a disabled fill is the
loudest thing on the page and says nothing, which dark mode makes glaring
because the button ink is bone. One line of fine print carries the payout
and the wallet together. Limit orders enter as an optional third question
inside the same ticket (an `at any price` / `at my price` toggle, default
off), never as a second panel; the spec is `docs/limit-orders.md`. The payout line appears under the confirm only once a side is
picked; success flashes "Placed" on the button itself; errors render inside
the ticket. Held positions sit at the top of the ticket as rows (tinted
direction, mono payout, a Sell pill). Motion is one entrance pass (label, then price, then
the line drawing itself) plus a soft perpetual ripple on the call dot;
loading is the amber call dot rippling where the market will appear;
everything stops under prefers-reduced-motion. Signed-in visits join
silently. The ballot, charter, decided list, pitch and footer are
deliberately not rendered in this phase; the API still ships them, so each
returns as a render change.

## The cockpit (/admin)

`telarchy.com/admin` is the owner's own page: who showed up, where they
came from, who signed up, who is waiting, and what people reported. It is
the one surface in the product with an audience of one, and it reads the
platform-admin endpoints that already existed (`GET /api/admin/floor-stats`,
`GET /api/feedback`); the server gates both on the `platformAdmin` flag, so
the page is a renderer, never the guard.

Two rules it does not share with the public pages:

- **It is indistinguishable from a URL that does not exist.** Anyone who is
  not a platform admin - signed out, signed in, or curious - is bounced to
  the floor exactly the way any unrecognised path is. There is no "you are
  not allowed" screen, because that screen tells a stranger the page is
  real, and the page paints NOTHING until the check comes back: a headline
  reading "Admin" for the second the session check takes says the same
  thing (seen in production 2026-08-19, fixed the same day).
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

Rewritten 2026-08-19 (Viktor: "add support for this endpoint... but using
the new gui and design"). The 2026-08-11 cockpit's markup was inline
styles over `.container` and died with the console; this one shares no code
with it.

## Reusing a component's classes: mind the cascade order

Several blocks (the job form, the account dialog, the Manifold import)
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

Fixed 2026-08-14: three rules in the job form had been dead since the
2026-08-10 redesign, so the price field rendered in the ticket's centred
layout, stranded mid-panel away from its own label with the close button
pulled down to the number's baseline. An empty required numeric field also
now floors at 4ch with a normal-weight placeholder, so it reads as a field
awaiting digits rather than as a glyph; the hug-the-digits behaviour stays
correct for amounts you are actively editing.

## When in doubt

- Strip color before adding it.
- Add whitespace before adding a divider.
- Use a hairline before using a card.
- Match an existing pattern before inventing one.


**Revised 2026-08-10 (Viktor), floor layout round 3.** The baseline title
carries the settle day ("LookPilot net 2026 @ 31 December 2026", the END
of the target period so the year boundary never reads a day late), set a
register quieter than the name (`.pubws-settle`). The chart has a zoom row
(`.mchart-ranges`: 1H/6H/1D/1W/1M/ALL, Manifold-style); every window is
always clickable (a young market with every button disabled read as
broken; a window wider than the market's life just shows everything), and
a windowed view enters at the call in force at its left edge so the step
line never starts mid-air. The jobs board moved into the RIGHT RAIL, replacing the activity
log (the log's information lives on in the chart and the board); it
renders for everyone, with proposing routed to /signup when anonymous. The
metric's stored description moved from under the chart into the
"Know LookPilot" section, above the source links: description and sources
are one unit, what you are trading and where to verify it. The proposal
stake is 500 cr total (250 per branch market) and comes back in full at
decision time: declined refunds via the void, approved via the owner
buying out the proposer's LP position (see notes in the telarchy
umbrella). The account menu gained "Import Manifold balance": net worth at
1 mana = 1 cr, capped at 10,000, once per account pair, verified by a
one-time code in the Manifold bio.


**Revised 2026-08-10 (Viktor), floor round 4.** In the conditional
headline, the paid phrase IS the world toggle (`.pubws-world`): green
"is paid $X" in the approved branch, red "is not paid $X" in the declined
one, dotted underline as the click affordance, and clicking it flips the
branch. Both phrases stack in one grid cell so the headline sizes to the
longer phrase and never reflows on a switch, whatever the ask's width;
the inactive phrase waits a step below at opacity 0 and rises in on a
240ms crossfade (reduced-motion snaps). The chart carries a top-left
corner note on the zoom row's line: "resolves <settle day>". The know
block split into two labeled sections: "What is this market?" (the
stored definition, verbatim) above "What is LookPilot?" (the product
sentence plus the three described source links).

**Added 2026-08-17, announcements on the floor.** The know block is three
labeled sections now: "What is this market?" (the stored definition), then
"Announcements", then "What is `<name>`?". Announcements is the owner's
disclosure surface (`docs/vision.md`, "Workspace announcements"), so it sits
in the owner-prose zone rather than beside the market, and it renders the
latest one only: body as markdown, its published date, and, when the row was
edited, both timestamps plus a disclosure of what was first published.
Older announcements are behind a single "N earlier" toggle that fetches
`GET /api/marketplace/:idOrSlug/announcements`; the section renders nothing
at all when the workspace has never published one and the visitor cannot
manage it. An owner with `manage` gets an inline compose box (the
`SubjectAbout` editor pattern: hairlines, `jobform-line` textarea, ticket
buttons) and an Edit control on each announcement, with the edit box
carrying the warning that the original stays public.

**Revised 2026-08-20 (Viktor: "just show the headline on the main page, and
only if clicked then go to the announcements page").** The floor's
Announcements section is one row now (`.pubws-annline`): a three-column grid
of headline, day, and an arrow, hairline above and below so it reads as an
entry in a ledger rather than a paragraph of prose. The headline comes from
`src/lib/announcement-headline.ts` and nowhere else. Hover and keyboard focus
take the headline and the arrow to the accent and nudge the arrow 2px
(reduced-motion drops the nudge). The section's corner control is "All N"
when the record holds more than one, and nothing when it holds one, because
a count that always reads "All 1" is furniture.

`AnnouncementsPage` (`/:slug/announcements`) is a poster head over a document
body: the workspace name as a tiny uppercase back-link, the Fraunces headline
"Announcements", and one centred sentence naming the guarantee, over a left
aligned `.pubws-doc` column of hairline-separated entries. Each entry's
publication instant is set in `var(--font-mono)`, which is the page's one
structural device: in an append-only record the time is the entry's identity.
The compose box and the per-entry Edit control live here now, not on the
floor. Under 560px the row becomes two: the headline takes the width and the
day and arrow drop beneath it, because baseline-aligning a date against a
headline that has wrapped leaves it floating beside the first line. The
back-link is labelled with the slug until the workspace payload lands and the
real name replaces it; the label is uppercased, so on every floor whose slug
and name differ only in case the swap is invisible, and the page never sits
on a generic label while a 21KB call it does not otherwise need comes back.

**Added 2026-08-25, attribution (owner: "dont publish under my name").** An announcement published by a participant who is not the workspace owner (results-agent's Monday results post is the first) carries `publishedBy`, and both surfaces print it: the floor's one-row line appends the nickname after the day in the `when` cell, and each entry on `AnnouncementsPage` shows "by <nickname>" beside its timestamp in the same muted meta style as the edited marker. The page's guarantee sentence says the record holds what the owner, or a publisher the owner named, has said. Nothing is printed when `publishedBy` is null: the owner's own words stay unlabelled, which is the convention every earlier announcement was written under.

**Revised 2026-08-13, chart axis on young markets (owner bug report: the
"if declined" view of a fresh job drew only an endpoint dot).** The
market chart's x-domain never extends into the future: its right edge is
always max(now, newest point). The 60-second minimum span (the guard
that keeps a single-trade market from a zero-width axis) extends the
window LEFT (t0 = right edge - 60s), never right; the old behavior
pinned the domain to [t0, t0 + 60s], which put dead future space on the
right two-thirds, labeled x ticks with times that had not happened yet,
and stranded the primary line (which ends at now) mid-chart while the
secondary branch drew to the domain edge. In ALL mode the primary step
line enters the window at the call in force at its left edge (the same
carry rule zoom windows already used), so an untraded branch (a single
fallback point at now) draws as a flat held-call line ending in its dot
at the right edge, symmetric with how the secondary branch has always
rendered its no-trades case, instead of a floating dot with no line.
Zoom windows keep the deliberate 2026-08-10 mid-window start (the
window defines the axis, not the data). Spans under 10 minutes label x
ticks with seconds so four ticks on a young market do not all print the
same minute.

**A resetting metric's chart shows only the period it is measuring.** The
metric declares it (`resetsEvery`: null, or hour/day/week/month/year), and
when set, only readings taken inside a market's own target period are that
market's actual-so-far: a reading of "revenue this week" is about the week
it was taken in, so last week's $1,180 is not this week's actual (owner
report 2026-08-17). A period that has just begun therefore draws no actual
line at all - an empty axis with the market's call on the right, and a
crosshair that says "no reading yet" - which is the truth, where last
period's total was a fabrication. Undeclared (the default), every reading
is one trajectory and nothing is dropped: that is what a metric
accumulating all year is, and filtering it by its market's 2026-12 period
is the mistake that emptied both charts off the floor once already.

**The actual-vs-forecast chart's x-axis is the period being settled on**
(owner direction 2026-08-16: "the whole week should be on X axis"). It
opens at the first moment of that period, or at the first reading when
that is earlier, and closes at the settle date. So a week-long market
draws Monday to Sunday even when only the last two days have readings,
while a metric that accumulates all year keeps its January start under a
market targeting 2026-12. The bound is on the AXIS, never on the points:
filtering readings to the period emptied both charts off the floor once
already. Tick labels follow the length of the domain, days under about
six weeks and months above it, because "Aug" printed three times is not
an axis. The API sends `periodStart` per horizon so the two surfaces
cannot disagree about where a period begins.

**Event markers on the actual-vs-forecast chart (owner ask 2026-08-17).**
The chart takes an optional `marker` (`{ at, label }`): one dashed vertical
hairline at a moment, with a small uppercase label at the top. It exists
because a year-long trajectory raises the question the number alone cannot
answer, which is what changed and when; LookPilot's chart carries
"Started using Telarchy" at 13 August 2026. Rules: a marker draws only when
its moment falls inside the drawn domain, so a chart of a period that
predates the event simply does not mention it (a weekly horizon does not
carry an August marker in October); it is `--text-tertiary` and dashed, not
accent, because it is context and the data still leads; and its label flips
to whichever side of the line has room, the same `edgeLabel` rule the
settle-value label uses. One marker, not a list: a chart with several
annotations is an infographic, and the floor's charts are instruments.

**Revised 2026-08-15 (owner report: "it goes from 25 to 25 and yet it
goes down?").** The y domain now has a floor: four label quanta, where a
quantum is the smallest difference a tick label can express at that
magnitude (100 for values labelled in thousands, 1 for whole units, 0.01
below that). Scaling to the data alone is right until the data barely
moves, at which point it amplifies noise into a cliff: a market that
ticked 25 -> 25.07 -> 25 drew a full-height drop between two ticks both
reading "25", which is unreadable in both directions at once. The floor
sits an order of magnitude below any real move (LookPilot's 5k band
labels in hundreds, so its floor is 400), so it only ever catches noise,
and an untouched market now sits mid-plot instead of on an edge.

**Revised 2026-08-13, follow-up (owner report: the step's vertical
segment drew thinner than its horizontal run).** The plot clip exists
for Y excursions past the robust domain; horizontally it clipped too,
and the step to the live call lands exactly ON the plot's right edge
(the left edge likewise for a window's carried entry point), so a
vertical stroke centered on the clip boundary lost half its width. The
clip rect is padded 4 units horizontally on each side; its vertical
bounds stay exact, which is the part doing real work.

**Revised 2026-08-13, stale-tab guard (owner report: a branch-reset bug
kept "happening" after it was fixed, because the open floor tab was
still running the pre-fix bundle).** The floor is designed to be left
open, so every deploy strands open tabs on old code indefinitely; an
SPA never reloads itself and index.html is no-cache, so only a reload
picks a deploy up. The floor therefore checks every five minutes
(first check five minutes after load, paused while the tab is hidden)
whether the served index.html references a different `/assets/index-*`
bundle than the one running, and when it does, renders one quiet fixed
pill in the bottom-right, "new version · reload", which reloads on
click. It never reloads on its own: yanking a composed bet or a
selected branch out from under the visitor is worse than stale code.
In dev (no built bundle in the served page) the check is inert.

**Revised 2026-08-14 (Viktor), the marketplace is a card grid that
shows the markets.** This supersedes the two-doors lobby of the same
day, on the owner's report that the doors did not show the market at
all, said nothing about what a listing IS, and read as a fixed pair of
buttons rather than a marketplace new listings join.
`telarchy.com/marketplace` still renders standalone in the same design
language (`.pubws-topbar`, Fraunces, mono numerals, one accent), but as
`repeat(auto-fill, minmax(19rem, 1fr))` cards that read the same with
two listings or twenty. Each card carries, in this order: the
workspace name and its live number (accent mono), the metric name, the
owner's own one-line description (three lines, then clipped), THE
MARKET ITSELF as a full-width step-line spark of the hero market's real
trade history ending on the live-call dot (same held-call semantics as
the poster chart, value range padded 35% so a quiet market still draws
through the middle instead of along the floor of the box), and a footer
of when it settles plus the activity behind it (participants, trades
this week, contracts currently being priced).

The last cell of the grid is always the listing tile, and it is the only
interactive cell: a solid panel on a faint accent wash with a large plus
set inside a disc (owner: "a lot bigger, like big plus", then "make it
look better, the add your own looks a little weird now"; dashed
emptiness read as unfinished, and a bare floating glyph read as a
stray mark rather than an affordance), the line "List your own number",
and a "Get set up" button that opens an email field IN PLACE (owner
direction, same day: the tile should lead to entering your email, not to
another page). Submitting posts to /api/waitlist and the tile answers
"Got it. We will get back to you within a few days." Never queue
language, matching the floor's own email door. Listing is part of the
marketplace, never a quiet line underneath it.

**Card copy says only what is unique (owner, 2026-08-14: "I don't like
how it's repetitive... be minimal and say only what's unique").** The
per-card line is the workspace's `description`, which is the workspace
ONE-LINER (a few words naming what this is), not a call to action. When
every card recites the same "propose a job and a price" pitch, the pitch
belongs in the page's lead paragraph and the cards say what only they
can say: "Webcam head tracker for sims, sold on Steam", "This platform,
running on itself".

While the page loads it shows the market page's own motif, never a blank
page and never a spinner (owner ask 2026-08-14): the accent call dot
rippling (`.pubws-loading`) in the space the cards will occupy, and again
at card scale in each card's chart slot until that market's own payload
lands, since every card fetches its number separately. The chart slot
keeps its height either way, so nothing jumps when the number arrives,
and the footer's activity line is joined from the facts that exist, so a
count still in flight never leaves a separator hanging.

Above the grid, the lead paragraph is the one place the whole mechanism
is stated in plain words (owner ask, same day): every market is one
number someone is trying to move, anyone human or AI can propose a paid
contract to move it, the market prices what that contract would do, and
the owner pays only for the ones worth it.

**User-facing copy says MARKET, never "floor" (owner, 2026-08-14:
"what the hell is floor, no one will understand that").** The word is
internal vocabulary only: component and class names (`FloorRails`,
`.pubws-*`) and doc prose like this file may keep it, but no string a
visitor can read may. When copy
needs a word for one public workspace, it is "market".

**And the thing a proposer sells is a CONTRACT, never a "job" (owner,
2026-08-15: "isn't there a better name than job? maybe contract").**
The rail beside it has always read "Top contractors", so "jobs" was two
words for one idea, and the mismatch was ours: contractors do contracts.
"Contract" also says what it is more exactly than "job" does, an offer
at a price that someone has to accept, which is the whole mechanism.
The board is "Contracts", the action is "Suggest a contract", and a
participant "offers" one rather than "suggesting a job".

The API keeps its own word, `proposal` (`POST /api/proposals`,
`proposalId`, `proposals` in payloads), and so do component and CSS
names (`JobsBoard`, `.jobform-*`). Renaming those buys nothing and
breaks every client; the rule is about what a visitor reads.

**Nothing public-facing redirects to the old console UI (owner rule,
2026-08-14, emphatic).** That included the platform admin: an early
version of this page bounced admins into the console dashboard, which was
exactly what must never happen. **Settled permanently on 2026-08-19**: the
console was deleted, so there is no old UI left to land in, for anyone.

**Revised 2026-08-17 (Viktor), one clock, not two.** The second horizon is
gone: "lets remove the this week option completely, its just too confusing
and adds unnecessary complexity". A floor shows one market, the
furthest-resolving one, and there is no selector, no role caption, no
per-horizon chart list and no cross-horizon conflict mark on the ballot.

What it was for, so nobody rebuilds it by accident. Between 2026-08-15 and
2026-08-17 a public workspace ran the SAME number on two clocks: a near one
for fast feedback (short horizons measurably draw more traders) and a far one
for the decision the charter funds on. The stated reason was Goodhart: a
single weekly metric pays for whatever spikes this week, so a contract that
inflates seven-day activity at the cost of the audience prices well and gets
funded. The ballot's answer was a plain-language mark on any contract whose
near delta disagreed in sign with its far one ("buys the week, costs the
year").

Why it went anyway. The defence cost more than it bought. Every surface had
to say which clock it meant, and each one that forgot became a bug: the
weekly view drew the yearly market's price line and dropped to the week's
call with a -$73,387 chip to match, the caption read "speed, not the
decision" beside "end of 2026", the impact unit came off a stale
end-of-array convention, and a renamed weekly metric stamped last week's
total as a reading inside the new week (all owner reports, 2026-08-16 and
2026-08-17). Meanwhile the thing it was meant to catch never fired in
anger: LookPilot's weekly market took zero trades in its entire life, so the
conflict mark had nothing to mark. A second number nobody priced is not a
Goodhart defence, it is a second number to explain. Goodhart is now handled
where it always actually was, in the charter's own words and the owner's
judgment, rather than by a market with no traders in it.

If it comes back, it comes back as a deliberate feature with its own doc
section, not by re-adding a role enum to `floor-horizons.ts`.

**It came back on 2026-08-20 (Viktor): "switchable via arrows next to the
market name".** This is that section.

What is different from the version that was removed. The floor still shows
**one** clock at a time, and it still opens on the furthest-resolving market:
what got called confusing was two clocks on the page at once, each surface
having to say which one it meant. A reader now steps between them with a `‹`
and a `›` on the metric caption's own line, and every surface below follows the
selection because they all already read one `HorizonView`.

Why it is worth having at all, given the honest evidence against it: LookPilot's
weekly market took zero trades in its entire life, which is the strongest
argument that nobody wants a second clock. The thing that changed is the
problem being solved. In August the second clock was a Goodhart defence nobody
priced. Now it is the answer to a different question: the public platform has
two live markets in total, both settling six weeks out, so a trader who arrives
places one bet and has nothing to do until October. A weekly market that
settles on Sunday is the only thing on the board that pays a forecaster inside
the span of their own attention.

The rules that keep it from rotting back into the 2026-08-16 bug family:

- **Selection is a market id, never an index.** `horizonById` resolves it and
  falls back to the primary when the id is gone, which is what a reader sees
  after the market they were watching settles under them. `stepHorizon` walks
  the list. No role enum came back, and no surface reads meaning out of a
  position.
- **Both arrows render whenever the floor has more than one market, and they
  loop.** Off the end of the list is the other end of it. They stopped at the
  ends for half an hour on 2026-08-20, on the argument that a dead arrow tells
  a reader how many clocks exist; the owner's call, same day, is that a control
  which sometimes does nothing is worse than one that always moves. With one
  market they do not render at all, so looping never shows the same number
  twice in a row.
- **The arrows sit on the caption's line, not under the price**, and they are
  INSIDE the `h2` rather than in a wrapper around it. What they change is which
  instrument the page is about, and a control next to the number reads as
  changing the number. The wrapper version shipped first and broke the floor:
  putting a flex row between `.pubws-center` and the heading dropped the
  caption into a 59px column beside the price, four words tall and over the
  leaderboard rail, because that heading's placement comes from rules that
  assume it is a block child of the column. Add controls to that line by
  putting them in the heading, never by wrapping it.
- **No per-horizon role caption, and no cross-horizon conflict mark on the
  ballot.** Those were the expensive half of the old feature and they stay
  deleted.
- **The caption carries the settle day**: `ACTIVE TRADERS @ 23 AUG`, stepping
  to `ACTIVE TRADERS @ 30 SEP`. This reverses the 2026-08-18 direction that
  took the settle date off this line as redundant, and the reason it is no
  longer redundant is the arrows: with one market the metric's own name carried
  its horizon, and with two the date is the only thing telling the clocks
  apart. It is `settleShortOf(targetDate)`, COMPUTED from the market, never
  stored on the metric (owner ask 2026-08-20: "it should have @ resolution date
  in its name"). A stored date would be correct until Monday, when `+0w` opens
  next week's market on the same metric and the name still names last Sunday.
- **A metric name puts its window BEFORE the unit tail.** `LookPilot weekly net
  revenue (USD)`, never `LookPilot net revenue (this week)`. `metricLabelOf`
  strips the trailing parenthetical as the unit tail and `currencyOf` reads the
  currency out of that same tail, so a window written inside it is deleted from
  the caption AND takes the `$` off the price with it. Named the second way on
  2026-08-20, both clocks rendered as a bare `NET REVENUE` distinguishable only
  by their settle day, which is the collision the `settleDayOf` comment already
  warned about.

### A contract keeps the clock line, and says which world it is (design 2026-08-20)

**The bug this fixes.** The arrows live in the `selectedJob ? … : …` else
branch, so opening a contract removes them and `pair` falls back to
`selectedJob.markets[0]`. The backend is not the problem:
`createConditionalMarkets` spawns a pair per baseline market, so a two-clock
floor gives every contract four conditional markets and the API serves all of
them. The floor reaches exactly one, and WHICH one depends on the horizon the
reader happened to be on before they clicked in. An impact number that changes
with invisible state is worse than one that is merely incomplete.

**The rule (owner design 2026-08-20).** The caption line does not change when a
contract is opened. Same metric name, same settle day, same two arrows in the
same fixed positions. The contract adds ONE line underneath, naming the world
the number belongs to:

```
  ‹      WEEKLY ACTIVE TRADERS @ 30 SEP      ›
    if Jason is paid $100 for making a market

                    17.5
              [ HIGHER ]  [ LOWER ]
```

Everything the floor already does then works unchanged. The arrows step
horizons and the conditional pair follows, because `pair` already resolves by
`hero.targetDate`. The branch toggle already exists and already writes that
exact sentence: `WorldWord` renders `is paid $100` / `is not paid $100` with
both phrases in one grid cell so the headline cannot reflow on a switch.

Why this and not a per-horizon impact list. That was the first design and the
owner replaced it, correctly. It invented a second horizon control that lived
only on contracts, so the page had two ways to change clock and one of them
also changed what the page was about, which is the 2026-08-16 bug family
reappearing. This version has one rule everywhere: **one clock at a time, with
a way to the others**, on the headline and on a contract alike. It also keeps
the big number as the metric's own number in the metric's own unit, rather than
an "impact" abstraction that exists nowhere else on the floor.

What it gives up, stated so nobody rediscovers it as a gap: you cannot see a
contract's effect on both horizons at once, so "buys the week, costs the year"
is not visible in one glance. That is the cross-horizon conflict mark, and it
was deliberately deleted on 2026-08-17 as the expensive half of the two-clock
feature. Not having it here is consistent with that decision, not an oversight.

- **The caption is rendered for both states**, not duplicated into two
  branches. A second copy is how the two drift.
- **The back affordance survives** the caption no longer being the back button.
  A contract still needs one way out to the floor.
- **The world line is one sentence, not a label plus a value.** It reads as
  English because a stranger has to understand what the number is conditional
  on before the number means anything.
- **With one open horizon nothing changes**: no arrows, same caption, same
  world line.

### Two steppers: the metric, and its date (owner ask 2026-08-25)

**The ask.** "could you make the date be separately switchable? so essentially
every metric has two dates this way [...] one option is the metric that one can
be moved and the other is time horizon that one can be moved too." Then, same
hour: "unify the lookpilot metric to be monthly revenue on both horizons meaning
[...] 30 day running total", "add revenue metric to telarchy and lets add
reviews metric to lookpilot", "and also put daily resolving markets there".

**What a floor is now.** A floor prices a SET of metrics, and every one of
them is one number read on several dates. The horizon list is therefore a grid,
metrics x dates, and the caption carries two independent controls:

```
        ‹   NET REVENUE, TRAILING 30 DAYS   ›        <- steps the METRIC
              ‹  this week @ 31 Aug  ›               <- steps the DATE
                        6,912
                  [ HIGHER ]  [ LOWER ]
```

- **The metric arrows sit where the horizon arrows sat**, pinned to the
  caption's edges inside the `h2`, and they render only when the floor
  prices more than one metric. What they change is what the page is about,
  which is exactly what a control on the name's own line reads as changing.
- **The date line is directly under the caption, above the price.** It reads
  `‹ this week @ 31 Aug ›`: the clock's name (`horizonLabel`) and its settle
  day (`settleShortOf`), both COMPUTED from the market, never stored on the
  metric. Its arrows render only when the metric on screen has more than one
  open date, and with one date the line still shows `@ 31 Aug` without them,
  so the settle day never leaves the page. It is above the price, not under
  it, for the reason recorded on 2026-08-20: a control next to the number
  reads as changing the number.
**Revised 2026-08-26 (Viktor): both pickers are segmented rows.** Shown four
layouts on a canvas (pinned arrows as shipped; one stepper block; dates as
segments; both as segments), the owner picked the last: "what if we did option
c both for metrics and for the dates", then "do it shorten ech metric name as
needed.. e.g. just 'net revenue' instead of the full one". So the caption row
is a segmented control over the floor's metrics (`.pubws-seg`, primary metric
first, the selected segment in ink on a bone tab) and the row under it is the
same control over the metric's dates, soonest first: `today · 26 Aug`, `this
week · 30 Aug`, `this month · 31 Aug`, `30 Sep`. Every option is on screen and
the selected segment cannot move when the words change, which is what the
pinned arrows were for; the arrows and `stepMetric`/`stepDate` are gone, and a
click resolves through `cellOf(views, metricId, targetDate)` (same keep-the-date
rule as before). With one metric the caption is plain text; with one date the
row is the settle day alone. The row wraps on a phone rather than shrinking
its labels.

**Metric names are short handles, since 2026-08-26.** A segment has to fit
beside its siblings, so a floor metric's name is the noun a reader would say
("LookPilot net revenue (USD)", "Active traders", "Implied valuation (USD)"):
about twenty characters before the unit tail, three of them side by side in
the 660px column. The definition, including the window ("trailing 30 days",
"trailing 7 days"), lives in the description, which the floor prints under
the chart, and which is the settlement text anyway. This retires the
2026-08-20 rule that the window goes in the name before the unit tail: that
rule existed to tell two metrics apart that were really one number on two
windows, and one metric read on several dates has no such pair. The renamed
metric keeps its id, so no market moves; the LookPilot sync's `COMPUTE` map
is keyed by name and carries the new names (a rename without a map edit
silently stops the sync).

The paragraph below describes the pinned-arrow layout of 2026-08-25 to
2026-08-26 and is kept for the rule it records, which the segments inherit.

- **Neither pair of arrows moves when the words between them change** (owner
  ask 2026-08-26: "make sure the arrow buttons dont move with metric name
  length"). The caption's arrows are pinned to the caption's edges, as since
  2026-08-20; the date line is a fixed-width box (18rem, or the column on a
  narrow screen) with its arrows pinned to that box's edges, wide enough for
  the longest label the date helpers produce. A control that slides when you
  use it is the thing both rules exist to prevent.
- **Both steppers loop**, for the 2026-08-20 reason: a control that sometimes
  does nothing is worse than one that always moves.
- **Stepping the metric keeps the date when it can.** A reader on "this week"
  who steps from revenue to reviews lands on reviews this week; only when the
  next metric has no open market on that date does the page fall to that
  metric's furthest-resolving one. Stepping the date never changes the metric.
- **Selection is still one market id.** A (metric, date) pair IS a market, so
  nothing new travels through state, `horizonById` still resolves it, and a
  stale id still falls back to the primary. `stepMetric` and `stepDate` in
  `floor-horizons.ts` are the only two ways to move; `stepHorizon`, the flat
  walk, is gone, because a flat walk across a grid is the thing that reads as
  confusing (2026-08-17) once there are more than two cells.

**Every metric is a level, read on three dates.** The unification that came
with this: a metric on a public floor is a number that exists at every
instant (a trailing-30-day total, a count as of now), never a number that
belongs to one calendar period (revenue "this week", "in September"). Then
the same metric can be read today, this week and this month, and a market on
it settles on `metricValueAsOf(resolvesOn)` with no per-period arithmetic.
The per-period metrics were the 2026-08-16 bug family's other root: "weekly
net revenue" and "monthly net revenue" were two metrics for one thing, their
descriptions drifted (the weekly one described September for five days), and
nothing on the floor could say they were the same number. With one metric and
three dates the definition is written once. The horizons on both floors are
`+0d`, `+0w`, `+0m` (today, this ISO week, this calendar month; each rolls
over on its boundary like the weekly always did) plus any absolute date a
running market already holds, so a season's hero market is never deactivated
by the change that surrounds it.

**Which market is THE number, with several metrics.** `primaryMarket` still
picks the furthest-resolving open market, and a tie on the settle instant
(two metrics both read at month end) goes to the metric with the LOWER
`order`, then the earlier name. Liquidity broke the tie before, which was
harmless with one metric per date and would let a trade flip the headline
with two. The owner sets the order with `POST /api/metrics/reorder` (the floor
metric first), and the payload carries `metricOrder` on every market so the
client mirror `primaryHorizonOf` and the metric stepper read the same rule.
The metric stepper walks metrics in that order, primary first.

**A floor with six markets ships six histories.** `horizonHistories` was
capped at the four furthest-resolving markets, which on a two-metric,
three-date floor left the daily markets with no chart. The cap is gone; the
metric log is read once per distinct metric, not once per market, so the cost
is per metric and the cap had nothing left to protect.

### A market on a number that does not exist yet resolves N/A (owner ask 2026-08-25)

**The ask.** "another metric of telarchy should be valuation essentially if
invested in what is the implied valuation.. if not invested.. it resovles N/A
same for LookPilot".

**The rule.** A metric can declare `resolvesNaUntilMeasured` (POST/PUT
`/api/metrics`). While such a metric has NO logged reading at or before a
market's resolution instant, that market does not settle on a number: it is
VOIDED, every position refunded, with the reason published on the void. The
first reading ends the state for good: from then on the metric is a level like
any other and every later market settles on the value as of its instant. The
metric's `value` column plays no part (a never-measured metric carries the
default 0, and settling "no investment" as "$0 valuation" is the wrong answer
the flag exists to prevent). Without the flag nothing changes: a market with
no reading before its boundary still falls back to the live value, as it always
did.

Why a void and not a special resolution value: N/A is what the market IS when
its question has no answer, and the engine already has exactly one honest
shape for that (refund everyone, publish why). A "resolved at 0" would pay the
LOWER side for an event that did not happen; a synthetic sentinel would need
every surface that reads `actualValue` to know about it.

**What the floor says.** Under the price, the settle note reads "resolves 30
September 2026, or N/A (all bets refunded) if there is still no reading" for
a flagged metric that has no reading yet; once a reading exists the note is
the plain "resolves ..." again. The flag travels on `horizonHistories` as
`resolvesNaUntilMeasured` beside `resetsEvery`, and `measured` says whether a
reading exists, so the page never infers either from the points array (a
resetting metric ships an empty array inside a fresh period, which is not
"unmeasured").

**The two valuation metrics.** "Implied valuation (USD)" on both public
floors: the post-money valuation implied by the most recent closed
investment (a priced round; a SAFE or note counts at its valuation cap; a
secondary sale at its implied price), in USD. The owner logs it with a note
when an investment closes, and the log is public. Read on the same three
dates as every other floor metric, so "this month" asks: if money comes in by
the 31st, at what valuation, and pays nobody if it does not.

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
