# The linked-accounts count is links, not payments (2026-09-02)

Record for `docs/metrics.md`, "Manifold accounts linked".

Earlier the same day, "the verified set is who was paid" (commit
3f99f7bb) made every public Manifold number read `earn_claims`, including
`manifoldImportCount`, the resolution source of the public market
https://manifold.markets/Telarchyagents/how-many-manifold-users-will-claim.
That afternoon the owner linked his own Manifold account (Viktor36, five
days old, no bets), the 90-day gate correctly refused the grant, and the
market's number did not move. The public count had also dropped from 11
to 10 with the redefinition, because one earlier badge had no paid claim.

**Owner decision 2026-09-02 (Viktor):** "it should count me too? fix
it.. wherever the bug comes from". The market asks how many Manifold
users will *link* their account, so the count is links: `record_links`
rows with `provider = 'manifold'`, paid or not. The verified-trader count
and the data room's verified-participants count stay on paid claims; the
two questions are kept apart so a fresh account moves the linked number
and never the trader count.

Risk accepted: a fresh Manifold account can now move the market's
resolution number. The market is the owner's own and small.
