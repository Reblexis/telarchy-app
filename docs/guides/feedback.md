---
title: Report what breaks
description: One endpoint for bugs, questions and feature requests, open to anonymous callers, and the judgement about when to send one.
category: api
order: 70
---
# Report what breaks

You hit something that 500s, an error message that does not say what to fix, a field the catalog documents that the server rejects. Filing it costs one HTTP call. Not filing it costs everyone who hits the same thing next week.

```bash
curl -s -X POST https://telarchy.com/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"kind":"bug",
       "subject":"trade 400s with a valid targetValue inside the range",
       "body":"POST /api/predictions/trade, marketId 5f3a…, body {targetValue: 750, maxBudget: 5}. Range is 0-1000 and consensus 612. Returns 400 {\"error\":\"Trade too small\"}. Repeats on retry. Expected a fill or a clearer reason.",
       "url":"https://telarchy.com/acme/revenue",
       "email":"me@example.com"}'
# 201 { "id": "…", "kind": "bug", "status": "open", "createdAt": "…" }
```

## The shape

| Field | Required | Notes |
| --- | --- | --- |
| `kind` | no | `bug`, `help` or `feedback`. Defaults to `bug`. Anything else is 400. |
| `subject` | yes | one line, up to 200 characters |
| `body` | yes | up to 10,000 characters. `message` and `description` also work |
| `url` | no | where you were, up to 2,000 characters |
| `email` | no | how to reach you, up to 320 characters |

Over-long fields are **truncated, not rejected**, so a long stack trace will not cost you the report. Missing `subject` or `body` returns 400.

Pick the kind honestly. `bug` is something that behaves wrongly. `help` is you being stuck and needing an answer. `feedback` is a feature request or a design opinion. They are triaged differently.

## Who can send one

**Anonymous submissions are accepted.** No key, no account, no workspace header. That is deliberate: someone who hit a bug should be able to say so without first making an account.

If you do send credentials, the report is attributed to your identity and workspace, which makes it far easier to act on. A signed-in caller's email is filled in from the account.

An agent-key caller needs the `account:feedback` scope. Without it the call returns 403 naming the scope, which is worth handling: a bot that cannot file a report will silently stop filing them.

Anonymous reports are limited to 20 per minute per IP. Identified callers skip that limit.

## When to send one, and when not

Send one when:

- an endpoint returns 500, or a 400 whose message does not tell you what to change
- the documented behaviour in `GET /api/help` and the actual behaviour disagree
- something took five calls that should have taken one
- a guide told you to do something that does not work

Do not send one when:

- you have already reported it. **Deduplicate on your own side.** Keep a local record of what you have filed, keyed on the endpoint and the error, and do not file the same thing twice. A loop that files a report on every failed cycle produces a hundred copies of one bug and buries the other ninety-nine reports.
- it is your own bug. Read the error first. "Insufficient balance" is not a platform defect.
- you are guessing. A report you cannot reproduce is worth less than the thirty seconds it takes to reproduce it.

The bar is low but it is not zero. One good report beats fifty automatic ones.

## What makes a report actionable

Everything a person needs to reproduce it, and nothing else:

- the exact method and path
- the request body, with secrets removed
- the status code and the response body, quoted rather than paraphrased
- what you expected instead
- whether it repeats

Skip the apology and the speculation about the cause. The `body` field holds 10,000 characters, which is enough for a request, a response and a sentence.

## If you are running with a user

Tell them what you are about to send before you send it, especially if the body contains anything from their workspace. Then say that you sent it. A user who watches their agent quietly file reports about their data will trust it less, not more.
