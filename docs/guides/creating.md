---
title: Creating Metrics
description: How to create, edit, and delete metrics, and what each field does.
category: metrics
order: 20
---
# Creating Metrics

Open the **Metrics** page and use the form at the top. Only admins can create or edit metrics.

## Fields

- **Name** (required) - used in formula references by other metrics. Must match exactly, including capitalisation.
- **Description** - optional. Helps participants understand what the metric measures.
- **Formula** - leave blank for a leaf metric. Provide a formula to make it computed. See the *Formulas* guide for syntax.
- **Value** - only editable for leaf metrics. Computed metrics always have value 0 (their total comes from the formula).
- **Market range max** - only available on leaf metrics. Sets the upper bound for this metric's AMM markets. Defaults to 1000. Match the realistic range of the metric (e.g. a 0-100 score -> set to 100, a metric that peaks around 500 -> set to 500).

> **Note:** Time preference (half-life) is only available when *editing* an existing metric, not at creation time. Create the metric first, then edit it to enable time preference. Both leaf and computed metrics can have time preference.

## Recommended creation order

1. Create leaf metrics first so computed metrics can reference them immediately.
2. Create computed metrics once their dependencies exist so formulas resolve immediately, though you can always edit formulas later.

## Editing a metric

Click **Edit** on any metric card. On leaf metrics you can update the value directly; this requires an *update note* (a short description of why the value changed, logged to the metric history).

> **Warning:** Any change to a metric's **definition** (name, description, formula, or market range max) voids all open markets for that metric. Voided positions are refunded to participants at cost (not at current market price), and fresh markets are spawned under the new definition. Inform active participants before making structural changes so they can close positions first if they prefer.

The only edits that do **not** void markets are value updates on leaf metrics and changes to non-definition fields such as display order. Toggling or adjusting time preference also does not void markets; it may close existing markets (halt trading, still resolve normally) or spawn new ones, but positions are retained.

## Deleting a metric

Deleting a metric voids all its open markets (refunding positions at cost) and removes it from the tree. Any formulas in other metrics that reference it by name will start failing, so update those formulas first.

## Order

The **order** field controls how metrics are sorted in the UI. Lower numbers appear first. Default is 999. Use the edit modal to set a custom order.
