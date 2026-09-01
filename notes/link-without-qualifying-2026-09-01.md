# Linking a record you cannot be paid for

**2026-09-01, Viktor:** "it should be possible to link manifold account even
if it doesnt satisfy the criteria.. jus tfor the fun of it being linked and
people seeing whos who"

**DECIDED 2026-09-01 (Viktor), built the same day.** The three decisions
below were put to him; the outcome is recorded under each. On decision 2 he
rejected both options offered and gave a third, which is the one built: "no
its not fixed even if paid.. they just cant extract from that account
again.. or from any other.." A link is always replaceable, and the money is
what is once-only.

## What happens today

One call decides two different things at once. `POST /api/import/:provider/claim`
verifies the one-time code in the bio, then runs the quality gates, and a
failure at the gates throws before anything is recorded. So an account that
is 4 days old, or flagged as a bot, or dormant, cannot be linked at all:
there is no badge, no handle on the profile, no row anywhere. The gates also
run at `start`, so such an account is refused before it is even sent to edit
its bio.

That was right when the link existed only to buy a record. It is wrong for
what Viktor is asking for, which is identity: a reader on the leaderboard
seeing that this participant is that Manifold forecaster.

The two things are already separable in the data. Proof of ownership is the
bio code. The badge lives at `record-handle:<provider>:<agentId>`. The money
lives in `earn_claims`, whose unique index on `(key, ref_id)` is what stops
one external account being paid twice. Nothing forces them to be decided by
the same call.

## The proposal

**Linking is free and ungated. Being paid for it is not.**

- `start` checks that the handle exists and nothing else. No age check, no
  bot check, no activity check, so nobody is turned away before they have
  proved anything.
- `claim` verifies the code and always records the link. Then, separately,
  it runs the gates: if they pass and the external account has not been paid
  before, it grants; if they do not, it links with `granted: 0` and the reply
  says which gate was missed, in the same sentence it uses today.
- The badge is the handle, for everybody. A reader is being told who someone
  is, not what they were paid.

That is the whole shape. What follows is the part that needs a decision.

## The three decisions

### 1. Can you come back for the money later?

A 4-day-old Manifold account is 90 days old in three months. If the free link
records nothing in `earn_claims`, the grant is still there to collect, and
re-running `claim` later pays it. If it records a zero-credit claim, the
unique index treats the account as spent and the grant is gone forever.

- **A. CHOSEN. The link records no earn claim. You can claim the grant
  later, when the account qualifies.** The link and the payment are genuinely
  independent, which is the point of the change. Costs: `claim` has to stay
  callable on an already-linked participant, and the button needs a state for
  "linked, not paid, try again when it qualifies".
- **B. A zero-credit claim is written and the account is spent.** Simpler:
  one claim per account, forever, exactly as now. But somebody who links for
  fun on day 4 silently destroys 5,000 credits they would have been owed on
  day 90, and will read that as a bug.

### 2. Can you change which handle you are linked to?

Today a participant links a provider once. If unpaid links are free, being
stuck with a typo or an abandoned account is a worse outcome than before.

- **A. Offered and rejected. An UNPAID link can be replaced; a PAID one is
  fixed.**
- **B. Offered and rejected. One link per provider, ever.**
- **C. CHOSEN, Viktor's own answer. ANY link can be replaced, paid or not.
  What is once-only is the money: no second payment from that external
  account, and none from any other either.** The badge is identity and
  identity should not be frozen by a payment; the payment rules already live
  in `earn_claims` and none of them is weakened by letting the badge move.
  One external account is still badged by at most one participant at a time,
  so relinking away releases it rather than duplicating it.

### 3. Does the badge say whether the record qualified?

- **A. CHOSEN. No. The badge is the handle and nothing else.** "People
  seeing whos who" is the whole ask; a two-tier badge turns an identity into
  a score and invites arguing about it.
- **B. Qualified links get a mark.** Honest about what was verified, but it
  publishes a judgement about somebody's Manifold account on their profile.

## What does not change

- Ownership is still proved by the bio code, so you can still only link an
  account you control. Free linking does not make impersonation possible.
- The gates still decide the money, and still decide it on age and use rather
  than balance, for the reason in `docs/record-links.md`.
- One external account is still paid at most once across the platform.
- A bot-flagged account can be linked under this proposal but never paid.
  Worth confirming that is wanted: the badge would then appear on bots.

## What was built

`record_links` (migration 0102), keyed one row per participant per provider
with a unique index on (provider, external id), holding the badge that used
to sit in `system_config`. `start` dropped its gate call; `claim` makes the
link first and decides money afterwards, answering `granted: 0` and a `why`
in the three cases that pay nothing. Copy in the dialog and in
`docs/guides/credits.md` now separates the free badge from the gated grant.
The confirmed answer on bots: they link, and are never paid.

## Cost, as estimated before the build

Small. `start` drops its gate call; `claim` moves the gate below the link
write and stops throwing on it; the reply gains `granted: 0` and a `why`.
The dialog gains one sentence for the linked-but-unpaid case. Decisions 1
and 2 are what set how much state the button has to carry.

## Open question

The earn table row reads "Link an established Manifold account". If linking
is free and only the grant is gated, that row is about the grant and should
say so ("Link an established Manifold account **and be paid for it**", or
similar). The `/earn` copy and `docs/record-links.md` both change with
whichever option is picked.
