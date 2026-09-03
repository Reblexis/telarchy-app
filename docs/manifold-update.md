# The Manifold update

A card on `/admin` that writes the standings update the owner posts as a
comment on the Telarchy recruiting market on Manifold
(`manifold.markets/Telarchyagents/how-many-manifold-users-will-claim`).
It exists because he posts the same update every few days and was assembling
it by hand from two API responses. The card assembles it; he copies it and
posts it himself. Nothing here posts to Manifold.

## What the owner does

1. Opens `/admin`. The card already shows the text, read fresh on every load.
2. Presses "Copy", pastes it as a comment on the market.

## What the text says

Three parts, in this order, in plain text that survives a paste into
Manifold's comment box:

1. **Status.** The number the market resolves on: linked Manifold accounts,
   the same `manifoldImportCount` that `GET /api/marketplace/stats` reports.
   "Status: 12 linked Manifolders."
2. **By settled profit.** Every entrant of the current season, in the order
   the season standings rank them, each with the prize the season would pay
   if it settled now and the settled score behind it:
   `1. @CharlyBone ($192.99 | +232.91cr settled)`. Entrants whose settled
   score is zero share one line at the end, ranked as a group:
   `4.-8. @Quroe, ert, pokos ($0 | +0cr settled so far)`. An entrant with
   a negative settled score is listed on their own line with the negative
   number, not hidden in the group.
3. **Total if prices hold.** The top five entrants by the marked score (open
   positions valued at the current call, `markedScore` in the standings),
   each with the prize the pool would pay on that mark, rounded to whole
   dollars: `2. @Quroe ($276 | +1172.61cr total)`. Entrants whose mark is
   zero or below are not listed here.

Names are Manifold handles where the entrant has linked one, prefixed with
`@` so Manifold renders a mention; otherwise the Telarchy nickname, plain.

Every number comes from the season standings (`GET /api/leaderboard?seasonId=`)
and from the linked count, never recomputed here: the card must agree with
the season page to the cent, because the comment is a public claim about who
is winning money.

With no running season the card carries only the status line and says that
no season is running.

## Surface

`GET /api/admin/manifold-update` (platform admin only) returns
`{ text, linked, seasonId, generatedAt }`; the card renders `text` in a
read-only box with a Copy button. Read-only on purpose: the wording is fixed
by this doc, and a change to it is a change here first.
