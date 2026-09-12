# Announcements by email

One message, one named audience, sent once, recorded per recipient.

Telarchy's other mail is per-event: something happened on a floor and the
people it happened to are told. A broadcast is the other kind. Nobody did
anything to earn it, so it carries obligations the per-event mail does not:
it must be easy to stop, it must never arrive twice, and afterwards it must
be possible to say exactly who received it and who did not.

## The audience

`season-entrants` is the only audience. It is every entry of a prize season
whose `optedIn` is true, addressed at the entry's `contactEmail`; where that
is empty the account's own address is used, and an entrant with neither is
recorded as unreachable rather than skipped quietly.

The address is the identity here, not the participant. A season entrant may
have registered through the API and have no account at all, which is the
whole reason the entry carries an address of its own.

## Unsubscribing

**Every broadcast can be stopped from inside the message, without a login.**
Three ways, all of which reach the same suppression list:

- `List-Unsubscribe` names a one-click URL and a `mailto:`, and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` tells the mail client
  it may use the URL without asking. A `POST` to it unsubscribes and answers
  200 with nothing to read, as the one-click standard requires.
- The same URL opened in a browser (`GET`) unsubscribes and says so on a
  plain page. It takes no session: a reader who never had an account can
  still stop the mail.
- The `mailto:` reaches a real mailbox, for a client that offers only that.

The URL carries no database row: the token is the address and a keyed
signature of it, so it cannot be guessed, cannot be enumerated, and never
expires. A token that does not verify unsubscribes nobody and says so.

**The suppression list is keyed on the address.** One unsubscribe covers
every future broadcast to that address, whoever holds it, whether or not
they hold an account. Per-event notification mail is governed by the
participant's own switches and is not affected: a person who stops
announcements still hears that their market settled.

## Sending

A broadcast is created and sent by one call, `POST /api/admin/broadcasts`,
platform admin only. The rules it enforces:

- **Nothing is silently dropped.** Every recipient gets a row saying `sent`,
  `failed` (with the provider's error) or `suppressed`. The existing
  transport swallows failures so a comment never fails because mail did;
  here the opposite is wanted, and the result is written down.
- **Paced.** At most two sends a second, because the provider's limit is
  where an unpaced loop starts losing messages, and a rejected send there is
  indistinguishable from a delivered one.
- **Capped at 500 recipients.** A broadcast is a small, deliberate thing sent
  by a person who is watching. Above the cap it is refused rather than run.
- **Sent at most once per address per broadcast.** Re-running a broadcast
  that half-failed sends only to the addresses that have no `sent` row, so a
  retry finishes the job instead of writing to everyone twice.
- **Reply-to is a mailbox a person reads.** `floor@telarchy.com` sends but
  receives nowhere, and a mail nobody can answer is not an announcement.
- `dryRun` resolves the audience, applies the suppression list and writes
  nothing, so the size and the recipients can be read before committing.

## What a broadcast is not

It does not post an announcement on a floor, it does not notify anyone in
the app, and it is not a mailing list with subscriptions. It is a message
the operator decided to send, once, to people who are already here.

## API

| Endpoint | Who | What |
|---|---|---|
| `POST /api/admin/broadcasts` | platform admin | Create and send. Body `{ subject, body, audience: 'season-entrants', seasonId?, replyTo?, dryRun? }`. Returns `{ broadcastId, audience, sent, failed, suppressed, unreachable, recipients? }`. |
| `GET /api/admin/broadcasts` | platform admin | What has been sent, newest first, with its counts. |
| `GET /api/unsubscribe/:token` | anyone | Unsubscribes the address the token names, and says so. |
| `POST /api/unsubscribe/:token` | anyone | The same, for one-click clients. 200, empty. |
