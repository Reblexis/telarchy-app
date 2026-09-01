# Session replay: watching what a visitor actually did (2026-09-01)

**Not built. Deliberately.** Viktor asked whether it was possible, was shown
the numbers below, and the cheaper half shipped instead: visitor JOURNEYS, the
ordered path of every anonymous visitor, reconstructed from the log already
being written (`docs/ui-conventions.md`, "Journeys"). This note stays as the
costing for the recorded-DOM version, which becomes `docs/session-replay.md`
if it is ever built.

**Why not now (2026-09-01).** ~25 human uniques a day and 13 signups in the
preceding fortnight. At that volume replay would show a few dozen people
bouncing in eight seconds and leave the reason to guesswork, while the consent
banner it requires would tax 100% of visitors to observe them. The trigger to
revisit is paid traffic: once a click costs money, knowing whether the page
wasted it is worth the banner.

## What was asked

Viktor, 2026-09-01: "would it be possible to record individual user sessions
on the website, essentially all of their clicks on the website, all of their
actions, so that we can see exactly where did they stop interacting with it,
what possibly made them leave... even for the unsigned-up ones, essentially,
if anybody visited the website, see what kind of actions does he make in what
order, so that we can then retrace it and then see exactly what we can
improve."

And the constraint that shapes the whole design: "make it generally so that if
we introduce new updates and so on, that it works with them as well, and we
don't have to constantly update it."

## The one decision everything else follows from

**Record the DOM, never named events.**

The usual way to answer "where did they stop" is to sprinkle
`track('clicked_join')` calls through the interface. That is the thing that
rots. Every new page needs new calls, a renamed button silently stops
reporting, and the failure is invisible: the funnel keeps drawing a chart, it
just quietly reports zero for a step that moved. Six weeks after a redesign the
numbers are wrong and nothing says so.

[rrweb](https://github.com/rrweb-io/rrweb) records the DOM mutation stream
instead: every node that appears, every attribute that changes, mouse position,
clicks, scroll, viewport, input. Replaying it reconstructs the page as a video
with a scrubbable timeline. A page that did not exist yesterday records itself,
because it is made of DOM like every other page. That is the entire answer to
"works with new updates": there is nothing per-page to maintain, so there is
nothing to forget.

Cost of this choice: you get sessions to watch, not counts to aggregate. Counts
stay where they already are, on the server, where the route is the contract
(`page_visits`, `services/participant-funnel.ts`). Never define a funnel step as
a CSS selector; that is the named-event failure wearing a different hat.

## The design

**One mount point.** The recorder starts once in `src/main.tsx`, before the
router, and never again. No page opts in, no route registers itself. A new
route is recorded because it is a route.

**Masking is deny-by-default.** `maskAllInputs: true`, plus an explicit
allowlist of fields whose text is safe to read back. The inverse (mask
`.password`, mask `#iban`) is the version that breaks: a form field added next
month is unmasked, its contents land in a recording in plain text, and nobody
finds out. This is the one place where "keeps working through updates" is a
safety property rather than a convenience, and it is why the default has to be
the closed one. The app stores payment handles, IBANs and API keys, so a
recorder that fails open is not shippable.

**Recordings do not depend on the live site.** rrweb replay re-fetches
stylesheets by URL unless told otherwise, so after a redesign an old recording
replays wearing today's CSS, which makes it a lie about what the visitor saw.
`inlineStylesheet: true` and `collectFonts: true` snapshot the styling into the
recording itself. Images still reference their URLs and will 404 once a deploy
replaces the content-hashed assets; accepted, because inlining them multiplies
the payload and the DOM and text are what a replay is read for.

**Every session carries the build it ran against.** The git SHA the UI was
built from, the viewport, the entry path, the referer. Watching a session from
three weeks ago without knowing which interface it was is guesswork, and
"sessions on the current build only" is the filter you want most of the time.

**Identity is a random id in `localStorage`.** No account needed, which is the
point: the anonymous visitors are the ones who leave. A signed-in session
additionally records the participant id, so a stranger who signs up mid-session
stays one story.

**The recorder can never break the page.** Start it inside a try/catch, and let
any error inside it stop recording permanently and silently. A recorder that
throws on a page shape it has not seen would break exactly the new features
this design exists to cover.

**Retention: 30 days**, purged by the same cron that purges `page_visits`, so
the privacy policy keeps one window rather than two. Payload is roughly 50 to
200KB per session compressed; at current traffic the storage is a rounding
error, and at any traffic where it is not, the sampling rate is one constant.

## What has to change outside the recorder

- **Privacy policy.** It currently says "We use no third-party analytics,
  tracking cookies, or advertising." Self-hosting keeps "third-party" true;
  the sentence still needs rewriting, because recording a visitor's screen is
  a collection the policy has to name, and section 1 needs a row for it.
- **A consent banner, which the site does not have.** Session replay is not
  strictly necessary under GDPR/ePrivacy, so it needs opt-in consent before
  the first frame is recorded, not after. This is the largest single piece of
  work in the proposal and the only visitor-facing one.
- **An admin-only player** at `/admin`, listing sessions newest first with
  duration, entry path, page count and whether they signed up, and replaying
  one on click.

## The alternative, and why not

PostHog's free tier gives replay, an autocaptured event stream and funnels for
one script tag, and its capture is DOM-based too, so it satisfies the
durability requirement equally. It removes the player, the ingest endpoint, the
purge job and the storage question: real work that self-hosting keeps.

Against it: visitors' recorded screens leave the estate, the privacy policy's
third-party sentence goes, and the consent banner is still required. At
Telarchy's traffic every session gets watched by hand anyway, so the
aggregation PostHog is good at is the part least needed. Recommendation is
self-hosted rrweb; the case for PostHog gets stronger the moment traffic is
too large to watch.

## Estimate

A day for the recorder, ingest route, storage and admin player. The consent
banner and the policy rewrite are their own smaller piece and gate the rest,
because nothing may be recorded before consent exists.
