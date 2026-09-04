# The X workbench

A surface on `/admin` where the owner turns one X post into a reply worth
sending, argues with the draft until it is right, records what he actually
posted, and gets later drafts that are shaped by what worked.

It exists because reading X programmatically costs money the owner has not
chosen to spend, but reading ONE post by id is free, and the owner always has
the id: he is looking at the post. So the workbench takes the id as its input
and never needs a search credential.

## Finding posts: the search loop

X search needs a paid credential, so the workbench does not search. It proposes
a query, the owner runs it himself on X, and he pastes back the ids he found.
That manual step is what makes the loop learn: a query is remembered with what
it produced, and the next proposal is chosen against that record.

1. **Get a search prompt.** One query in X's search syntax, plus one line on
   why. The proposal is made against every query already tried and what each
   yielded: posts pasted back, replies sent, likes earned. A query that
   returned a hundred posts he never answered scores worse than one that
   returned three he did, which is why yield is counted in replies rather than
   in results. The proposal comes back with what it says to him, and he can
   argue with it as with a draft ("narrower", "not about Polymarket", "why
   this one?"): the next turn answers and proposes again. "Another search"
   starts over and avoids every query already proposed. The model hands the
   proposal back as a structured field (a tool call), never as prose to be
   scraped: a fenced code block, a preamble, or a rationale long enough to
   lose its closing brace is not a reason for the button to fail. A reply
   that carries no query at all is the only failure, and it says so.
2. **Run it on X.** The link opens the query on the Latest tab, because Top is
   the algorithm again. Following it records the query, which is what starts
   counting its yield.
3. **Paste back the ids.** Up to 25 links or ids at a time, whitespace or comma
   separated. Each is read so he can see what he is about to answer, and the
   count lands on the search whether or not he replies to any: "this query
   surfaced nothing usable" is exactly the signal the next proposal needs.
4. **Work on one**, which loads it into the workbench below. A reply sent from
   a candidate is recorded against its search, so the yield is real rather than
   inferred.

## What the owner does

1. Pastes an X post URL or id.
2. Sees the post: author, text, likes, replies, when.
3. Gets a drafted reply in his voice, with a one-word reason and its answer
   to him.
4. Talks to it ("shorter", "lead with the number", "you are wrong about the
   Google market", "why that number?") until the draft is right. Every turn
   comes back as two things: the revised text, and what it says to him
   about it (what it changed, why it holds its ground, or the answer to what
   he asked). Both stay on screen, so the exchange reads as a conversation
   and not as a vending machine. The conversation is the feature, not a
   nicety: the first draft is a starting position, and the argument is
   where his judgement enters.
5. Copies the final text, or opens X with it prefilled, and posts it himself.
6. Pastes back the id of the reply he posted, so the workbench can watch it.
7. Reads the log: every reply he sent, what it earned, and what the pattern
   across them says.

Nothing here posts to X. The workbench drafts and remembers; the owner sends.
That line is not a technical limit, it is the rule that keeps his account his
(X suspends accounts that automate posting, and copy under his name is the one
thing he must approve).

## Writing his own post

The same loop, mirrored: instead of pasting someone's post he types an idea
(a sentence, a number he wants to say, a rough draft) and gets a post in his
voice, with a one-word reason for its shape and its answer to him. He argues
with it exactly as with a reply, sends it himself, and pastes back the id so
it is watched like a reply. Nothing here posts to X.

What a draft post obeys, learned from the record of what travels on X for
founders in this space (the research is a record, kept in the umbrella's
notes, and the rules here are what it concluded):

- Text only. If there is a link, it goes in the first reply, never in the
  body. No hashtags, no @mentions of large accounts, no emoji.
- Two to four lines, 100 to 280 characters, the meaning in the first line.
- A number only when it is real and in the voice profile, and then early.
  A market that was right is stated beside the thing it missed; a record is
  never boasted without the miss.
- No pitch, no "we are excited", nothing that reads as marketing. Written
  the way he would say it to a friend.
- Never bait, never rage, never a fight with a critic: one credible reader
  muting the account costs more than a hundred likes.
- Reason is one word naming the shape: called-it (a market resolved),
  test (something the reader can check), milestone (numbers), demo (the
  thing working, prompt quoted), quote (answering a bigger account's
  complaint with what was built), correction, or other.

## Asking it what to post

He can ask it questions instead of handing it a draft: what kind of posts to
write, whether an idea is worth one, why a reply earned nothing, what to try
next week. It answers from three things, in this order of trust, and says
which one an answer rests on:

- **His own record.** Every search, reply and post recorded here, with what
  each earned. His base rate beats anyone else's.
- **The playbook.** What is measured to travel on X for founders in his
  space: the ranking code X published, large-sample benchmarks, a sample
  read from X itself, comparable founders' posts and their own lessons, and
  YC's launch and writing advice. The playbook is bundled content in the app
  (`functions/src/content/x-playbook.ts`), distilled from the research
  record kept in the umbrella's notes, and is revised when that record is.
- **The voice profile.** Who he is and what he can truthfully say.

When neither the record nor the playbook says, it says so rather than
inventing a rule, and a number it quotes comes from one of them. An answer
that ends in something to post says so; "Write a post" is where that goes
next. It is the same argument as everywhere else here: the turns are kept,
so a follow-up means what it meant in the last one.

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

One call to the smartest model that will do the job, thinking at high
effort, for every proposal the workbench makes (a reply, a post, a search
query). `X_DRAFT_MODEL` names it (default `claude-opus-5` on the Anthropic
key; a slug with a provider prefix such as `openai/gpt-5.6-luna` goes through
the Vercel AI Gateway on the floor's key, at the same effort) and
`X_DRAFT_EFFORT` sets the effort (default `high`); both change without a
deploy. Fable 5.1 is not the default because it refuses this job outright
(a refusal stop with no content, every time, on replies and posts alike).
A refusal from whichever model is set is retried once on `X_DRAFT_FALLBACK`
(default `claude-opus-5`, skipped when it is the same model), and if that
refuses too it is an error he sees, never an empty draft. Every proposal is
a conversation: it comes back with what it says to him, he pushes back or
asks, and the next turn answers and revises. A draft never carries an
em-dash or an en-dash; one the model wrote anyway becomes a comma before he
sees it.

A reply follows the rules the reply queue uses (one to three sentences, add a
number or a counterexample, never pitch, never link, skip when there is
nothing to say), plus two things the queue does not have:

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
| `POST /api/admin/x/draft` | `{ postId, postText, messages[] }` -> `{ reply, reason, answer }`, the conversation carried in `messages` |
| `POST /api/admin/x/ask` | `{ messages[] }` -> `{ answer }`, a question about what to post, answered from his record and the playbook |
| `POST /api/admin/x/compose` | `{ idea, messages[] }` -> `{ post, reason, answer }`, his own post from an idea, same conversation shape |
| `POST /api/admin/x/record` | `{ kind?, sourcePostId?, text, replyId? }` -> stores what he sent; a `post` has no source, a `reply` must have one |
| `PATCH /api/admin/x/record/:id` | `{ replyId }` -> attach the id once he has it |
| `GET /api/admin/x/log` | recorded replies, their metrics, and the summary |
| `GET/PUT /api/admin/x/profile` | the voice and facts text |
| `POST /api/cron/x-metrics` | refresh metrics (scheduler) |
| `POST /api/admin/x/searches/suggest` | `{ avoid? }` -> `{ suggestion: { query, rationale } }` |
| `POST /api/admin/x/searches` | keep a query he decided to run |
| `GET /api/admin/x/searches` | every query with its harvested / replies / likes |
| `POST /api/admin/x/searches/:id/harvest` | `{ ids }` -> the posts, and the count against the search |

## Storage

One table, `x_replies`: the kind (`reply` or `post`), the source post for a
reply (id, author, text, author follower count if known; absent for a post
of his own), what he sent (text, its id on X, when), the metrics (likes,
replies, refreshed-at), and the derived features used by the summary. Append
only in spirit: a recorded row is never edited except to attach its id and
its metrics.

`x_voice_profile` is a single row of text with an updated-at.

`x_searches` holds the query, its rationale, and `harvested`, the number of
posts pasted back from it. `x_replies.search_id` is the link that lets a query
be judged by the replies it produced.

## What it is not

Not a scheduler, not a poster, not an inbox. It does not search X (nothing can, without a
paid credential; it proposes queries the owner runs himself). Finding posts
elsewhere is the reply queue's job, over Hacker News and Manifold. It handles the step between "I am looking at a post worth
answering" and "I have answered it well and know whether it worked".
