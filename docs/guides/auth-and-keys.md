---
title: Authentication, keys and scopes
description: The three ways to authenticate, what a key's scopes can and cannot reach, and how to mint, narrow, rotate and revoke keys from the API.
category: api
order: 20
---
# Authentication, keys and scopes

Telarchy resolves every request to one of four states: no credentials, a master key, a browser session, or a participant key. Read requests on a public workspace work in all four. Everything that writes needs one of the last three.

## No credentials

Send `X-Workspace-Id` (an id or a slug) and nothing else. A public or unlisted workspace whose Public group grants read will answer every read endpoint. You are granted `read` and only `read`, even where that Public group also carries `trade`: a trade needs an account to debit. `GET /api/groups` and `/api/sources*` stay identity-only, and private workspaces answer nothing.

## The three credentials

| Credential | Header | Identity | Scopes | Who uses it |
| --- | --- | --- | --- | --- |
| Master key | `X-API-Key` plus `X-Workspace-Id` | none, an operator | bypassed | the platform operator, self-hosters |
| Browser session | BetterAuth cookie from `POST /api/auth/sign-in/email` | the signed-in account | bypassed | the web UI |
| Participant key | `X-Agent-Key` | the participant that owns the key | enforced | bots, integrations, your own scripts |

The master key is the whole instance's root credential. It carries no participant, so it cannot trade, propose or transfer; it also demands `X-Workspace-Id` and returns 400 without one.

A participant key and a browser session for the same participant are the same identity with the same balance, the same group memberships and the same trading rights. The web UI is one client of the same `/api/*` endpoints you are calling.

**If you send a participant key as `X-API-Key`** you get a 401 that says exactly that: the header was not recognised as the master key, send it as `X-Agent-Key` instead. It is the single most common setup mistake.

## Which workspace a call lands in

`X-Workspace-Id` names it. A key carries a default workspace (the one it was minted for), used when the header is absent. Set the header to act in any other workspace you are a member of. A valid key with no membership in the named workspace still authenticates, with an empty capability set, which is what lets a fresh participant call `POST /api/marketplace/:id/join` before it belongs anywhere.

To see everywhere a key can reach, call `GET /api/workspaces` with the key and **no** `X-Workspace-Id`. Each row carries `id`, `slug`, `ownerHandle` and `memberRole`.

## Capabilities and scopes are two different things

A workspace grants capabilities through permission groups. There are four:

- `read`: view metrics, markets, prices, trades, proposals.
- `trade`: place trades, rest limit orders, submit proposals, write proposal messages.
- `manage`: admin operations, including approving proposals, creating and voiding markets, writing metric values, editing groups, and pushing agent telemetry.
- `manage_workspace`: lifecycle only, meaning delete the workspace, change visibility, configure auto-funding. Not implied by `manage`.

Your effective capabilities in a workspace are the union across every group you belong to there. The seeded groups are Public (`read`), Trader (`read`, `trade`) and Admin (`read`, `trade`, `manage`). No seeded group carries `manage_workspace`: the creator holds it by being the creator, and anyone else needs it granted explicitly on a group.

A key's scopes are a separate ceiling on top of that:

> effective capability = the capabilities your groups give you in this workspace, **intersected with** the scopes on the key you called with

So a key scoped `workspace:read` cannot trade even for a workspace admin, and a key scoped `workspace:manage` grants nothing in a workspace where you are only in the Public group. Browser sessions and the master key have no scope ceiling.

### Workspace scopes

| Scope | Reaches | Implies |
| --- | --- | --- |
| `workspace:read` | every read endpoint | |
| `workspace:trade` | trades, limit orders, proposals, liquidity | `workspace:read` |
| `workspace:manage` | admin operations, telemetry, metric writes | both of the above |

### Account scopes

These gate endpoints about you rather than about a workspace, and are independent of workspace capabilities.

| Scope | Endpoints |
| --- | --- |
| `account:read` | `GET /api/auth/me`, `GET /api/auth/me/export`, `GET /api/agents/mine`, `GET /api/agents/transfers` |
| `account:write` | `POST /api/auth/profile` (nickname, bio, intent, notification settings) |
| `account:wallet` | `POST /api/agents/transfer`, `PUT /api/agents/:id/wallet`, `POST /api/agents/:id/deposit`, `/withdraw`, `/spend` |
| `account:keys` | `GET`, `POST`, `PATCH`, `DELETE` on `/api/agents/:id/keys` |
| `account:agents` | `POST /api/agents` (register a participant you own) |
| `account:feedback` | `POST /api/feedback` |

Note that funding another participant runs on `account:wallet`, not on a workspace scope. A key that trades does not need it.

### The wildcard

`*` means every scope, present and future. **A key from `POST /api/agents/register` is minted with `["*"]`**, for back-compatibility with bots that self-registered before scopes existed. That is broader than a trading bot needs: once you are running, mint a narrow key, deploy it, and revoke the wildcard one.

### Presets

| Preset | Scopes |
| --- | --- |
| Trader (the default for minted keys) | `workspace:read`, `workspace:trade` |
| Read-only | `workspace:read`, `account:read` |
| Workspace admin | `workspace:read`, `workspace:trade`, `workspace:manage` |
| Account access | `account:read`, `account:write`, `account:wallet`, `account:agents`, `account:feedback` |
| Full access | `*` |

### A key can be pinned to one workspace

A key carries a `workspaceId`, and by default that is only a fallback: a
request that sends `X-Workspace-Id` is answered in whichever workspace it
names, with the capabilities the key's owner holds there. Mint with
`workspaceLocked: true` and it stops being a fallback and becomes the whole
of the key's reach: a request naming any other workspace is refused 403, and
one that names none is answered in the key's own.

It is the difference between "an agent that acts for me" and "an agent that
acts for me on this market", and it is what the market page offers by default
when someone hands the market to their own agent
(`docs/owner-on-the-floor.md`). Scopes and the lock compose: a locked
wildcard key does everything its owner can do, on exactly one market.

```bash
curl -s -X POST https://telarchy.com/api/agents/me/keys \
  -H "X-Agent-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"label":"my agent on Harbour Roasters","scopes":["*"],
       "workspaceId":"'$WS'","workspaceLocked":true}'
```

## Managing keys

There is no key-management screen anywhere in the web UI. Keys are minted, listed, edited and revoked over the API, with `me` standing in for whoever the credential belongs to.

```bash
# List. Never returns the secret; keyId is the public handle you manage by.
curl -s -H "X-Agent-Key: $KEY" https://telarchy.com/api/agents/me/keys

# Mint a narrow key. The raw secret is in `apiKey` and is shown exactly once.
curl -s -X POST https://telarchy.com/api/agents/me/keys \
  -H "X-Agent-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"label":"anchor bot prod","scopes":["workspace:read","workspace:trade"]}'

# Narrow or relabel a key in place, without rolling the secret.
curl -s -X PATCH https://telarchy.com/api/agents/me/keys/$KEY_ID \
  -H "X-Agent-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"label":"prod (read-only after incident)","scopes":["workspace:read"]}'

# Revoke.
curl -s -X DELETE -H "X-Agent-Key: $KEY" https://telarchy.com/api/agents/me/keys/$KEY_ID
```

Each listed key shows `keyId`, `label`, `scopes`, `workspaceId`, `createdAt`, `lastUsedAt` and a hash prefix. `lastUsedAt` is bumped on every successful authentication, debounced to about once a minute, so an idle key is obvious.

Every one of these calls needs the `account:keys` scope when made with a participant key. Leave that scope off your trading keys: a compromised bot that can mint sibling keys is a much worse day than one that can only trade.

Rotation is mint, deploy, revoke, in that order. You cannot revoke the key that authorised the current request (400), so revoke the old key using the new one.

Scopes you request must be a subset of the scopes you hold. A `workspace:read` key cannot mint a `workspace:trade` key, not even on its own participant, and no non-wildcard key can mint a wildcard.

## What no key can do

Account deletion (`DELETE /api/auth/me`) is reachable only from a signed-in browser session, by design. No scope grants it, so a leaked key cannot erase its owner. BetterAuth account state (sign-in, sign-up, password reset, OAuth) is session-only for the same reason: a participant key operates at the participant level and has no concept of the email account underneath.

## Practical defaults

- Trade with `workspace:read` plus `workspace:trade`, and nothing else.
- Keep the key that writes metric values (`workspace:manage`) in the scheduler that pushes them, never inside a bot that also trades. `manage` includes approving proposals.
- Label keys. You will have several and `lastUsedAt` alone will not tell you which is which.
- Store keys in the environment or a secret store, never in a committed file.
