# Proposer liquidity: per book, purse order, and the score (2026-09-17)

**decided 2026-09-17 (Viktor)**: "yea lets do f and regarding profit what you
recommend trading credcits counting used as liquidity counting as negative
profit". Built on branch `seed-per-book`: layout F, the conservative score
rule (a stake is a cost until money comes back), counted off the ledger with
no cut-off date, so stakes already paid in the running season count too.
Found while building: the owner's buy-out on approval paid a proposer's
WALLET-funded stake back as trading credits; it now returns each part to the
purse that paid it.

What follows is the proposal as written before the decision. It follows PR 356 and the design pass on
the propose dialog.

Owner, 2026-09-17, verbatim, on being shown four layouts for one whole
amount: "it should be per market per date liqudity setting and another thing
its being taken out of liuquidty credits first right? and trading credits
second? also another thing.. if trading credist are used to fund liuqidyt it
should be counted as negative profit no? or how does it work rn", then "to
avoid gifting", "(acheating system)".

## 1. The setting is per metric and per date

PR 356 shipped one whole amount split evenly (`liquidityBudget`). The owner
wants the proposer to choose per book, the way the owner's metric sheet does
with "Proposal opens with" on each date row.

Proposed shape: `POST /api/proposals { liquidity: [{ metricId, targetDate,
amount }] }`, `amount` being credits into EACH branch book of that cell (the
same meaning the owner's date number has). Cells left out get nothing from
the proposer. The same list on the bulk route tops up an existing proposal.
`liquiditySubsidy` (one number for every book) stays for bots;
`liquidityBudget` is removed again, it is a day old and nothing uses it but
the form. Layouts: the canvas,
https://claude.ai/artifact/U8sqXk4tYE2FTGuW6F7vee.

## 2. Purse order: liquidity credits first, trading credits second

True at posting (`createConditionalMarkets` spends the wallet first). NOT
true for a top-up: the bulk route debits the trading balance only, and so
does nothing for a proposer whose pool money sits in the wallet. Fix: the
bulk route spends in the same order and records `fundedFrom` per purse, as
posting does. This is a bug fix, not a rule change.

## 3. Trading credits put into liquidity count in profit

Today profit is trades only (`routes/leaderboard.ts`): a liquidity stake is
invisible to the board and the season, in both directions. That lets one
account fund a book from trading credits and a second account trade the
subsidy out: the second account's score rises, the first one's never falls.
The household rule (PR 347) catches an owner and their own bots; it does not
catch two people.

Proposed rule: **liquidity paid from TRADING credits is a position.**

- The part of a stake paid from the trading balance counts as cost the
  moment it is paid: profit falls by that much.
- Whatever that stake returns (the pool's leftover at resolution, a void
  refund, the owner's buy-out on approval) counts as proceeds when it
  lands.
- The part paid from the liquidity wallet counts as nothing, either way: it
  was never score and its leftover returns to the wallet.

So a gift through a book costs the giver at least what the receiver gains,
and the pair's combined score cannot rise. It is conservative: an open
stake reads as fully lost until money comes back. The alternative is to mark
an open stake at the pool's current worth; it is kinder to honest makers
and needs a per-book LP valuation the board does not have.

Open questions for the owner:

1. Conservative (stake is cost until it returns) or marked to the pool?
2. Does it apply from now on, or to the running season's past stakes too?
   All-time boards would shift for everyone who ever funded a book from
   their balance, house accounts included.

## The form shows one or the other (same day)

**revised 2026-09-17 (Viktor)**, on the merged layout F: "it doesnt maek sense
to have the each book fields and per date fields at the same time visible it
should be one or the other", then, shown three ways to do that, "okay do H
then but call it \"per market\" nto per date". So the form carries a two-way
switch, "same for all" or "per market": the big numeral on one, the grid on
the other, never both. The numeral's label follows the word: "each market".
