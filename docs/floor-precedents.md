# Precedents for the public floor

Reference for redesigning `telarchy.com/<company>` (today: `/lookpilot`).
Not a spec. It names the products that already solved the shape we are in,
what each one is worth stealing, and what it would cost us to copy.

Written 2026-08-18 at the owner's ask ("what big products do a similar
thing, where each subpage is a different company but the whole thing is
really the platform").

## The shape we are in

One URL per company. A visitor arrives cold, usually from a link about
*that company*, not about Telarchy. In one screen the page has to do four
jobs that normally live on four different pages:

1. **Identify the company** so the page reads as a real business, not a demo.
2. **Show its live number** so the visitor knows what is at stake.
3. **Let a stranger take a position** on that number within seconds.
4. **Hand the stranger work** (the jobs board) that the company will pay for.

And Telarchy itself has to stay legible without becoming the headline.
That combination is rare, but every individual half of it is a solved
problem somewhere.

## Three families, by what the visitor actually does

Precedents split cleanly by the verb they offer on a tenant subpage.

### A. Watch the number (company page as a live dashboard)

| Product | Tenant subpage | Worth stealing |
|---|---|---|
| Yahoo / Google Finance ticker (`/quote/AAPL`) | one company | The identity block: name, one large number, delta, and *the period the delta covers*. Then a six-cell "key statistics" grid that answers "what am I looking at" before any chart. |
| Indie Hackers product pages | one product, founder-run | Revenue chart *is* the identity. Milestones as a dated timeline. Founder speaks in first person under the chart. This is the closest existing thing to "a real company, run in the open". |
| Baremetrics Open Startups (dead, but the pattern lives) | one company's live MRR | A directory where the whole promise is "these numbers are not marketing". The directory page mattered as much as the company page: seeing ten of them is what made one credible. |
| Levels.fyi / Glassdoor company pages | one employer | The visitor contributes data to get data. A gate that is a contribution, not a paywall. |

### B. Price the number (company page as a market)

| Product | Tenant subpage | Worth stealing |
|---|---|---|
| Polymarket event page | one event, many sub-markets | Question as the `h1`. Chart. Trade widget pinned right. Resolution source quoted verbatim in a collapsed block below. And the bit we do not have: **several markets listed as rows on one page, each with inline yes/no prices you can hit without navigating**. Our jobs board should probably be that. |
| Kalshi | one contract | Ruthless "what settles this, and when" clarity directly under the title. |
| Manifold user / group pages | one creator's markets | The creator's face and the markets they run, together. The page is a person's portfolio, not a category. |
| Sofascore / FanDuel match pages | one fixture | Live number at the top, market rows below, and the fixture's identity carried by two logos. Density done well on a phone. |

### C. Take the work (company page as a job board)

| Product | Tenant subpage | Worth stealing |
|---|---|---|
| HackerOne program page | one company's bounty program | The strongest analogue for the jobs board: company header, **policy and scope** (what counts, verbatim), a bounty table with prices, and a **per-company leaderboard of contributors**. Our leaderboard is global; theirs is on the company page, and that is what makes a stranger want to appear on it. |
| GitHub repo page | one project | The routing model we already copy. Two things worth taking: the README lives *below* the working surface, not above it, and the contribution ladder is priced by effort (star, watch, issue, PR) so a stranger always has a cheap first act. |
| Kickstarter project page | one company raising money | The best all-three-jobs page ever shipped. One progress number as the page's vital sign, a right rail that is a **ladder of priced actions**, creator identity below the fold, updates, comments, FAQ, and a "Risks and challenges" section that is a direct ancestor of our owner disclosures. |
| Gitcoin / Replit bounties | one project's bounties | Money attached to each task, visible before you click. |

### Cross-cutting: how much of the page belongs to the tenant

A spectrum worth deciding on explicitly, because it is the "each subpage
is a different company but the whole thing is really the platform"
question stated precisely:

- **Polymarket**: 0% tenant skin. Every event page is identical chrome.
- **GitHub**: an avatar, a name, a README. Chrome is entirely GitHub's.
- **Kickstarter**: hero video and imagery are the creator's; the chassis is Kickstarter's.
- **Twitch**: channel banner, panels, emotes; the tenant decorates a fixed frame.
- **Substack / Patreon**: the tenant nearly owns the page; the platform is a footer and a checkout.

The floor today sits near GitHub. Moving one notch toward Kickstarter
(letting the company own the top block visually, keeping every mechanism
in Telarchy chrome) is the cheapest way to make `/lookpilot` read as a
company rather than as a Telarchy feature, and it scales to tenant #2
without a redesign.

## What no precedent gives us

Pricing an action *before* it is taken. Kickstarter stretch goals,
Polymarket sub-markets, and bountied GitHub issues each get within one
step, but none of them ask "what happens to the number if we do this".
That is the jobs board, and it is the part of the page where copying
something else will not work. It deserves the most invention and the
most screen.

## Concrete moves this suggests

1. **Identity block at the top** (Finance-style): company name, one number,
   the delta and its period. Today the question is the `h1`; the company
   is a line above it. Kickstarter and Finance both put the *entity* first
   and the *instrument* second.
2. **Jobs board as priced rows** (Polymarket event page): each job shows
   its price inline and is actionable in place, instead of re-pointing the
   single hero view.
3. **Per-company leaderboard** (HackerOne): who has been right about *this
   company*, on this page. Strangers join boards they can see.
4. **A cheap first act** (GitHub's star): something a visitor can do in one
   click before they understand markets. The email door is the current
   answer; it may be too far down the ladder.
5. **Keep "what is this" below the working surface** (GitHub README). This
   is already right; do not let a redesign pull the explainer above the fold.

## Open questions for the owner

- Is the page a *company page that happens to have a market*, or a *market
  page that happens to name a company*? Kickstarter versus Polymarket. The
  answer decides the top block.
- Does tenant #2 exist soon enough that the chassis has to be generic now,
  or is `/lookpilot` allowed to be bespoke and get generalised later?
- Is there a directory page (the Baremetrics lesson: ten open companies
  make one credible)? `/marketplace` is that page today, but it is not
  framed as "companies run in the open".

## Proposal: the top block (2026-08-18) - SHIPPED 2026-08-18

Owner's read: "the market itself appearing right away is maybe too
confusing, and there should at least be the name of the company as a title
above". Agreed on the diagnosis, with one correction: the problem is not
*where* the market sits, it is that the page opens with an answer to a
question nobody asked. Moving the market down would not fix it. Naming the
company would.

Today the company name exists but is a 0.72rem uppercase tertiary-grey
eyebrow (`.pubws-ws-name`, added earlier the same day). That reads as a
breadcrumb, not as "this is a real business". The serif `h1` is the metric
question, and the 5.6rem number is under it.

Proposed stack, unchanged in mechanism, re-ranked in typography:

```
LookPilot                             serif ~2rem, primary   <- the entity
6DoF head tracking for flight sims    one line, secondary    <- what it sells
--------------------------------------------------------
NET 2026 (USD) · settles Dec 31       small uppercase label  <- the instrument
$78,571                               the big number
▲ $2,140 since Aug 1                  delta chip
[chart] [ticket]
```

Three changes, in order of how much they buy:

1. **Promote the company to a real title** and give it one factual line of
   what it sells. This is the Finance-ticker move: the company is the page,
   the number is a readout on it.
2. **Demote the metric question to a label above the number.** It stops
   being the headline and becomes the caption that explains the figure.
   Nothing is lost: a cold visitor cannot parse "What is LookPilot net 2026"
   as a first impression anyway.
3. **Keep the identity block fixed when a job is selected.** The instrument
   block below it swaps to the conditional question, which *should* be a
   serif headline at that point, because by then the visitor has clicked
   into a specific bet and the question is the thing.

The explainer stays below the working surface. Do not let this pull "what
is this" above the fold.

**Open, needs the owner:** the "what it sells" line is one sentence of
company prose at the top of the floor. The 2026-08-11 direction removed the
floor's mission line; this is a different slot (factual, about the company,
not about Telarchy), but it is close enough that it should be an explicit
call rather than a quiet re-addition.

**DONE 2026-08-18**: all three moves shipped. The tagline needed no new copy or
schema: `workspaces.description` already existed for exactly this ("one-line
summary... so a stranger can tell what they are looking at") and LookPilot's
already read "Webcam head tracker for sims, sold on Steam." The one addition
beyond the proposal is `captionLabel` in `src/lib/floor-horizons.ts`, which
strips the company's name off the front of the caption so the page does not say
"LookPilot" twice in two lines.
