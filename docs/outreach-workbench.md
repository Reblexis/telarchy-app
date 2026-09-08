# The outreach workbench

A surface on `/admin` where the owner keeps the people he has decided to
write to personally, gets each message drafted in his voice from what is
known about that person, argues with the draft until it is right, sends it
himself through the channel the person actually reads, records what came
back, and gets later drafts shaped by what worked. It is the X workbench's
sibling (`docs/x-workbench.md`) for direct messages instead of public posts,
and it shares the voice profile, the drafting model and the rule that
nothing here sends anything.

It exists because the first customers come from the founder writing to
people one at a time (the record behind that is in the umbrella's notes,
`notes/yc-first-customers-outreach-2026-09-07.md`), and a list kept in a
markdown file cannot learn: it does not know which message got a reply,
which channel was dead, or that "under 75 words" was true of every reply
that came back.

## The prospect

One row per person. What the workbench knows about them is what the draft
is allowed to say:

- **Who**: name, the company or product, the segment they belong to (a short
  label the owner chooses; today A agent operator, B public MRR, C
  decision-market believer, E approval bottleneck, F Steam developer, door
  for people already on Telarchy).
- **Where they read**: the channel kind (`x`, `email`, `linkedin`, `bluesky`,
  `hn`, `discord`, `other`) and the handle, address or URL.
- **The evidence**: free text, the facts the research verified about them in
  their own words: what they run, the number they are judged on, the
  decision they have open, the source and its date. A draft may quote only
  what is here; a fact not in the evidence is not a fact.
- **The message**: the current draft, editable by hand at any time.
- **The conversation**: the turns of the argument about the draft, kept so
  "shorter" means shorter than the last one.
- **Status and outcome**: `draft`, `ready`, `sent`, `replied`, `call`,
  `workspace`, `activated`, `no`; the planned send day; when it was sent and
  the exact text that went out (frozen at that moment); a note on what came
  back (their words, or "no answer").

Prospects arrive one at a time through the form, or many at once through an
import of the same shape (that is how a researched list becomes rows).

## What the owner does

1. Picks a prospect. Sees the evidence and the message side by side.
2. Gets a draft, or a fresh one. The draft is in his voice, hooks on the
   decision the evidence says they have open, quotes only the evidence, is
   under 75 words, asks one thing, carries his name and the one link
   (`telarchy.com/lookpilot`, his own number run the same way).
3. Argues with it ("shorter", "don't mention the sale", "why lead with the
   API cost?"). Every turn comes back as the revised message and what it
   says to him; both stay on screen.
4. Edits the text by hand if he wants; the textarea is the message.
5. Sends it himself: the channel link opens where the person reads (their X
   profile for a DM, a mailto with the message prefilled, the LinkedIn or
   Bluesky profile, the HN user page), and "Copy" puts the text on the
   clipboard. "I sent this" freezes the text, stamps the time and moves the
   row to `sent`.
6. Records what came back: a status and a note in their words. A reply is
   evidence, whatever it says.
7. Reads the log: who was written to, on what channel, what came back, and
   what the pattern across them says.
8. Copies a log line for the contract that this outreach was promised on:
   `NN. NAME (SEG), sent DATE via CHANNEL. Answer: ... Floor: ...`, one line
   per person, so the traders who priced the promise can count.

Nothing here sends. The workbench drafts, links and remembers; the owner
sends. Copy under his name is the one thing he must approve, and a DM
tool that sends is the fastest way to lose an account.

## Drafting

Same model, same effort, same fallback and the same no-dashes rule as the X
workbench (`X_DRAFT_MODEL`, `X_DRAFT_EFFORT`, `X_DRAFT_FALLBACK`; docs/x-workbench.md,
"Drafting"). The system prompt carries, in this order:

- **The rules for a first message to a stranger.** Answer first, under 75
  words, one ask, his name in the first line, the hook is the decision they
  have open, quote only the evidence, never flatter, never explain the
  mechanism (the link does that), say it is free and why, no em-dashes.
- **The voice profile** (shared with the X workbench; one row, his samples
  and the facts he may state).
- **The lessons.** A text the owner keeps, in his words, of what he has
  learned sending these: which openings got replies, which channels are
  dead, what to stop doing. Editable on the surface. Empty until he writes
  it.
- **The record.** A compact digest of every message sent so far with what
  came back: the channel, the segment, the length, whether it named a
  number, whether it named a decision, and the outcome. The model is told to
  notice the pattern, not to copy a message that worked; the same person
  written to twice with the same words is spam.

The user turn is the prospect: name, segment, channel, the evidence, and the
current message if there is one; then the argument so far.

## What it learns

The log shows each prospect with its channel, segment, sent date and
outcome, plus a summary: how many sent, how many answered, the reply rate by
segment and by channel, and which of three tracked features (under 75
words, names a number, names their decision) is associated with a reply.
With fewer than ten sent it says so instead of pretending to a pattern.

"Ask" answers a question about the outreach (which segment to push, why a
message got nothing, what to try next) from the record and the lessons,
says which it rests on, and says when neither answers.

## Endpoints

All platform admin. Documented in `/api/help` like every other route.

| Endpoint | Effect |
|---|---|
| `GET /api/admin/outreach/prospects` | every prospect, the summary, whether drafting is configured |
| `POST /api/admin/outreach/prospects` | create one `{ name, company?, segment?, channel, handle?, evidence?, message?, day? }` |
| `POST /api/admin/outreach/prospects/import` | `{ prospects: [...] }`, the same shape, many at once; returns the count |
| `PATCH /api/admin/outreach/prospects/:id` | edit any field; `{ status: 'sent' }` freezes `sentText` and stamps `sentAt` |
| `DELETE /api/admin/outreach/prospects/:id` | remove one |
| `POST /api/admin/outreach/prospects/:id/draft` | `{ messages[] }` -> `{ draft: { message, answer } }`, the conversation carried in `messages` |
| `POST /api/admin/outreach/ask` | `{ messages[] }` -> `{ answer }` |
| `GET/PUT /api/admin/outreach/lessons` | the lessons text |

## Storage

`outreach_prospects`: one row per person with the fields above; the
conversation as JSON; `sent_text` and `sent_at` set once when the status
first becomes `sent` and never changed after. `outreach_lessons`: one row of
text with an updated-at, like `x_voice_profile`. Evidence, messages and
notes are personal (names, handles, what strangers wrote back) and live in
the database, never in this repository.

## What it is not

Not a sender, not a sequencer, not a CRM for a sales team. It holds the
thirty to a few hundred people one founder writes to himself, and it makes
each next message better than the last because the last one is on record.
