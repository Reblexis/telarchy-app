# The about and contact pages

`telarchy.com/about` and `telarchy.com/contact`, added 2026-08-21 (owner ask).
Two standalone `.pubws` poster pages, linked from a quiet footer on the home
page. Their job: a cold visitor who wants to know what this site is, who runs
it, and how to reach a human can find out without an account.

This file is the canonical source of both pages' copy (the same way
`docs/legal/*.md` is canonical for `/terms`). The pages in
`src/pages/AboutPage.tsx` and `src/pages/ContactPage.tsx` mirror it; revising
the copy means editing both in the same commit.

Copy rules that bind these pages (AGENTS.md "Canonical positioning"): the
approval wedge never appears without the calibrated-number clause; "human or
AI" wherever a statement covers both; companies and individuals both
first-class; no "startup"; no open-source claim; the mechanism is named after
the job, never led with.

## /about

**Headline:** About Telarchy

**Pitch:** Telarchy is the approval layer for anyone acting on your goals,
human or AI: proposed actions are priced against the metrics you actually
value, and you approve on a calibrated number, not a pitch.

**WHAT THIS PLACE IS.** Every market here is one number someone is trying to
move: a company's revenue, a product's users, a personal goal. Anyone, human
or AI, can propose a paid job that would move it. The market prices what the
number is expected to do if the job is approved, and what it is expected to do
if it is declined; the owner reads the difference and decides. Forecasters who
call it right earn. Noise loses.

**WHY A MARKET.** Whoever proposes an action is the least neutral source on
what it will do. A teammate pitches their own project, a chatbot has no skin
in the game, and the loudest voice in the room wins by volume. A market pays
accuracy and charges bias, and it leaves a record: the price at the moment of
approval, the outcome at settlement, every decline with its published reason.

**WHY NOW.** Intelligence is the cheapest it has ever been, so every proposal
can be priced by many forecasters at almost no cost per forecast. And an AI
forecaster can price a confidential number without carrying it out of the
room, a promise no human bettor can make. Together these open up decisions
that never had a realistic forum: sensitive KPIs, unannounced moves, personal
goals.

**THE NAME.** Telos, the Greek for purpose, plus archy, rule: governance by
purpose. The mechanism descends from futarchy, Robin Hanson's "vote on values,
bet on beliefs", with one change: there is no vote. The owner defines the
metrics directly, so the same machinery works for a company, a team, or one
person.

**WHO IT IS FOR.** Owners: companies pricing decisions against their KPIs, and
individuals doing the same on personal goals; both are first-class. Traders:
humans and AI register the same way, trade the same markets, and stand on the
same leaderboard. LookPilot, a real company, runs its net revenue in the open
here today.

**WHO BUILDS IT.** Telarchy is built by Viktor Cihal, whose previous company,
LookPilot, was the first number listed here. Questions, bugs, and numbers you
want listed: the contact page.

## /contact

**Headline:** Contact

**Pitch:** Short questions, bug reports, numbers you want listed. A human
reads all of it.

Rows (hairline list):

- **Email**: support@telarchy.com
- **Discord**: chat with the team and other traders (the standing invite,
  same one the market pages carry)
- **List your own number**: the waitlist at /manage
- **Building a bot?**: every endpoint is documented at telarchy.com/api/help,
  no account needed to read

## Reaching them

The home page carries a `.pubws-foot` footer: About, Contact, Terms, Privacy.
The market pages stay clean (their job is the market); /about links to
/contact in its closing section.
