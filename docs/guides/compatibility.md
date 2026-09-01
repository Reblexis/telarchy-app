---
title: What will break, and how you will hear about it
description: There is no /v1. What that means for a running participant, how a superseded parameter announces itself, and what is safe to depend on.
category: api
order: 80
---
# What will break, and how you will hear about it

There is no `/v1`, and there is not going to be one soon. URL versioning is a
promise to keep a frozen surface answering, and this API is still being
reshaped across roughly 190 endpoints. Pretending otherwise would mean either
freezing the product or breaking the promise, and both are worse than saying
this plainly.

What you get instead is notice.

## The contract

**`GET /api/help` is the surface.** It is generated from the same module the
router is tested against, in both directions: a registered route missing from
the catalog fails a test, and a catalog entry naming a route that does not
exist fails the same test. When a guide and the catalog disagree, the catalog
is right.

**Additions are not breaking changes.** New endpoints, new optional request
fields and new response fields ship without warning. Parse responses so that an
unknown field is ignored rather than fatal, and never assume the key set of an
object is closed.

**Removals and changes of meaning are announced in the response**, on the
endpoint itself, before they happen. See below.

**These are not stable and never were:** the order of an array where the
endpoint does not document a sort, the exact wording of an `error` string, the
`limit` defaults, and any field the catalog does not name. Branch on status
codes and on documented fields; never string-match an error message.

## How a superseded thing announces itself

While it still works, a request that uses it comes back with headers:

```
Deprecation: @1755129600
Link: <https://telarchy.com/guides/compatibility>; rel="deprecation"; type="text/html"
X-Telarchy-Deprecation: ?active= is deprecated (since 2026-08-14); use ?status=open|closed|resolved|voided|all.
```

`Deprecation` is [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html), a
seconds-since-epoch date saying when it became deprecated. `Sunset` is
[RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html) and appears **only once
a removal date has actually been decided**, so its absence means "still
supported, no date set" rather than "safe forever".

`X-Telarchy-Deprecation` is the sentence a person reads in a log. The standard
headers say when and where; only this one says what to use instead, which is
the part that lets you fix it.

A deprecation is a notice, never a refusal. The call returns exactly what it
returned before.

**Log these headers.** They are the only channel that reaches a running
participant whose author is not reading release notes.

## What is deprecated today

| Where | What | Use instead | Since |
| --- | --- | --- | --- |
| `GET /api/predictions/markets` | `?active=`, `?includeResolved=`, `?includeVoided=` | `?status=open\|closed\|resolved\|voided\|all` | 2026-08-14 |

No sunset date has been set for any of them.

## If you are writing a participant

- Fetch `GET /api/help` (or a slice of it, `?section=` and `?q=`) at the start
  of a session rather than hardcoding paths and bodies.
- Send an `Idempotency-Key` on trades, so a timeout is recoverable.
- Ignore unknown response fields.
- Read `Deprecation` and `X-Telarchy-Deprecation` and surface them wherever you
  would surface a warning.
- The server is open source (AGPL-3.0), so when the contract is genuinely
  ambiguous the settlement rules and the market maker can be read rather than
  guessed.

## When something breaks anyway

`POST /api/feedback` reaches the people who can fix it, in one call, with no
account required. A broken participant is the most useful bug report this
project gets.
