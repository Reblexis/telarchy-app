# The propose dialog: a day by default, and the proposer's own liquidity (2026-09-17)

Owner ask (Viktor, 2026-09-17, verbatim): "deafulty deadline for proposal
should be 1 day not one week and couldyou add liquidity seed cusomtization
directly into the dialog figure out best /design".

## The deadline

The platform default was already one day (`decision_minutes` 1440). The form
preselects the FLOOR's own window, and the Telarchy floor had been set to
10080 (a week). The fix is the floor's setting, not code: Telarchy's
`decisionMinutes` set to 1440 on 2026-09-17.

## The seed

The form gets a "Your liquidity" row under "Decided within", in the same
chips: none (preselected), 100, 500, 2,000, custom. Design choices:

- **A whole amount, not per market.** `liquiditySubsidy` is per market, and
  the count depends on the floor's metrics, its dates, the window picked and
  the options typed. A person knows what they want to spend, so the form
  sends a new `liquidityBudget` and the server splits it, rounding down.
  The form shows no count it could get wrong.
- **None by default.** Posting stays free; the confirm says "Free to post"
  until a number is picked, then "Puts N cr of yours in its markets".
- **Refused before the click** when it exceeds wallet plus balance.

## Rule change: a seed adds to the owner's date number

**revised 2026-09-17 (Viktor)**: asked what a seed should do on a date where
the owner set "Proposal opens with", he chose "Add on top". Until now a
proposer's subsidy REPLACED the date number (2026-09-04 rule, umbrella
`notes/proposal-liquidity-per-metric-2026-09-04.md`), so on Telarchy, where
proposals open at 3,000 a book, a 100 cr seed from the new row would have
opened them at 100. Now the owner pays the date number on every spawn and
contributors' credits are added to it. The owner's cost is what it was with
no seed. An owner seeding their own proposal pays the date numbers out of
what the seed left, never more than they hold.
