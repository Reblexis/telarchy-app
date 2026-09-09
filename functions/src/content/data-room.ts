/**
 * The data room's prose, shipped verbatim (owner ask 2026-08-20).
 *
 * Spec: docs/data-room.md. Two rules govern this file.
 *
 * 1. Each `## ` heading is a section and an index entry, in source order.
 *    Adding a section is one edit here and nothing else.
 * 2. **No number is ever typed into this prose.** A `block:name` directive
 *    marks where a machine-derived figure is slotted in, and an unknown block
 *    name throws at module load rather than rendering a hole. That is what
 *    keeps the document and the data from disagreeing.
 *
 * It is a TypeScript module rather than a markdown file because the API serves
 * it and the runtime image contains only what tsc emits from functions/src.
 * The legal documents are carried the same way, for the same reason.
 */

/** The blocks the page knows how to render. A directive naming anything else
 *  is a mistake that must be loud, not an empty space on a public page. */
export const KNOWN_BLOCKS = [
  'pulse',
  'funnel',
  'window',
  'rates',
  'calendar',
  'events',
  'trading',
  'traction',
  'contracts',
  'traffic',
  'shipping',
] as const;
export type BlockName = (typeof KNOWN_BLOCKS)[number];

/**
 * The three parts the page is ordered into (docs/data-room.md, "One page,
 * three parts"), in the order they run down it. A section names one with a
 * `part:` directive; an unknown name throws at load, like an unknown block.
 */
export const KNOWN_PARTS = [
  { id: 'numbers', title: 'The numbers' },
  { id: 'place', title: 'The place' },
  { id: 'plan', title: 'The plan' },
] as const;
export type PartName = (typeof KNOWN_PARTS)[number]['id'];

/** When the prose was last edited. The numbers carry their own timestamp and
 *  are generated per request, so this dates the words alone. */
export const CONTENT_UPDATED_AT = '2026-09-10';

export const DATA_ROOM_MARKDOWN = `
## Overview

part:numbers

Telarchy prices proposed actions against company metrics or personal goals
before an owner approves them. Participants can be people or bots.

These are Telarchy's own readings and the activity behind them. Small numbers
are published anyway. The same evidence is available at [the public data
feed](/api/data-room), without an account or key.

The active-trader count requires a paid Manifold record claim and trading
volume at or above the threshold shown below. Linking a profile alone does
not qualify. Volume sums absolute trade costs across the platform in the
trailing week, including sales and redemption rows.

block:pulse

## The readings

part:numbers

The latest recorded value on each measured day, followed by the last reading
in each weekly interval. These are observations, not market forecasts. The
current day and interval are still incomplete. A missing weekly reading is
not zero.

Event marks show recent announcements and decisions on Telarchy's floor.
Their dates do not establish what caused a change, and approval does not
mean the work was delivered.

block:rates

## Behind the next reading

part:numbers

Verified participants' trading volumes are sorted below, including those
with no trades. Lapse dates assume no further trading and are sampled at
daily intervals, not exact expiry times.

The profit list excludes platform-admin and platform-operated accounts. It
combines profit from recent resolutions with the value of qualifying open
positions, so it can change before settlement. It is not the prize season's
score. The threshold lines show the amounts needed to count.

Outside-owner activity counts floors where the owner approved or declined a
proposal within the metric's trailing week. Platform-admin and
platform-operated owners are excluded, as are template starter decisions.
The pending list below covers public outside floors only; a pending proposal
is not a qualifying decision.

Payment rows cover the revenue window and exclude purchases by platform-admin
accounts. Only completed payments count towards revenue. Payment dates use
completion where recorded, otherwise creation. This is the liquidity-purchase
rail, not a full set of company accounts.

block:window

## Trading

part:place

Trading on public floors, including the platform's own participants. Credits
are trading volume, not revenue. These daily series exclude redemptions and
include participants without a paid Manifold claim; their scope differs from
the active-trader count above.

block:trading

## Traffic

part:place

Filtered server requests and distinct addresses. The filter removes recognised
crawlers and scanner paths, but does not establish that a visitor is human.
An address is not a person, and repeated requests are not new visitors.
Missing asset requests can remain in these counts. The current day is partial.

The retained daily totals contain no addresses, paths or referrers. The start
date marks the earliest retained day, not the site's launch. Acquisition
channels and visitor identities are not published here.

block:traffic

## Proposals and decisions

part:place

Proposal totals cover the platform, including private floors and the
operator's own activity. Removed entries are excluded. Approved amounts are
commitments, not evidence of payment or delivery.

The dated list is recent activity on Telarchy's own floor, not the full set
behind these totals. A delivery is listed separately when recorded.

block:contracts
block:events

## What is scheduled

part:plan

Upcoming baseline settlement dates and pending proposal deadlines on
Telarchy's floor. A deadline is not a promise of approval or delivery.
The outreach list shows recorded stages, without names; it does not measure
responses or adoption beyond what has been recorded.

block:calendar

## Limits and checking

part:plan

Activity counts do not establish independent demand. This feed does not report
operating costs, cash balance, runway or staffing. Choosing suitable metrics
remains the owner's responsibility. They can be gamed, and outcome markets
do not reveal whether a model is internally deceptive.

Trading credits are play money, have no cash value and cannot be redeemed.
Prize payments are separate. The experimental season may change its rules
while it runs; changes must be announced before taking effect and applied to
minimise harm to entrants and standings. Entry is free,
with no purchase or stake. Read the [season's eligibility, scoring and payment
rules](/legal/season-0) before entering, and [the season page](/season) for
current dates and notices. This page does not establish the legal status of
prediction markets where real money is involved.

Read [the data feed](/api/data-room) to check the figures, and use its
publication timestamp. The feed is computed from the site's database and
cached briefly; histories contain recorded observations rather than fresh
measurements of the past. A failed request is not a zero reading.

[Platform statistics](/api/marketplace/stats) supply the resolution figures.
[Telarchy's floor payload](/api/marketplace/telarchy) carries its metrics and
markets. [API help](/api/help) lists the endpoints. These reads are public.
[The earn table](/earn) explains record claims. The feed also carries the
omitted activity summaries and a change log generated from git at build time.
`;
