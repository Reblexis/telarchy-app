---
id: 06-participants-send-credits
tags: [browse]
isolation: account
parallel-safe: false
needs: [auth]
timeout: 180s
goal-horizon: short
goal-statement: |
  As a signed-in participant on someone else's profile, I can send them
  credits, I am asked once more before anything moves, and afterwards both
  the message and the profile's Transfers section show what I sent.
---

# Browse test: Sending credits from a profile

## What this tests

docs/ui-conventions.md, "The participant profile", Sending credits. A
transfer cannot be taken back and counts as a loss in a running season, so
the ticket sends only on a second press that names the amount and the person.

Backed by `src/components/__tests__/SendCreditsTicket.test.tsx` and the
"sending credits" block of `src/pages/__tests__/ParticipantProfilePage.test.tsx`.

## Preconditions

- Auth: a participant account with a tradeable balance of at least 10 cr.
- `$OTHER`: the handle of any other participant. `$ME`: your own handle.

## Steps

1. Signed out: `$B goto $BASE/participants/$OTHER`. Expect a "Send credits"
   pill right of the name. `$B click [data-testid=prof-send]` lands on
   `/login?next=%2Fparticipants%2F$OTHER`.
2. Sign in, return to the profile. `$B click [data-testid=prof-send]`.
   Expect a dialog "Send credits": "Send to", `$OTHER`, an empty amount, a
   disabled "Send" button, "Sent credits cannot be taken back."
3. `$B fill "#send-credits-amount" "999999999"`. Expect "You have N cr. Send
   that or less." and the button disabled.
4. `$B fill "#send-credits-amount" "5"`, `$B fill "#send-credits-note" "qa send"`.
   Expect "Your balance after" five lower than the top bar's balance, and the
   button "Send 5 cr". While a season runs and you have entered it, expect
   "Your <season> score" with "-5".
5. `$B click [data-testid=send-credits-submit]`. Expect NO transfer yet and
   the button "Confirm: 5 cr to $OTHER" in the accent colour.
6. Press it again. Expect the dialog to close, "Sent 5 cr to $OTHER." under
   the header, a top row in Transfers "Received 5 cr from $ME" with the
   sub-line "qa send", and the Balance cell five higher.
7. `$B goto $BASE/participants/$ME`. Expect no "Send credits" pill, and a top
   Transfers row "Sent 5 cr to $OTHER".

## Known gaps

- The uncertain-result state (a reply that never arrives) is covered by the
  unit suite only; a browser cannot drop one response on demand.
