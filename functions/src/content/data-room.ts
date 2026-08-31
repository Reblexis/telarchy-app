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
export const KNOWN_BLOCKS = ['pulse', 'funnel', 'traction', 'contracts', 'traffic', 'shipping'] as const;
export type BlockName = (typeof KNOWN_BLOCKS)[number];

/** When the prose was last edited. The numbers carry their own timestamp and
 *  are generated per request, so this dates the words alone. */
export const CONTENT_UPDATED_AT = '2026-08-31';

export const DATA_ROOM_MARKDOWN = `
## Overview

Telarchy is the approval layer for actions. An owner names the numbers they
actually care about. Anyone, a person or an AI, proposes something to do about
them and names a price. A market prices what each proposal would do to those
numbers if it were approved, and the owner approves on a calibrated figure
rather than on a pitch.

This page is Telarchy's own books. The platform runs a floor on itself, one
market prices its weekly pulse, and everything that market settles against is
published here, live, from the same database that serves the site. Nothing on
this page is a projection and nothing here argues a position.

The numbers are small. Publishing them anyway is the point: the floor's charter
promises that a week near zero means nobody showed up, and a data room that only
published flattering figures would make that promise a lie.

block:pulse

## What it is for

As AI takes over more of the operational work, the scarce thing is not the
ability to act. It is knowing which actions are worth taking. You cannot verify
a proposer's judgment, because an AI has no skin in the game and a person
pitching their own project has the wrong kind, so the answer is not to trust the
proposal. It is to price it, in front of forecasters who lose money when they
are wrong.

That is the whole mechanism. The owner defines the metrics. Participants,
human or AI, propose actions and put a price on them. Conditional markets price
each proposal twice, once in the world where it is approved and once in the
world where it is not, and the gap between those two prices is the priced impact
of approving. The owner reads the gap and decides.

Telarchy is a decision-market system, which is futarchy with the vote removed:
where futarchy needs a vote to agree on the welfare metric, an owner simply
names their own. The name is telos, purpose, plus archy, rule.

What it does not claim to solve is worth stating as plainly. Choosing the right
metric is still the owner's job, and the system will faithfully optimise
whatever metric it is given, so Goodhart is a live failure mode rather than a
solved one. Whether a model is internally deceptive is not something a market on
outcomes can see. The slice this takes is the control surface: every proposed
action priced against stated goals before it is taken, and the record of who was
right kept in public.

Two sides buy different things from the same substrate. An owner buys a
calibrated number before committing. A forecaster buys a benchmark where being
right pays in money rather than points, and where their track record is public
and portable. The trader side is being built first, because with no users at all
the scarce resource is a stranger's first minute, and the only first minute on
offer is trading a real company's roadmap.

## Who is here

The floor this platform runs on itself measures weekly active verified traders:
distinct participants with a public Manifold profile synced to their account
who have traded at least a hundred credits anywhere on the platform in the
trailing seven days.

Every word of that is load-bearing. Verified means each counted trader maps to
a public profile anyone can inspect on the leaderboard. The hundred-credit
floor keeps a one-credit gesture from counting, because signup credits are
free. The number syncs once a day from the same database that serves this page,
and the owner cannot edit it.

Four numbers stand between a stranger and that definition, and each is a filter
on the one above it. Page loads count what the visit rollup holds, which starts
later than the accounts do, so the first step is not a cohort and the
percentage under it is arithmetic between two published figures rather than a
claim that those accounts came out of those loads.

block:funnel

## Traction

What has happened so far, in full. Participants include automated ones, which
are most of them: the platform's own trading agents hold accounts like anyone
else, and a count that hid them would be a nicer number and a false one.

block:traction

Contracts are the jobs side of the floor. Anyone may propose a piece of work and
a price, the markets price what approving it would do to the metric, and the
owner approves or declines with a written reason. Every decision is public and
sits on the floor next to the market that priced it.

block:contracts

## Traffic

Every document load the site serves is logged by the site itself. There is no
third-party analytics on Telarchy, no tracking cookie and no advertising
network, which the privacy policy states and this is the same log that backs it.

Crawlers and vulnerability scanners are the majority of raw hits before a
launch, so both this page and the owner's own cockpit drop anything whose
user-agent looks like a bot and any scanner probe path. They call the same
filter, so the public number cannot flatter and the private one cannot differ.

Individual visit rows are deleted after thirty days, per the privacy policy.
What survives is a daily count of visits and distinct addresses, kept forever:
no address, no country, no path, no referrer. History therefore starts on the
day the rollup shipped rather than at the beginning of time.

block:traffic

Which channel a visitor came from is deliberately not published. It names
outreach that has not happened yet, and the same is true of who signed up, so
signup counts are here and the people behind them are not.

## Shipping

The change log is the git history of the repository this site is built from,
regenerated on every deploy. Nothing here is curated: the bars are every commit,
and the entries are the commit subjects as they were written.

A commit whose message says it is private is counted in the pace and never
quoted, which exists so that a change that cannot be named does not have to be
described vaguely instead. Everything else is published the moment it deploys.

block:shipping

## Plans

The first season starts on 22 August 2026 and ends on 1 October 2026. It pays
real money to the traders who are most accurate over that window, scored on
settled profit, meaning what the markets that actually resolved during the
season paid you minus what you paid on them, rather than on volume or on marks
that have not settled. Liquidity ramps up over the first three weeks rather than
opening deep. A contest is the cheapest way to find out whether people will
forecast for real stakes. The rules a contestant reads are published, and Season
0 says in its own text that we may change them while it runs: five amendments
have landed so far, each announced on the season page before it took effect and
each written to increase what is paid rather than to reduce anyone's standing.

Until the trader side pulls, the owner side stays deliberately quiet. Creating a
workspace is self-serve, capped at three floors per account, and a new floor is
born unlisted: live, tradeable and shareable by link, but on the front page only
once a human puts it there. So a floor arrives as a conversation rather than as
a signup. The order is intentional: a two-sided market is bootstrapped one side
at a time, and a floor with no traders is worth nothing to the company standing
on it.

The nearer work is the floor itself. A visitor should be able to arrive knowing
nothing, read what a company is, see what the market thinks, ask a question in
their own words and get a real answer, and place a bet in the same minute. Every
question asked of a floor is kept with the answer it got, because a question is
a gap in the page said in a visitor's own words, and that is the highest-signal
data a pre-launch product makes.

After that, the second company. One live floor proves the mechanism works and
proves nothing about whether it transfers, and the honest version of this page
in three months either names more companies or explains why it does not.

## Risks

There is no revenue. The platform charges nothing today, the business model is
unsettled, and the season's prize pool is an operator cost rather than an
investment anyone has made.

There is one company on the floor besides Telarchy itself, and it is run by the
same person who runs Telarchy. That is the fastest way to get a real floor and
also the weakest possible evidence that anyone else wants one.

The metric this platform prices itself on is gameable in principle, which is why
it counts verified profiles and a credit floor rather than raw signups, and why
the resolution route is public. It remains a proxy for something less
measurable, and Goodhart applies to the operator as much as to anyone.

The mechanism is prediction markets, which carries a regulatory question in some
jurisdictions when real money is involved. Season credits are not securities and
the season is a skill contest with published rules, but this is a live legal
question rather than a settled one.

Everything here is built by one person. The shipping pace on this page is
evidence of speed and equally evidence of a single point of failure.

## Checking these numbers

This whole page, prose and figures together, is one public read at
\`/api/data-room\`. No account, no key, no cookie. If a number here does not
match that response, the response is right.

The weekly pulse resolves against \`/api/marketplace/stats\`, and the floor's
own payload, including the market, its price and its history, is at
\`/api/marketplace/telarchy\`. The full endpoint catalogue is at \`/api/help\`.
An agent should read those routes rather than scrape this page.

A figure that cannot be computed is published as null and rendered here as not
published, never as zero. Every figure on this page is computed at read time
from the live tables, except the change log, which is generated from git at
deploy time and dated.
`.trim();
