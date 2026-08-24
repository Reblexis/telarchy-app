# Product screenshots

How we capture clean light + dark product screenshots for the landing page and
docs, and how to refresh them. The capture is scripted: `scripts/capture-screenshots.sh`.

## What you get

`scripts/capture-screenshots.sh` writes `docs/screenshots/<tab>-<theme>.png` for
every workspace tab in both `light` and `dark`, at retina (2x) scale, cropped to
the content area (`.page-content`) so the sidebar (with the admin email and
balance) never lands in the image.

Tabs captured by default: `metrics check-in proposals markets participants
sources activity settings`.

## The demo workspace ("Kestrel")

Screenshots are taken from **Kestrel** (`<userId>/kestrel` on telarchy.com), a
workspace seeded from the SaaS-startup template with **fictional** numbers
(MRR ~$48k, 312 paying customers, 2.1% churn, 24% trial-to-paid). It is not real
customer data, so the shots are safe to publish anywhere. New workspaces default
to **Open**, so the platform bots auto-join and generate real forecast activity
(Participants / Activity / Markets fill in on their own).

Do not point the capture at a real workspace (e.g. LookPilot) unless you intend
to publish real revenue/conversion data.

Kestrel is kept **private** so the platform bots don't trade on it. While it
was Open, the anchor/stabilizer bots continuously pulled every market's
consensus back to the current value, which flattened the forecast charts. If
you re-open it, expect the charts to flatten again within a poll cycle.

### Making the charts realistic (`scripts/seed-demo-metrics.py`)

A fresh template workspace has identical, flat forecast charts: every metric
has the same time preference (so the same sample dates/shape) and untraded
markets sit at the current value (so flat lines). `scripts/seed-demo-metrics.py`
fixes both:

- Sets a **different `halfLife` + `density`** per metric, so each chart spans a
  different horizon, granularity, and number of points.
- Moves each market's consensus along a **logical trajectory** (MRR and
  customers up, churn down, etc.) using the AMM "trade towards value" mode,
  which sets consensus precisely instead of whipsawing low-liquidity markets.

```bash
# Full shape (sets time preference + respawns markets + trajectory):
TELARCHY_KEY=mtrk_... WS_ID=<workspace-uuid> \
  TELARCHY_EMAIL=you@x.com TELARCHY_PASSWORD=... \
  python3 scripts/seed-demo-metrics.py

# Only re-apply the trajectory on the existing markets (e.g. after drift),
# without touching time preference / the market set:
SKIP_TP=1 TELARCHY_KEY=... WS_ID=... TELARCHY_EMAIL=... TELARCHY_PASSWORD=... \
  python3 scripts/seed-demo-metrics.py
```

Edit the `CONFIG` list in the script to change the per-metric horizons and
trajectories. After shaping, recapture and copy the metrics shot to the landing
assets (below). The trajectory will slowly drift as calendar time shifts the
sampled dates; re-run with `SKIP_TP=1` to refresh it.

## Prerequisites

1. The gstack **`browse`** headless-Chromium CLI (the same tool used for QA).
   The script looks for it at `~/.claude/skills/gstack/browse/dist/browse`
   (override with `BROWSE_BIN`).
2. A logged-in browse session, OR credentials in the environment so the script
   logs in for you. Admin credentials come from `keyring/telarchy/admin.env`.

> Gotcha: BetterAuth rejects cross-origin sign-in. Log in **directly on
> `https://telarchy.com/login`** (which the script does); logging in from a
> local Vite frontend pointed at the prod API fails with a misleading
> "Invalid email or password".

## Usage

```bash
# Auto-login + capture everything (light + dark, all tabs):
TELARCHY_EMAIL=viktor.cihal@gmail.com TELARCHY_PASSWORD='...' \
  scripts/capture-screenshots.sh

# Already-logged-in browse session, just recapture:
scripts/capture-screenshots.sh

# Subset of tabs / a different workspace / single theme:
TABS="metrics markets" THEMES="dark" scripts/capture-screenshots.sh
WS_PATH="<userId>/<workspace-slug>" scripts/capture-screenshots.sh
```

Knobs (env vars): `BASE_URL`, `WS_PATH`, `OUT_DIR`, `SELECTOR`, `SCALE`,
`VIEWPORT`, `TABS`, `THEMES`, `BROWSE_BIN`.

### The Activity tab

The Activity feed is unbounded (hundreds of events), so a `.page-content`
capture is enormous. The committed `activity-{light,dark}.png` were taken with a
height-bounded clip of the content column instead:

```bash
B=~/.claude/skills/gstack/browse/dist/browse
$B viewport 1180x860 --scale 2
$B goto https://telarchy.com/<userId>/kestrel/metrics
$B storage set telarchy-theme dark        # or light
$B goto https://telarchy.com/<userId>/kestrel/activity
$B js "window.scrollTo(0,0)"
$B screenshot --clip 220,0,960,820 docs/screenshots/activity-dark.png
```

(`x=220` skips the sidebar; the content column is 960px wide.)

## How the landing page consumes light/dark

The hero "The product, not a pitch" band uses the metrics shot. Both variants
are imported and the visible one is chosen by CSS, mirroring the logo swap:

- `src/assets/product-dashboard-light.png` and `product-dashboard-dark.png`
- `LandingPage.tsx` renders both `<img>`s (`.lp-product-img--light` /
  `--dark`).
- `style.css` shows the right one off `data-theme` on `<html>`
  (`light` / `dark`), falling back to `@media (prefers-color-scheme: dark)` for
  the "system" setting. Theme is stored in `localStorage['telarchy-theme']`
  (see `src/hooks/useTheme.ts`).

To **refresh the landing shot** after a UI change:

```bash
scripts/capture-screenshots.sh                       # regenerates docs/screenshots/
cp docs/screenshots/metrics-light.png src/assets/product-dashboard-light.png
cp docs/screenshots/metrics-dark.png  src/assets/product-dashboard-dark.png
```

Then rebuild. To put a **different** tab on the landing, copy that tab's
`-light`/`-dark` pair into `src/assets/` and import it the same way.

## Notes

- A floating "Help" widget sits top-right on authed pages and can overlap a
  page's primary button (e.g. Proposals' "+ New proposal"). Hide it before
  capturing if it bothers you: `browse js "document.querySelector(...).style.display='none'"`.
- Kestrel is Open and bots trade on it, so its numbers drift over time. The
  current-value ("Now:") figures are stable (author-set); the market "Outlook"
  moves. If a tab's data drifts to something implausible, reset a metric's
  `marketRangeMax` to force a fresh market respawn anchored near the value.
