# Metrics Tracker Evolution: Prediction Markets + Futarchy

## Vision

The metrics tracker evolves from a passive measurement system into an active governance and forecasting engine. AI agents participate in prediction markets on metric values, staking credits on their forecasts. The market produces a consensus forecast for every metric. Over time, this consensus feeds back into the metrics themselves (future utility composition), and conditional markets enable futarchy — using prediction markets to make decisions.

The core thesis: **capitalism for alignment**. Agents that bet high on your Utility metric have a financial incentive to actually improve it. The market makes manipulation transparent and expensive. Bad predictors go broke, good predictors accumulate influence.

## Current State

### Phase 1: Agent Economy (Implemented)

AI agents register, receive per-agent API keys, and participate in a credit-based economy.

- **Roles**: `admin` (full access), `agent` (read metrics, place predictions), `pending` (awaiting approval)
- **Authentication**: per-agent API keys (SHA-256 hashed), Firebase auth for admin, master API key for scripts
- **Balance tracking**: `balance`, `gifted`, `earnedBetting`, `spentBetting`, `spentTokens` — separate counters for full auditability
- **Admin UI**: agents page with role management, credit distribution, PnL display

### Phase 2: Prediction Layer (Implemented)

Agents place predictions on metric values, staking credits. Markets are created by admin.

- **Markets**: explicit entities created by admin (metric + target date). Agents can only bet on existing markets.
- **Scoring**: `payout = stake * 2 * max(0, 1 - |predicted - actual| / max(|actual|, 1))`. Perfect = 2x, 50% off = break-even, 100%+ off = total loss.
- **Resolution**: market-driven. When a market resolves (admin trigger or daily cron), all predictions on it are scored and payouts credited.
- **Consensus**: stake-weighted average of all unresolved predictions per market. Available via API.
- **Admin UI**: markets page with create/delete, consensus display, resolve button.

## Planned Phases

### Phase 3: Future Utility Composition

**Goal**: Metric formulas incorporate forward-looking market consensus, not just current values.

Currently, composite metrics aggregate their children's current values. In Phase 3, the formula system gains access to prediction market consensus. A metric formula could reference `consensus(metricId, date)` to include what the market predicts a metric will be worth at a future date.

**Why this matters**: The top-level Utility metric becomes forward-looking. It doesn't just reflect where things are — it reflects where agents collectively believe things are going. This is the key bridge between prediction markets and governance.

**Key work**:
- Extend the formula evaluator to support a `consensus(metricId, targetDate)` function
- Define how consensus terms are weighted relative to current values (configurable per metric)
- Handle edge cases: no market exists, no predictions yet, stale markets
- UI: show current vs. forward-looking values on metrics page

**Example**: If the Utility metric's formula includes `0.7 * current + 0.3 * consensus("utility", "2026-06-01")`, then 30% of the displayed utility score is what agents predict it will be in ~4 months. Agents that game current values but tank the consensus signal would be detectable.

### Phase 4: Futarchy Sessions

**Goal**: Use conditional prediction markets to make decisions.

Futarchy is Robin Hanson's idea: "vote on values, bet on beliefs." In practice: when facing a decision (A or B), you open conditional markets — "what will Utility be if we do A?" vs "what will Utility be if we do B?" — and pick whichever option the market says leads to higher utility.

**How it works**:
1. Admin creates a **futarchy session** with a decision question and 2+ options
2. For each option, a conditional market is created: "what will metric X be at date Y, given we choose option Z?"
3. Agents place predictions on each conditional market
4. The option with the highest consensus predicted utility wins (or admin can override)
5. After the decision is executed, the chosen option's market resolves normally; other markets are voided (stakes refunded)

**Key work**:
- `futarchySessions` collection: question, options, status (open/decided/resolved), chosen option
- `conditionalMarkets` extending markets with a `sessionId` and `optionId`
- UI: session creation, option comparison view, decision execution
- Refund logic for unchosen-option predictions

**Example**: "Should we prioritize feature X or feature Y this sprint?" Two conditional markets predict Utility 2 weeks out. The market says feature X leads to higher predicted utility — so you do X. Later, you resolve the market and reward accurate predictors.

### Phase 5: AMM Upgrade

**Goal**: Replace the system-as-counterparty scoring rule with a proper automated market maker.

The current prediction pool model is simple but has limitations: agents bet against the system (not each other), there's no continuous price discovery, and the payout function is fixed. An AMM (like a constant-product or LMSR market maker) enables:

- **Continuous pricing**: the market has a live "price" (probability or expected value) that moves with each trade
- **Agent-to-agent interaction**: agents effectively trade against the pool, meaning early accurate predictors profit more
- **Better incentive alignment**: the AMM naturally rewards information providers and punishes noise

**Key work**:
- Choose AMM mechanism (LMSR is well-suited for prediction markets)
- Replace the fixed scoring rule with AMM-based share trading
- Handle liquidity seeding (admin provides initial liquidity, or auto-seed from market creation)
- Update resolution to distribute AMM pool payouts
- UI: show live market prices, price history charts

## Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Admin UI   │────▶│  Cloud Functions  │────▶│  Firestore   │
│  (React)     │     │  (Express API)   │     │              │
└─────────────┘     └──────────────────┘     │  agents      │
                           ▲                  │  agentApiKeys│
┌─────────────┐            │                  │  markets     │
│  AI Agents   │───────────┘                  │  predictions │
│  (OpenClaw)  │   X-Agent-Key auth           │  metrics     │
└─────────────┘                               │  updates     │
                                              └──────────────┘
```

## Design Principles

1. **Simplicity first** — each phase builds on the last with minimal new concepts. No premature complexity.
2. **Admin control** — markets are created by the admin, not by agents. The admin decides what questions are worth asking.
3. **Transparency** — all balances, predictions, and market consensus are visible via API. No hidden state.
4. **Evolvability** — the prediction pool model is designed to be replaced by an AMM. The market/prediction separation makes this swap clean.
5. **Capitalism for alignment** — the economic incentives align agent behavior with improving the metrics you care about.
