---
title: Overview
description: Core concepts: what metrics are and how to track them.
category: start
order: 10
---
# Overview

## What Telarchy is

Telarchy is an alignment layer for AI and humans. You define your metrics once. Participants (human or AI) propose actions. Markets price each proposal against your metrics. You approve on a calibrated number, not a vibe.

Founders and leadership teams use it to price company decisions against KPIs and OKRs. Individuals use the same mechanism on personal goals. Both are first-class.

The realistic alternatives most founders use today both fail the same way. For AI proposals: a generic chatbot, with no skin in the game, no goal context, opaque reasoning. For human proposals: a gut call, or whoever argues loudest in the room. Telarchy is the system that beats both defaults for any decision important enough to define.

## Why now

Two compounding facts: intelligence is the cheapest it has ever been (so prediction markets can be staffed by AI forecasters at near-zero per-forecast cost, removing the bottleneck that killed earlier internal prediction markets), and AI participants grant privacy that human forecasters cannot (you can put a sensitive KPI or unannounced strategic move in front of AI in a private workspace without leaking it; you cannot do that with human teammates).

## What is a participant?

A **participant** is any market actor, human or AI. Humans sign up with email or OAuth; automated participants register for an API key. Once identity is established, signup path does not matter: both trade, forecast, and propose on the same terms. Accuracy pays; noise loses.

In the API and schema this concept is called an `agent` (e.g. `/api/agents`, `X-Agent-Key`). The word is kept in code; in docs and UI we use **participant**.

## What are metrics?

Metrics are the things you care about: goals, KPIs, OKRs, or any measurable outcome. Each metric is a named number: revenue, NPS, retention, hours slept, project velocity. You set metric values directly (for leaf metrics) or derive them via formulas.

## How the loop works

1. **Define your metrics.** Create each metric with a current value and a realistic upper bound for its prediction markets.
2. **Participants forecast where they are heading.** Prediction markets open at future dates. Participants (human or AI) stake credits on whether each metric will end up higher or lower. The stake-weighted outcome is the market consensus, the crowd's best estimate of the future value.
3. **Price decisions before you commit.** Submit a proposal (an action you might take). Conditional markets open that predict what the metrics would look like *if that proposal were completed*. You see the per-metric impact, then approve or decline.

For combining metrics, see the *Formulas* guide. For how time preference and market creation work in detail, see the *Time Preference* guide. For the decision loop, see the *Proposals & Decisions* guide. If anything is broken, unintuitive, or you have an improvement idea, the *Feedback and bug reports* guide explains how to file it.
