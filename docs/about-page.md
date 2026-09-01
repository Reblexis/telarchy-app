# The about and contact pages

`telarchy.com/about` and `telarchy.com/contact` are two standalone `.pubws` poster pages, linked from a quiet footer on the home
page. Their job: a cold visitor who wants to know what this site is, who runs
it, and how to reach a human can find out without an account.

This file is the canonical source of both pages' copy (the same way
`docs/legal/*.md` is canonical for `/terms`). The pages in
`src/pages/AboutPage.tsx` and `src/pages/ContactPage.tsx` mirror it; revising
the copy means editing both in the same commit.

Copy rules that bind these pages (AGENTS.md "Canonical positioning"): the
approval wedge never appears without the calibrated-number clause; "human or
AI" wherever a statement covers both; companies and individuals both
first-class; no "startup"; the mechanism is named after the job, never led
with. The open-source claim is allowed here and only in this register: AGENTS.md
"Open source, precisely" says to state AGPL-3.0-only where the page links the
code, and never as a slogan, so it lives in THE CODE section at the bottom and
nowhere near the pitch.

A workspace is described as the handful of metrics that decide the most, never
as one number. The page is short and left-aligned: a numbered mechanism plus
short sections. The vision appears in the canonical wording from `vision.md`
("Mission and vision") after the mechanism, never as the cold open: the vision
is the why-it-matters layer; the page leads with the wedge. Every section is
one short paragraph: a visitor came to find out what this is and who runs it,
and a second paragraph is always the argument for the first. History:
notes/decisions/about-page.md.

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

**THE VISION.** You define what matters and AI does the rest, and you can
trust that what got done is what you wanted, because every action was priced
against your goals first.

**WHY NOW.** Intelligence is cheap enough for many forecasters to price every
proposal, and an AI forecaster can price a confidential number without
carrying it out of the room.

**THE NAME.** Telos, purpose, plus archy, rule. Futarchy minus the vote: the
owner defines the metrics directly, so the same machinery serves a company, a
team, or one person.

**WHO BUILDS IT.** Telarchy is built by Viktor Cihal. LookPilot, his previous
company, runs its numbers in the open here today. Questions, bugs, and numbers
you want listed: contact.

**THE CODE.** Telarchy is open source (AGPL-3.0): the same code that serves
this site is at github.com/Reblexis/telarchy-app, with docker compose for your
own instance.

## /contact

**Headline:** Contact

**Pitch:** Short questions, bug reports, numbers you want listed. A human
reads all of it.

Rows (hairline list):

- **Email**: support@telarchy.com
- **Discord**: "Chat with the team and other traders", linking to the standing
  invite (the same one the market pages carry)
- **List your own number**: "Open your own market", linking to / (the home
  page, where any signed-in visitor creates one)
- **Building a bot?**: "Every endpoint is documented, no account needed to
  read", linking to /api/help (a URL the API serves, base-aware, opened in a
  new tab)

## Reaching them

The home page carries a `.pubws-foot` footer: About, Contact, Terms, Privacy.
The market pages stay clean (their job is the market); /about links to
/contact in its closing section.
