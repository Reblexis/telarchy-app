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

## Sidebar

Workspace names use the same 0.875rem / weight 500 type scale as the
Platform section. The selected workspace gets a `bg-tertiary` fill and
chevron disclosure arrow; the active route within that workspace gets
the standard accent border + light fill on its subnav row.

Subnav items sit in an indented column with a single 1px guide line
on the left, no per-item border. Reorder of subnav: data-creating
tabs first (Metrics, Proposals, Markets), then secondary (Participants,
Sources, Activity), then administrative (Settings).

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

## When in doubt

- Strip color before adding it.
- Add whitespace before adding a divider.
- Use a hairline before using a card.
- Match an existing pattern before inventing one.
