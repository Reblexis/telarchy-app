---
id: 00-anonymous-agent-builder-path
tags: [browse, fast]
isolation: global
parallel-safe: true
needs: [browse]
timeout: 60s
goal-horizon: short
goal-statement: |
  A visitor finds Agent builders in the homepage footer and a prominent
  Build an agent link on /for-agents and Copy setup prompt button on /agents#agent-setup, without an account.
---

# Agent-builder discovery

Governing copy: `docs/audience-pages.md`. Destination: `docs/guides/build-agent.md`.

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B goto "$TT_FRONTEND_URL/" && $B wait --networkidle
$B js 'Array.from(document.querySelectorAll("a")).some(a => a.textContent.trim() === "Agent builders" && a.pathname.endsWith("/for-agents"))' | grep -q true
$B goto "$TT_FRONTEND_URL/agents#agent-setup" && $B wait --networkidle
$B js '(() => { const a = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Copy setup prompt"); return a && document.querySelector(".agent-builder") && document.querySelector("#agent-instructions"); })()' | grep -q true
$B screenshot "/tmp/$TT_NS-agent-builders.png"
$B goto "$TT_FRONTEND_URL/guides/build-agent" && $B wait --networkidle
$B js 'document.body.innerText.includes("Run the deterministic starter") && document.body.innerText.includes("Run the LLM-assisted starter") && document.body.innerText.includes("Connect an AI agent that uses tools")' | grep -q true
```

The supplied frontend URL can include `/beta`; links must stay within its base.

## Guided setup

- At desktop and 390px width, the first screen asks only Who acts? and What
  can it do?, with line icons and a signal diagram. Copy is enabled with no
  workspace selected, even if the public workspace request fails.
- Copy each identity/access combination. The prompt preserves those choices,
  names deterministic, LLM and tool-based strategies, and helps choose starter
  code and deployment. A read-only prompt forbids live trades.
- Reload and log in: identity and access remain. Connection stays collapsed.
  Expand it to choose a public workspace and create a key. An unknown workspace
  is explained there; it never blocks copying or changes the prompt context.
- Signed in with no previous memberships, use an isolated test bot: creation
  joins you to the public workspace as disclosed. Create with zero credits, connect for
  research, then explicitly enable trading. The final key is workspace locked
  with read/trade only. The setup prompt and browser storage contain no key.
- Create another bot with initial credits; confirm the owner's debit and bot's
  credit. Interrupt the response and resume: no second starting transfer.
  Check a failed top-up's balances before enabling another transfer.
- Act as me has no bot creation or funding controls. Log out while a connection
  is pending: it stops subsequent steps and does not reveal the key.

## Agents and keys

- Logged out, Agents & keys offers a login link without requesting owned data.
- Logged in, use the account menu's Agents & keys link to reach this section.
  Account settings has Profile, Money, Notifications and Security only.
- Check your account and each owned bot's balance, earnings, and activity.
  Expand Manage keys, rename a key without changing custom scopes, explicitly
  switch a test key to research-only, and revoke it through the named confirmation.
- Create a test key for an existing workspace: it is workspace locked, its raw
  secret appears only once, and Dismiss removes it. A failed copy stays selectable.
- Fund an isolated bot and refresh its balance. A failed response blocks repeat
  funding until balances are checked. Finishing setup adds the bot to this list.
- Sign out or change accounts with a key panel open: prior rows and secrets disappear.
