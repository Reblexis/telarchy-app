# A settings edit stripped trade from a published floor (2026-09-02)

**Symptom (Viktor, 2026-09-02, evening):** "why the hell cant i trade on
this", on the Wallpaper Animator floor (owner patrik_cihal), proposal
"I will lower the price to 5 USD". The page showed the market with no
ticket at all.

**Cause.** The page draws the ticket only when the floor's Public group
holds `trade` (`joinAs: trader`). The group held `read` alone. The
request log for the floor: created unlisted 14:38 UTC, published by
`PUT /settings {visibility: public}` at 15:59:57 (joins turned from 404
to 201 right after, and the grant from PR #151 ran, since every build
serving that day carried it), then a second `PUT /settings` at 20:01:40
that did not name visibility. The strip condition was
`restrictedToMembers(update.visibility) && !restrictedToMembers(ws.visibility)`
and `restrictedToMembers(undefined)` is true, so every settings write
without a visibility key on a public floor took `trade` away. The grant
half already checked `!== undefined`; the strip half did not.

**Rule (docs/guides/creating.md, "Public means tradeable"):** only a
write that names `visibility` touches the Public group. Test:
`join-visibility.test.ts`, "a settings edit that does not name
visibility leaves the Public group alone". PR #178.

**Repair applied to production, by hand:** the floor's Public group set
back to `["read","trade"]` at 21:05 UTC. Of the four public floors it was
the only one affected.
