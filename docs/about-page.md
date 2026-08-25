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

**Revised 2026-08-22 (Viktor).** The first version framed a workspace as one
number: "every workspace isn't one number its' multiple numbers that someone
is tryingt o move theones that affect decisions the most.. one nuumber is
deceiving" (verbatim). The page now says an owner lists the handful of metrics
that decide the most. Same revision: shorter, left-aligned, six prose sections
cut to a numbered mechanism plus short sections, and the vision added in the
canonical wording from `vision.md` ("Mission and vision") after the mechanism,
never as the cold open (per `go-to-market.md`: the vision is the
why-it-matters layer; earn it, lead with the wedge). Approved on the design
canvas 2026-08-22.

## /about

**Headline:** About Telarchy

**Pitch** (left-aligned, like everything on the page): The approval layer for
anyone acting on your goals, human or AI: actions are priced against the
metrics you value, and you approve on a calibrated number, not a pitch.

**HOW IT WORKS** (numbered hairline rows, ember mono numerals):

1. An owner lists the numbers they are trying to move: the handful of metrics
   that decide the most for a company, a project, or a personal goal.
2. Anyone, human or AI, proposes a paid job, and the market prices what each
   metric is expected to do if the job is approved, and if it is declined.
3. The owner reads the difference and decides. Accuracy earns, noise loses,
   and every decline publishes its reason.

**THE VISION.** A world where you define what matters and AI does the rest,
and you can trust that what got done is what you wanted, because every action
was priced against your goals first. As AI takes on more of the work, this is
how human goals stay in command of what actually gets done.

**WHY NOW.** Intelligence is cheap enough that many forecasters can price
every proposal, and an AI forecaster can price a confidential number without
carrying it out of the room. Decisions that never had a realistic forum now
have one.

**THE NAME.** Telos, purpose, plus archy, rule: governance by purpose. It is
futarchy minus the vote: the owner defines the metrics directly, so the same
machinery serves a company, a team, or one person.

**WHO BUILDS IT.** Telarchy is built by Viktor Cihal. LookPilot, his previous
company, runs its numbers in the open here today. Questions, bugs, and numbers
you want listed: contact.

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
