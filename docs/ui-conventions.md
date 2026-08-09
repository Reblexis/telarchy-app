# UI conventions

A short reference for how Telarchy frontend pages are laid out and styled.
Keeps tabs visually consistent so users don't get a "this page is centered,
that one isn't" feeling. Aspirational target: Stripe-style restraint.

## Page layout

Every authenticated route renders inside `AppLayout`, which provides:

- the sidebar (fixed, ~250px on desktop, drawer below 900px)
- a `.page-content` element with `padding: 2rem` (1rem on mobile)

Inside `.page-content`, each page renders **one wrapper element** with a
canonical max-width and centered margins:

```css
.container, .page {
  max-width: 1080px;
  margin: 0 auto;
}
```

Pages use `.container` (legacy) or a semantic class (`.overview`,
`.activity`) that adopts the same `max-width: 1080px; margin: 0 auto`
contract. Do not introduce a new max-width per page; if you need a
different one, put it in this doc and pick from the tier below.

### Width tiers

| Tier      | Max-width  | Use for                                          |
| --------- | ---------- | ------------------------------------------------ |
| standard  | **1080px** | All workspace tabs (overview, metrics, activity, proposals, markets, …). Default. |
| narrow    | 640px      | Single-form pages — account, single-step settings panels.                     |
| signup    | 420–460px  | Auth/intake — sign in, sign up, create workspace.                             |

Anything wider than `standard` is a smell. If a table needs more, fix
the table (sticky columns, horizontal scroll inside the row), don't
widen the page.

### Centering behavior

`margin: 0 auto` only visually centers when the viewport is wider than
the wrapper plus sidebar plus padding. On a typical 1280–1440px screen
the content fills the available space (left-aligned), and on wider
screens it slowly centers symmetrically. Both states feel intentional
because every tab does the same thing.

### Page padding

All vertical breathing room belongs to the inner page (e.g.
`.overview { padding: 0.5rem 0 3rem; }`). Horizontal padding is
**owned by `.page-content`**, never by the inner page wrapper. This
keeps left edges aligned across tabs.

## Type scale

| Element                        | Size      | Weight | Notes                                                    |
| ------------------------------ | --------- | ------ | -------------------------------------------------------- |
| Page title (`h1`)              | 1.6rem    | 600    | `letter-spacing: -0.025em`                               |
| Section heading (`h2` in page) | 0.78rem   | 600    | uppercase, tracked, `var(--text-tertiary)`               |
| Body                           | 0.875rem  | 400    | `var(--text-primary)`                                    |
| Meta / time / unit             | 0.75rem   | 400    | `var(--text-tertiary)`, tabular numbers where relevant   |
| Kbd label / chip               | 0.68rem   | 500    | uppercase, `var(--text-secondary)`, `var(--bg-tertiary)` |

Section titles are tiny uppercase labels, **not** large bold headers.
The page title is the only large heading on the page.

## Color usage

The product is monochrome plus a single accent (the existing focus /
link color). Avoid per-category color coding. Tags, type badges, and
category indicators should be neutral grey on `bg-tertiary` unless a
single state genuinely needs attention (e.g. error red, paused dot).

Trend deltas (KPI up/down) use semantic green (`#16a34a`) and red
(`#dc2626`) but at small size only. Never paint a whole row red/green.

## Hairlines, not cards

For lists, separators, and dividers, use a 1px `var(--border-color)`
hairline. Avoid surrounding sections in `bg-secondary` cards with
shadow + radius — those read as heavyweight panels. The exception is a
real interactive surface (form, modal, tooltip).

```css
.activity-list li { border-top: 1px solid var(--border-color); }
.activity-list li:last-child { border-bottom: 1px solid var(--border-color); }
```

## Markets trade panel

The expanded market card places the order controls in a single bordered
surface (`.trade-form`) — one of the interactive-surface exceptions to
"hairlines, not cards". Inside it, sections are separated by hairlines and
introduced by a tiny uppercase label (`Place a trade`, `or aim for a value`,
`Your position`), the same tracked-caps treatment as page section headings.

Amounts use a `.trade-money` field: a `$` affordance inside one bordered pill,
not a bare number input. The two direction buttons (`.trade-dir`) are the one
place a whole control is tinted: **Higher** carries `--success-text`, **Lower**
`--error-text` (label colour plus a matching hover fill), because up/down is
the load-bearing distinction a forecaster reads first. This is the sanctioned
use of the semantic green/red pair beyond small trend deltas; do not extend
per-direction colour to whole rows or to the history/positions tables.

Workspace names use the same 0.875rem / weight 500 type scale as the
Platform section. The selected workspace gets a `bg-tertiary` fill and
chevron disclosure arrow; the active route within that workspace gets
the standard accent border + light fill on its subnav row.

Subnav items sit in an indented column with a single 1px guide line
on the left, no per-item border. Reorder of subnav: data-creating
tabs first (Metrics, Proposals, Markets), then secondary (Participants,
Sources, Activity), then administrative (Settings).

The workspace rows are drag-reorderable: grab a row and drop it to
reorder the list. Order is a personal preference, persisted per
participant via `PUT /api/workspaces/order` and reflected in the order
`GET /api/workspaces` returns, so it follows the account across devices
and never affects other members of a shared workspace.

## Metric charts (y-axis)

The inline metric-card chart scales its y-axis by metric kind:

- A **leaf** metric renders against its full market band `[0, marketRangeMax]`,
  so the value reads relative to what its market can actually price.
- A **composite** metric (has a formula) has no market of its own; its value is
  a formula output that can exceed any child's range (e.g. a sum of
  valuations). It **auto-scales to fit its own data** - clamping it to a band
  clips the line off the top.

Whenever a band is supplied it is a floor on what's shown, never a ceiling:
`computeYAxisRange` (in `lib/metrics-chart-model.ts`) unions the band with the
data extent, so a value beyond the band expands the axis instead of being
clipped (and the flat-line case can never invert to `min > max`). The graph
modal passes no band at all, so it always auto-scales.

## Activity feed

Each activity log row carries:

- a one-line summary (verb + subject; no "A participant" filler)
- one or more **tag chips** (small `bg-tertiary` pills) derived from
  `getActivityTags(item)` — currently the type label + the metric
  name when applicable. Tags are searchable.
- a right-aligned time

The activity toolbar exposes a search input (filters summary, tags,
and actor), a 1h/24h/7d/30d segmented range, and per-type text-only
filter toggles (underline = active).

## Trading floor (root slug page)

`telarchy.com/<slug>` (`TradePage`, `.pubws-*` styles; `/marketplace/:idOrSlug`
canonicalizes here) renders **standalone**, outside `AppLayout`, and in the
minimal phase (owner decision, 2026-08-09) it renders **the market and
nothing else**: full-bleed top bar pinned to the viewport corners (the
Telarchy logo lockup at the landing nav's 3rem in the top-left, linking
home, vertically centered; a Log in link top-right only when signed out,
rendered only after the session check settles and faded in, so signed-in
visitors never see it flash; the bar deliberately ignores the 660px content
column, which left the logo floating aligned to nothing), one headline naming the prediction ("<metric> @ <settle
date>", the metric's parenthetical unit tail trimmed for display) set in
the Fraunces display face with the instrument in ink and the settle date a
register quieter (an exception to the tiny-uppercase-label rule: it is the
page's only statement of what the market is), the consensus as a large mono
price with a since-open chip (both carrying the metric's currency symbol
when the trimmed parenthetical tail names one, e.g. "USD" -> "$"; the same
prefix runs through every numeral in the chart), and the prediction
chart (`MarketChart`: one amber step line of the market's call over its
lifetime, gradient fill, labeled end dot, crosshair; breaks out of the
column to min(92vw, 840px); phones get a taller, narrower canvas chosen at
mount). The composition is a poster: the market sits in the optical center
of the viewport. Motion is one entrance pass (label, then price, then the
line drawing itself) plus a soft perpetual ripple on the call dot; loading
is the amber call dot rippling where the market will appear; everything stops
under prefers-reduced-motion. The page is view-only in this phase: no trade
controls even when signed in, no CTA button, no caption line, no balance
readout. Understanding the market is the page's entire job; trading returns
as a render change when the owner turns it back on. Signed-in visits still
join silently, so every account that has seen the page is already a member
then. The ballot, charter, decided list, pitch and footer are deliberately not
rendered in this phase; the API still ships them, so each returns as a
render change.

## When in doubt

- Strip color before adding it.
- Add whitespace before adding a divider.
- Use a hairline before using a card.
- Match an existing pattern before inventing one.
