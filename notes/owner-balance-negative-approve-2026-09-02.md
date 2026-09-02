# The owner balance went negative and an approve half-ran (2026-09-02)

**Symptom (Viktor, 2026-09-02, evening):** pressing Approve on his own
proposal "Offer Telarchy to the Manifold team" on the Telarchy floor
returned "Workspace owner balance insufficient to pay proposal reward:
need 500, have -1716.229992", while the header showed 930k credits.

**Two accounts.** The header is Viktor36, the proposer. The reward is
paid by the workspace owner participant, which for the Telarchy
workspace is the `admin` account (adminbot). Its tradeable balance was
-1716 credits with 980,916 credits in its liquidity wallet.

**How it went negative.** At 12:07 UTC two proposals were created and
their branch markets auto-funded from the owner: 12,600 credits each
(three metrics, three dates, two branches, 700 per market). The build
serving at the time checked affordability against wallet plus balance
but debited the balance alone (fixed on main that morning by commit
21820428, "Staking a contract spends the liquidity wallet first", and
live since the 20:16 UTC candidate). The second stake took the balance
from 8,634 to -3,966; leftovers from voided markets brought it to -1716.

**Second defect, the one the symptom exposed.** `approveProposal` voided
the declined branch and attempted the stake buyout BEFORE checking the
reward, so the failed approve left the proposal pending with all nine
declined-branch markets voided and refunded. The guide even documented
this as a "sharp edge". Rule now (docs/guides/proposals.md,
"Approving"): the reward is checked before anything moves; a 409 leaves
the proposal exactly as it was. Tests: `proposal-dual-branch.test.ts`,
"a reward the owner cannot pay is refused before anything changes".

**Repair applied to production, by hand:** moved 25,200 credits (the two
12:07 stakes) from admin's liquidity wallet to its tradeable balance,
recorded as a `credit_ledger` row `admin_adjustment` /
`repair` / `wallet-first-stake-repair-2026-09-02`. Result: balance
23,484, wallet 955,716. The two proposals' liquidity rows still say the
stake came from the balance (`funded_from` null), so their leftovers
will return to the balance; that is where the money now sits, so the
books close. The Manifold-team proposal's declined branches stay
voided; there is no way to un-void a refunded market. Its approve was
retried by Viktor36's session after the repair.
