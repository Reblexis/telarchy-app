# The X workbench

A surface on `/admin` where the owner turns one X post into a reply worth
sending, argues with the draft until it is right, records what he actually
posted, and gets later drafts that are shaped by what worked.

It exists because reading X programmatically costs money the owner has not
chosen to spend, but reading ONE post by id is free, and the owner always has
the id: he is looking at the post. So the workbench takes the id as its input
and never needs a search credential.

## What the owner does

1. Pastes an X post URL or id.
2. Sees the post: author, text, likes, replies, when.
3. Gets a drafted reply in his voice, with a one-word reason.
4. Talks to it ("shorter", "lead with the number", "you are wrong about the
   Google market") until the draft is right. The conversation is the feature,
   not a nicety: the first draft is a starting position, and the argument is
   where his judgement enters.
5. Copies the final text, or opens X with it prefilled, and posts it himself.
6. Pastes back the id of the reply he posted, so the workbench can watch it.
7. Reads the log: every reply he sent, what it earned, and what the pattern
   across them says.

Nothing here posts to X. The workbench drafts and remembers; the owner sends.
That line is not a technical limit, it is the rule that keeps his account his
(X suspends accounts that automate posting, and copy under his name is the one
thing he must approve).

## Reading a post

`cdn.syndication.twimg.com/tweet-result?id=<id>&token=<derived>` returns a
public post's text, author, and counts with no credential. The token is a
deterministic function of the id, which is why this works without a key. It is
an undocumented endpoint: when it breaks, the workbench must say so plainly
rather than showing an empty post, and the owner can paste the text by hand
(the draft only needs the text).

What it gives: `text`, `user.screen_name`, `user.name`, `favorite_count`,
`conversation_count`, `created_at`. It does NOT give impressions, so
"performance" here means likes and replies, and the log says that.

## Drafting

One Anthropic call, the same rules the reply queue uses (one to three
sentences, add a number or a counterexample, never pitch, never link, no
em-dashes, skip when there is nothing to say), plus two things the queue does
not have:

- **The conversation.** Every turn of the owner's argument with the draft is
  sent back, so "shorter" means shorter than the last one.
- **What worked before.** The prompt carries a compact digest of his recorded
  replies: the five that earned the most and the five that earned nothing,
  each with its length, whether it carried a number, and whether it disagreed.
  The model is told to notice the pattern, not to copy the winners.

**The voice profile lives in the database, not in this repo.** It is his
writing samples and the facts he is allowed to state, it is personal, and this
repository is prepared for a public release. `/admin` has a textarea for it;
seeding it is a one-time paste. With no profile, drafting still works and says
in the UI that it is writing generically.

## Performance and what it learns

`POST /api/cron/x-metrics` refreshes counts for every recorded reply whose
post id is known, newest first, oldest refreshed least often. Cloud Scheduler
runs it every six hours; a reply's numbers move fastest in its first day and
barely after a week.

The log shows each reply with its likes, replies, the post it answered and
that post's author size, plus a summary line: median engagement, the share of
replies that got any engagement at all, and which of the three tracked
features (carries a number, disagrees, under 200 characters) is associated
with the better half. With fewer than ten recorded replies the summary says so
instead of pretending to a pattern; three data points are not a finding, and
copy advice from three data points is how superstition starts.

## Endpoints

All platform admin. Documented in `/api/help` like every other route.

| Endpoint | Effect |
|---|---|
| `POST /api/admin/x/lookup` | `{ url or id }` -> the post, or a clear failure |
| `POST /api/admin/x/draft` | `{ postId, postText, messages[] }` -> `{ reply, reason }`, the conversation carried in `messages` |
| `POST /api/admin/x/record` | `{ sourcePostId, text, replyId? }` -> stores what he sent |
| `PATCH /api/admin/x/record/:id` | `{ replyId }` -> attach the id once he has it |
| `GET /api/admin/x/log` | recorded replies, their metrics, and the summary |
| `GET/PUT /api/admin/x/profile` | the voice and facts text |
| `POST /api/cron/x-metrics` | refresh metrics (scheduler) |

## Storage

One table, `x_replies`: the source post (id, author, text, author follower
count if known), what he sent (text, reply id, when), the metrics (likes,
replies, refreshed-at), and the derived features used by the summary. Append
only in spirit: a recorded reply is never edited except to attach its id and
its metrics.

`x_voice_profile` is a single row of text with an updated-at.

## What it is not

Not a scheduler, not a poster, not an inbox. It does not find posts (that is
the reply queue over Hacker News and Manifold, and the owner's own saved
searches on X). It handles the step between "I am looking at a post worth
answering" and "I have answered it well and know whether it worked".
