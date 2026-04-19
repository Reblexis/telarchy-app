# Persona: Priya, the day-2 returning user

Signed up two days ago, thought about it since, came back. Desktop. The persona that determines whether the product has any stickiness at all.

## Context

- **Device**: desktop, 1440x900, Chrome. Session cookie from prior signup may or may not still be valid (48 h).
- **Referral**: typed `telarchy.com` directly, or clicked their own bookmark, or followed a "come back and see" email (if such emails existed; they don't yet).
- **Attention budget**: 3 minutes to find a reason to stay. Priya has had time to cool off on the initial novelty.
- **Trust level**: fair. They believed enough two days ago to make an account. Now they need a reason to believe again.

## Background

Any of the other personas, two days later. Either Alex (came back to update a habit), Marcus (came back to check if the co-founder activated), Sam (came back to see if a bot traded), or a brand-new variant — someone who signed up, logged off, and now wonders why they should care.

## Mental model

**They already know**:
- Their own account exists and their signup credentials.
- Roughly what they tried to do on day 1.
- Nothing about what has happened since, because the product sends no emails and no push notifications.

**They don't know**:
- Whether their metric has any new data.
- Whether any market moved.
- Whether any bot traded on their behalf.
- Whether anyone else joined their workspace (if public).

## Success path

Logs back in. Immediately sees something that changed since day 1: a new trade on their market, a new bot in their workspace, a forecast that shifted, a friend who joined. Spends 2–3 minutes reading what happened. Decides whether to update a value or not. If there's any signal of liveness, bookmarks for day 3.

## Session script

- **T+00:00 — Navigate to `telarchy.com`.** If cookie still valid, lands on the dashboard. If expired, prompted to log in.
- **T+00:15 — If login**: email + password. Autofill should work. Any extra friction (email verification re-ask, 2FA) is unexpected.
- **T+00:30 — Dashboard loads.** What's the first thing Priya sees? A list of metrics? A "what's new" summary? An events feed? The answer to "what changed since I last visited?" needs to be visible in 5 seconds.
- **T+01:00 — Look for change signals.** Numbers different from day 1? Markets with new consensus? Any notification badge, activity log, or "recent updates" widget?
- **T+01:30 — Click on the most changed thing.** If a market moved, click it. See the trade history. Understand who traded and why (bot name, timestamp, direction).
- **T+02:00 — Decide.** Is there enough here to come back on day 3?
  - If yes: bookmark, move on.
  - If no: tab closed, product forgotten. Coming back on day 3 is drastically less likely.
- **T+02:30 — Look for a subscription path.** "Email me when my market moves", "Notify me when a bot trades", "Weekly digest". If no such option exists anywhere, Priya assumes they need to log in every day to get value. Most won't.

## Friction triggers

- **Blocker**: dashboard looks identical to day 1. Nothing has changed. No evidence of motion.
- **Blocker**: events or activity feed is empty, or shows only Priya's own past actions.
- **Blocker**: login fails, session expired awkwardly, or 2FA appears for no reason.
- **High**: there is no "new since you were last here" affordance. Priya has to hunt for changes.
- **High**: a bot did trade, but the trade is only visible three clicks deep (metric → market → trade history). Priya won't find it.
- **High**: no email/notification signup exists, and no explanation that emails are coming. Priya concludes the product is not trying to retain them.
- **High**: a change happened (e.g. bot trade), but the change is stale data — no fresh timestamp visible, and Priya cannot tell if the product is still alive.
- **Medium**: the "credits" or "balance" number changed in a way Priya doesn't understand, and there's no transaction log.
- **Medium**: workspace-level "activity" is only available to admins, not members. If Priya is not an admin, they see nothing.
- **Low**: no "streak" or "days since signup" gamification. Forgivable; not every product needs it.

## Conversion criteria

Identifies at least one thing that changed since day 1 and bookmarks / intends to return on day 3. Anything less than this is a silent retention failure.

## Bounce criteria

Logs out, closes tab, does not return. This is the most common MVP failure mode across the whole product category. If this persona bounces, activation work on the landing and signup is largely wasted.

## Executor notes

- Run this persona after running Alex, Marcus, or Sam (or any activating persona). Use the account created in that run. Delay is the point of the test; don't create a fresh account and immediately re-log.
- If real time-delay is impractical (integration testing), simulate by manually advancing time via DB or by triggering the cron that creates bot trades. Note this in the findings — a pure simulation is weaker evidence than a real delay.
- Check the events feed, the markets page, and the specific markets Priya traded on during the initial persona. Somewhere, there should be visible motion.
- Explicitly check whether any email was sent (check BetterAuth / any transactional provider logs, or note that no provider is wired up — this is itself a finding).
- This persona is the closest thing to a pure retention test that can be run without waiting a week.
