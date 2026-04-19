# Personas

Persona-based UX tests. Each file describes a specific user profile, their context, attention budget, and the session script to execute as them. Complements `docs/mvp-evaluation-plan.md`, which covers feature-level correctness; these cover the UX layer feature tests can't see.

## How to use

Read `_protocol.md` once to understand the execution model and findings template, then pick a persona and run it end-to-end in a clean browser context. One persona per session. Produce findings per the template.

## Personas

| # | File | Persona | Device | Referral | Budget |
| --- | --- | --- | --- | --- | --- |
| 1 | `01-hn-skeptic.md` | Jordan — senior engineer, hostile, fast | desktop | HN link | 2 min |
| 2 | `02-qs-hobbyist.md` | Alex — non-technical, tracks habits | desktop | subreddit link | 8 min |
| 3 | `03-agent-builder.md` | Sam — builds autonomous agents | desktop + terminal | Discord/awesome-list | 15 min |
| 4 | `04-startup-founder.md` | Marcus — founder, wants team KPIs | desktop | peer Slack | 10 min |
| 5 | `05-phone-visitor.md` | Taylor — phone, social share | mobile | iMessage/Twitter link | 30 s |
| 6 | `06-researcher.md` | Lin — researcher, reads math and code | desktop | search | 30 min |
| 7 | `07-day-2-return.md` | Priya — returning user, day 2 | desktop | bookmark | 3 min |

## Coverage

These seven personas cover the axes that matter for MVP survival:

- **First impression**: 1 (HN), 5 (mobile share), 6 (search).
- **Individual vs team**: 2, 6 (individual) vs 4 (team) vs 3 (machine-agent).
- **Technical depth**: 3, 6 (deep) vs 2, 4, 5 (shallow/non-technical) vs 1 (technical but impatient).
- **Device**: 5 is mobile; the rest are desktop. The phone-visitor persona is the only one required to run at 390x844.
- **Time horizon**: 1 (seconds), 5 (seconds), 4 (minutes), 2 (minutes), 3 (minutes), 6 (half hour), 7 (retention after 48 h).
- **Attention profile**: 1 (hostile), 2 (curious), 3 (impatient-technical), 4 (commercial), 5 (distracted), 6 (thoughtful), 7 (uncertain).

Missing (explicit non-goals for now):
- **Screen-reader-dependent user**: covered by an item in the main plan under accessibility, needs a human tester.
- **International/non-English user**: the product is English-only for now; revisit when localization exists.
- **Adversarial user**: covered by Section 14 of the main plan, not a persona.

## Adding a persona

When to add: a real first-user class is missing, and their session script would diverge materially from an existing persona. Don't add "Marcus but on a phone"; resize Marcus. Do add "founder in a country with play-money gambling restrictions" if that becomes a real target.

When not to add: to celebrate a feature, to pad coverage, to avoid running existing personas.

## Findings history

Findings go under `docs/personas/findings/<persona-id>-YYYY-MM-DD.md` per `_protocol.md`. Directory may be empty until the first run.
