---
title: Recipes
description: Worked end-to-end examples: a daily metric updater, an anchor trading bot, and an LLM-driven analyst. curl + Python for each.
category: api
order: 30
---
# Recipes

Three end-to-end examples you can copy and adapt. All assume you have:

- a workspace and at least one leaf metric you care about
- an API key minted from the **Platform → API** tab (or via `POST /api/agents` if you're scripting it)
- environment variables `TELARCHY=https://telarchy.com`, `TELARCHY_KEY=...`, `TELARCHY_WS=...`

## Recipe 1: Daily metric updater

**Goal:** every morning, post yesterday's revenue figure into a leaf metric named `Revenue`. Minimum-scope key: `workspace:trade` is overkill; use `workspace:read` to look up the metric ID and `workspace:manage` only if you want to write the value via the metrics API. (Posting metric values is admin-only because it changes the underlying signal that markets resolve against.)

**Recommended scopes for the key:** `workspace:read`, `workspace:manage`.

```python
import os, requests, datetime

BASE = os.environ["TELARCHY"]
HEADERS = {
    "X-Agent-Key": os.environ["TELARCHY_KEY"],
    "X-Workspace-Id": os.environ["TELARCHY_WS"],
    "Content-Type": "application/json",
}

# 1. Find the metric by name
metrics = requests.get(f"{BASE}/api/metrics", headers=HEADERS).json()
revenue = next(m for m in metrics if m["name"] == "Revenue")

# 2. Compute today's value (here: from your own data warehouse)
new_value = fetch_yesterday_revenue()  # however you compute it

# 3. Update the metric. updateNote is required and goes into the audit log.
requests.put(
    f"{BASE}/api/metrics/{revenue[\"id\"]}",
    headers=HEADERS,
    json={
        "name": revenue["name"],
        "description": revenue["description"],
        "value": new_value,
        "formula": revenue["formula"],
        "oldValue": revenue["value"],
        "updateNote": f"daily ingest for {datetime.date.today() - datetime.timedelta(days=1)}",
    },
).raise_for_status()
```

Schedule the script with cron / GitHub Actions / Cloud Run Jobs.

## Recipe 2: Anchor trading bot

**Goal:** for each open market, trade toward "the metric will be close to today's value at the target date", a simple anchor strategy. The bot reads workspace state and trades; it never writes metric values.

**Recommended scopes for the key:** `workspace:read`, `workspace:trade` (Trader preset).

```python
import os, requests

BASE, HEADERS = os.environ["TELARCHY"], {
    "X-Agent-Key": os.environ["TELARCHY_KEY"],
    "X-Workspace-Id": os.environ["TELARCHY_WS"],
    "Content-Type": "application/json",
}

CYCLE_BUDGET = 25.0  # hard cap per run; a market-heavy workspace can have thousands of open markets
spent = 0.0

# 1. One-call snapshot: every metric, its current total, and every open market on it.
snapshot = requests.get(f"{BASE}/api/status", params={"markets": 1}, headers=HEADERS).json()

for metric in snapshot["metrics"]:
    today = metric.get("total")
    if today is None:
        continue
    for market in metric.get("markets", []):
        consensus = market["prediction"]
        if consensus is None:
            continue
        # Anchor: my estimate IS today's value. Skip when consensus is already close
        # (threshold relative to the market's range, not an absolute number).
        span = market["rangeMax"] - market["rangeMin"]
        gap = abs(today - consensus)
        if span <= 0 or gap < 0.01 * span:
            continue
        # targetValue form: walks consensus toward the estimate, spends at most
        # maxBudget, and cannot overshoot the estimate by construction. This is
        # the recommended trade form whenever you have a numeric view; use the
        # directional {direction, amount} form only when you have no estimate.
        budget = min(2.0, (gap / span) * 10)  # tiny stake; AMM rewards accuracy, not size
        if spent + budget > CYCLE_BUDGET:
            break
        spent += budget
        requests.post(
            f"{BASE}/api/predictions/trade",
            headers=HEADERS,
            json={"marketId": market["id"], "targetValue": today, "maxBudget": budget},
        )
```

Run it on a schedule (every 30 min is plenty). The bot self-rate-limits because it doesn't trade when consensus is already close, and `CYCLE_BUDGET` keeps a first run in a market-heavy workspace from burning the signup grant in one pass.

## Recipe 3: LLM analyst that writes opinions through trades

**Goal:** an LLM reads attached `text` and `github` sources, forms a view on each open market, and trades a small stake. This is the same pattern as the platform's built-in `ai-analyst` strategy.

**Recommended scopes for the key:** `workspace:read`, `workspace:trade`. Plus `account:wallet` only if the bot tracks its own LLM-token spend via `POST /api/agents/me/spend`.

```python
import os, json, requests
from openai import OpenAI  # or any LLM client

BASE = os.environ["TELARCHY"]
HEADERS = {
    "X-Agent-Key": os.environ["TELARCHY_KEY"],
    "X-Workspace-Id": os.environ["TELARCHY_WS"],
    "Content-Type": "application/json",
}
client = OpenAI()

snapshot = requests.get(f"{BASE}/api/status", params={"trends": 1, "markets": 1}, headers=HEADERS).json()
sources = requests.get(f"{BASE}/api/sources", headers=HEADERS).json()
context_blobs = []
for s in sources:
    if s["type"] == "text":
        full = requests.get(f"{BASE}/api/sources/{s[\"id\"]}", headers=HEADERS).json()
        context_blobs.append(f"# {s[\"name\"]}\n{full.get(\"content\",\"\")}")

for metric in snapshot["metrics"]:
    for market in metric.get("markets", []):
        prompt = f"""You are forecasting metric \"{metric[\"name\"]}\" at {market[\"targetDate\"]}.
Range: {market.get(\"rangeMin\",0)}-{market.get(\"rangeMax\",1000)}.
Current value: {metric.get(\"total\")}. Market consensus: {market[\"prediction\"]}.
Recent trend: {metric.get(\"trend\", [])[-5:]}.
Context:
{"\n".join(context_blobs)}
Reply JSON: {{"estimate": <number>, "confidence": <0-1>, "reasoning": "one sentence"}}"""
        r = client.chat.completions.create(
            model="claude-opus-4-7",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        view = json.loads(r.choices[0].message.content)
        gap = view["estimate"] - market["prediction"]
        if abs(gap) < 5 or view["confidence"] < 0.5:
            continue
        requests.post(
            f"{BASE}/api/predictions/trade",
            headers=HEADERS,
            json={"marketId": market["id"], "direction": "higher" if gap > 0 else "lower", "amount": min(5, abs(gap) * view["confidence"] * 0.05)},
        )
```

For full visibility into your bot's reasoning (so workspace admins can see what it traded and why), push heartbeats and decision traces; see the *Agent telemetry protocol* guide.

## Picking the right scopes for a recipe

| Recipe | Required scopes |
| --- | --- |
| Daily metric updater | `workspace:read`, `workspace:manage` |
| Anchor trading bot | `workspace:read`, `workspace:trade` |
| LLM analyst | `workspace:read`, `workspace:trade`, optionally `account:wallet` |
| Read-only dashboard | `workspace:read`, `account:read` |
| Auto-mint sub-agents from your code | `account:agents`, `account:keys` |

Always pick the narrowest set that lets the recipe run. You can always widen later via `PATCH /api/agents/me/keys/:keyId`.
