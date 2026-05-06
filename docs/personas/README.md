# Personas

Persona-based UX tests. Each file describes a specific user profile, their context, attention budget, and the session script to execute as them. Complements `docs/mvp-evaluation/plan.md`, which covers feature-level correctness; these cover the UX layer feature tests can't see.

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
| 8 | `08-self-hoster.md` | Dev — homelab self-hoster | desktop | search/r/selfhosted | 5 min |
| 9 | `09-privacy-eu.md` | Noor — privacy-conscious, reads legal pages | desktop | privacy newsletter | 10 min |
| 10 | `10-polymarket-refugee.md` | Kai — crypto-native, expects real-money markets | desktop | crypto-twitter | 3 min |
| 11 | `11-decision-maker.md` | Priya — manager with a specific decision weighing on her | desktop | peer tweet | 8 min |
| 12 | `12-invited-collaborator.md` | Dev — teammate invited into an existing workspace | desktop | DM from boss | 5 min |
| 13 | `13-proposal-approver.md` | Chen — admin approving a proposal via conditional markets | desktop | in-app / email | 10 min |

## Coverage

These thirteen personas cover the axes that matter for MVP survival:

- **First impression**: 1 (HN), 5 (mobile share), 6 (search), 8 (self-host search), 10 (crypto-twitter), 11 (decision-focused tweet).
- **Individual vs team**: 2, 6, 11 (individual) vs 4, 12 (team/invitee) vs 3 (machine-agent).
- **Technical depth**: 3, 6, 8 (deep) vs 2, 4, 5, 11, 12 (shallow/non-technical) vs 1, 10 (technical but impatient).
- **Device**: 5 is mobile; the rest are desktop. The phone-visitor persona is the only one required to run at 390x844.
- **Time horizon**: 1 (seconds), 5 (seconds), 10 (minutes), 4 (minutes), 2 (minutes), 3 (minutes), 8 (minutes), 11 (minutes), 12 (minutes), 13 (minutes), 6 (half hour), 7 (retention after 48 h), 9 (reads legal pages).
- **Attention profile**: 1 (hostile), 2 (curious), 3 (impatient-technical), 4 (commercial), 5 (distracted), 6 (thoughtful), 7 (uncertain), 8 (suspicious of SaaS-only), 9 (compliance-aware), 10 (crypto-impatient), 11 (decision-pragmatic), 12 (obligated-neutral), 13 (trust-cautious).
- **Compliance / messaging canaries**: 8 probes the open-source-claim consistency; 9 probes ToS/Privacy/consent truthfulness; 10 probes the play-money-vs-USDC framing. These three re-run after any edit to legal or landing copy.
- **Product-thesis canaries**: 11 probes the "Better decisions, faster" landing pitch against the actual product journey; 13 probes whether the conditional-decision-market (futarchy) loop is usable by the person it's meant to serve. Re-run these after any landing or proposals UI change.
- **Team/multi-user canary**: 12 probes the invitee side of team workspaces. Re-run after any change to workspace visibility, join flow, or default group capabilities.

Missing (explicit non-goals for now):
- **Screen-reader-dependent user**: covered by an item in the main plan under accessibility, needs a human tester.
- **International/non-English user**: the product is English-only for now; revisit when localization exists.
- **Adversarial user**: covered by Section 14 of the main plan, not a persona.

## Adding a persona

When to add: a real first-user class is missing, and their session script would diverge materially from an existing persona. Don't add "Marcus but on a phone"; resize Marcus. Do add "founder in a country with play-money gambling restrictions" if that becomes a real target.

When not to add: to celebrate a feature, to pad coverage, to avoid running existing personas.

## Findings history

Findings go under `docs/personas/findings/<persona-id>-YYYY-MM-DD.md` per `_protocol.md`. Directory may be empty until the first run.
