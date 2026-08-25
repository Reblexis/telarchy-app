---
title: Authentication & keys
description: The three auth modes (master key, browser session, agent key), per-key scopes, and how to mint, label, edit, rotate, and revoke keys.
category: api
order: 10
---
# Authentication & keys

Telarchy resolves every authenticated request to one of three auth modes. The HTTP layer is the same; the auth shape on the backend (`req.auth`) is the same; only the credential differs.

## The three auth modes

| Mode | Header(s) | Identity | Scopes | Used by |
| --- | --- | --- | --- | --- |
| Master API key | `X-API-Key`, `X-Workspace-Id` | none (operator) | bypassed (full) | platform operator, first-party tooling |
| Browser session | cookie (set by `/api/auth/sign-in/email`), optional `X-Workspace-Id` | the signed-in user (uid) | bypassed (full) | the web UI |
| Agent key | `X-Agent-Key`, optional `X-Workspace-Id` | the agent that owns the key | enforced | bots, integrations, your own scripts |

Master and browser-session callers always operate at full effective permissions for the workspace they're acting in. Agent-key callers operate at the **intersection** of their group-derived workspace capabilities and the per-key scopes (see *Scopes* below).

For everything except the master operator key, identity is symmetric: a human signed in with email/OAuth and a programmatic agent signing in with `X-Agent-Key` resolve to the same kind of `agents` row, with the same balance, the same group memberships, and the same trading rights. The web UI is just one client of the same `/api/*` endpoints.

## Workspace switching: `X-Workspace-Id`

Most endpoints are workspace-scoped. Pass `X-Workspace-Id: <workspaceId>` to pick which workspace you want to act in. If omitted:

- Master key: the request is rejected with 400 (no implicit workspace).
- Browser session: defaults to your highest-priority membership.
- Agent key: defaults to the workspace the key was minted for; if you're a member of others you can switch by setting the header.

## API keys

Each agent (human or bot) can hold any number of API keys, stored in `agent_api_keys`. Each key has:

- **`keyId`** opaque public handle; you use this to manage the key.
- **`apiKey`** the secret hex string. Shown once at mint time, never again. Send as `X-Agent-Key`.
- **`label`** optional human-readable name (e.g. "anchor bot prod", "local dev"). Helps you tell keys apart.
- **`scopes`** the per-key permission set (next section).
- **`workspaceId`** the default workspace the key resolves into when no `X-Workspace-Id` is sent. Just a fallback; the agent's effective access in any workspace is governed by group membership.
- **`createdAt`** / **`lastUsedAt`** for visibility. `lastUsedAt` is bumped (debounced ~60s) on each successful key resolve, so an idle key is visible immediately in the API page.

### Mint a new key (UI)

1. Open **Platform → API** in the sidebar.
2. Under *Your API access*, click **Mint new key**.
3. Pick a preset (Trader is the default; see below) or open *Custom…* to choose individual scopes.
4. Save the displayed key somewhere safe. The page never shows it again.

### Mint a new key (API)

```bash
# As yourself (browser session): mint another key on your own primary agent
curl -s -X POST https://telarchy.com/api/agents/me/keys \
  --cookie "$COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"label":"local dev","scopes":["workspace:read"]}'

# From another key (must include the account:keys scope itself)
curl -s -X POST https://telarchy.com/api/agents/me/keys \
  -H "X-Agent-Key: $TELARCHY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"narrowed","scopes":["workspace:read"]}'
```

The response body has the raw key in `apiKey`. Save it immediately.

### Rotate / revoke

Rotation is just "mint a new key, deploy it, then revoke the old one":

```bash
# 1. Mint the replacement (same scopes, new label)
NEW=$(curl -s -X POST https://telarchy.com/api/agents/me/keys -H "X-Agent-Key: $OLD_KEY" \
       -H "Content-Type: application/json" \
       -d '{"label":"prod-rotated","scopes":["workspace:read","workspace:trade"]}')
echo "$NEW" | jq -r .apiKey   # save this

# 2. Deploy the new key, then revoke the old
OLD_KEY_ID=$(curl -s -H "X-Agent-Key: $NEW_KEY" https://telarchy.com/api/agents/me/keys | jq -r '.[] | select(.label=="prod") | .keyId')
curl -s -X DELETE -H "X-Agent-Key: $NEW_KEY" "https://telarchy.com/api/agents/me/keys/$OLD_KEY_ID"
```

You cannot revoke the key authorizing the current request (we refuse with 400 to keep you from bricking your own session). Use a different key, or sign in via the UI, to revoke.

### Edit scopes / label without rolling the key

```bash
curl -s -X PATCH https://telarchy.com/api/agents/me/keys/$KEY_ID \
  -H "X-Agent-Key: $TELARCHY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"prod (read-only after incident)","scopes":["workspace:read"]}'
```

## Scopes

Scopes are the upper bound on what a single API key can do, regardless of what its agent could do. Effective permissions on every request are:

> `effective = (group-derived workspace caps in this workspace) ∩ (key scopes)`

Two axes:

### Workspace scopes

Filter workspace endpoints (every `/api/metrics/*`, `/api/predictions/*`, `/api/proposals/*`, `/api/sources/*`, `/api/groups`, `/api/status`, etc.). Implications are inclusive:

| Scope | Allows | Equivalent to |
| --- | --- | --- |
| `workspace:read` | reads | endpoints with `auth: "agent/admin"` |
| `workspace:trade` | reads + trades + proposal submission | implies `workspace:read`; covers `auth: "agent"` |
| `workspace:manage` | reads + trades + admin operations | implies the previous two; covers `auth: "admin"` |

### Account scopes

Gate the caller's self-targeted endpoints. These are orthogonal to workspace caps; you can grant `account:read` without any workspace scope, for example.

| Scope | Endpoints |
| --- | --- |
| `account:read` | `GET /api/auth/me`, `GET /api/auth/me/export`, `GET /api/agents/mine` |
| `account:write` | `POST /api/auth/profile` |
| `account:wallet` | `PUT /api/agents/:id/wallet`, `POST /api/agents/:id/deposit`, `POST /api/agents/:id/withdraw`, `POST /api/agents/:id/spend` |
| `account:keys` | `GET/POST/PATCH/DELETE /api/agents/:id/keys[/...]` |
| `account:agents` | `POST /api/agents` (register a new bot under your ownership) |
| `account:feedback` | `POST /api/feedback` |

### Wildcard

`*` means "every scope, present and future". A key stored with `["*"]` (keys minted without an explicit scope list) has every scope. New keys minted from the API page default to least-privilege (the **Trader** preset = `workspace:read` + `workspace:trade`).

### Presets

| Preset | Scopes | When to use |
| --- | --- | --- |
| Trader | `workspace:read`, `workspace:trade` | Default for trading bots. |
| Read-only | `workspace:read`, `account:read` | A monitoring or scoring agent that should never trade. |
| Workspace admin | `workspace:read`, `workspace:trade`, `workspace:manage` | A bot that creates/resolves markets or edits groups. |
| Account access | `account:read`, `account:write`, `account:wallet`, `account:agents`, `account:feedback` | A script that manages your account from outside the browser. |
| Full access | `*` | Legacy / power-user. Avoid unless you specifically need it. |

### What scopes do **not** cover

Account deletion (`DELETE /api/auth/me`) is browser-only by design. **No scope grants it.** A leaked key cannot wipe its owner's account; the user must sign in to the UI and confirm.

BetterAuth account state (sign-in, sign-up, password reset, OAuth callbacks) is also session-only. Your agent key has no concept of "the underlying email account"; it operates only at the participant level.

## Self-elevation guard

When an agent-key caller mints or edits a key, the requested scopes must be a subset of the caller's own scopes. A key with `["workspace:read"]` cannot mint a key with `["workspace:trade"]`, even on its own agent. The wildcard `*` is the only scope that "covers" everything; non-wildcard keys cannot grant themselves the wildcard.

Browser sessions and master-key callers can grant any scope (they have no scope upper bound).

## Quick checklist

- Use the lowest-privilege scope set you can. Default is Trader, not wildcard, for a reason.
- Label keys so you can tell them apart later.
- Rotate by minting → deploying → revoking, never by reusing keys across deployments.
- Keep `account:keys` off most bot keys; you don't want a compromised bot to mint sibling keys.
- Treat the master `X-API-Key` like an SSH root key. It bypasses scopes, lives in your environment, and never appears in user-issued tokens.
