---
title: Metric Design
description: How to define metrics correctly: the genie principle, commitments vs hypotheses, and connecting multiple workspaces.
category: metrics
order: 10
---
# Metric Design

## Terminal vs instrumental values

Your metrics should represent what you actually want: the things you value in themselves, not because of what they produce.

A **terminal value** is something you want for its own sake. An **instrumental value** is something you want because it helps you get something else. The practical test: *"Would I still want this if it caused nothing else?"* If yes, it's terminal. If you find yourself saying "I want X because it leads to Y," and Y is already tracked, then X is instrumental and probably belongs as a sub-metric rather than a top-level metric.

This is not a strict rule; the distinction is personal and sometimes blurry. Intelligence might be purely instrumental for one person and genuinely terminal for another. The point is to notice when you are putting a means into a metric and ask whether you actually want it for itself.

The same principle applies to sub-metrics in a hierarchy. Sub-metrics that break down a top-level component should themselves aim at outcomes (what things actually look like when they are going well) rather than activities or proxies. A perfectly-achieved sub-metric should correspond to a real state you want, not just a high score on a measurement.

## The genie principle

**Assume the system is a perfect optimizer. Your only proposal is to define your metrics correctly.**

The system will optimize exactly what is defined. Treat it as a genie that grants your wish with perfect competence, and, like a genie, it will deliver precisely what you asked for, not what you meant. If the definition has holes, a perfect optimizer will find and exploit them. The failure is always in the definition, never in the optimizer.

The design question is therefore not *"will the system actually achieve this?"* but *"if this were perfectly achieved, would I actually want that outcome?"*

Apply this test to every metric:

> Imagine every metric is maximized perfectly: every sub-metric at its optimal value, every leaf at the number the formula rewards most. Walk through the real-world state that corresponds to. Is that genuinely the outcome you want? Is anything important missing or distorted?

If the answer is no, there is a hole in the definition. Common failure modes:

- **Missing a dimension** - your metrics are maximized but something that genuinely matters is not represented anywhere. The optimizer ignores it entirely because it has no incentive to protect it.
- **Wrong proxy** - a leaf metric is a proxy for the real thing, and the proxy can be satisfied without satisfying the underlying goal. Revenue is up; the business is hollowed out. A rate metric is high; the denominator was gamed. The metric is satisfied; the goal is not.
- **Perverse trade-off** - two sub-metrics can be traded against each other in ways the formula allows but you would never endorse. Maximizing their sum permits one to collapse entirely as long as the other overcompensates.

The fix in every case is the same: adjust the definition until a perfect optimizer achieving it gives you exactly the outcome you want, no more, no less.

## Measure outcomes, not activities

Activities are how you achieve outcomes. They are not the outcome itself. Tracking an activity as a metric violates the genie principle: if the system maximizes the activity, you get more of the activity, not the outcome it was meant to cause.

Common examples of activity/outcome confusion:

- *Lines of code committed* vs *product output* - a perfect optimizer maximizes commits, not quality
- *Support tickets closed* vs *customer satisfaction* - a perfect optimizer closes tickets fast, not well
- *Features shipped* vs *user retention* - a perfect optimizer ships continuously, not usefully

The correct approach: define the **outcome** as the metric, then test causal links via proposals. If you believe a certain activity will improve an outcome metric, create a proposal (*"Will doing X improve metric Y?"*) and let conditional markets evaluate the hypothesis. The metric stays at the level you actually care about.

This also keeps the metric tree legible: a tree of outcomes shows what you value. A tree of activities shows a to-do list dressed up as a goal hierarchy.

## On double-counting

If a quantity genuinely affects utility through multiple independent paths, counting it more than once is correct, not a mistake. A strong capability might contribute directly to output *and* independently to resilience or reputation. Representing both paths in the formula reflects that real dual importance, and a perfect optimizer will strengthen that dimension accordingly.

Double-counting is only a problem when it is *unintentional*, when a metric appears in multiple places because of structural inertia rather than genuine belief that both paths are real. The question to ask is not "does this appear more than once?" but "do I actually believe this thing matters in each of the ways I have modelled?"

## Metrics are commitments

A metric declares that some quantity *certainly* matters in a known way. This is a strong claim, and it should be. The system will optimize exactly what you measure, so defining the wrong metric is a definition error, not a system failure.

**Define metrics at the level of abstraction you are genuinely certain about.** When in doubt, keep the definition closer to the outcome you actually care about rather than a speculative upstream cause. If the causal link between a candidate metric and your real goal is uncertain, that uncertainty belongs in a **proposal**, not in the metric definition.

> **Example.** You want to improve team output, so you define a metric tracking lines of code committed per week. A perfect optimizer produces more commits. Actual output may stay flat or decline. The causal link was assumed, not verified. The correct approach: keep *Output* as a direct assessment metric, then create a proposal (*"Will increasing commit frequency improve Output?"*) and let conditional markets evaluate that hypothesis.

## Proposals are hypothesis tests

Any time you are unsure whether X will improve metric Y, that uncertainty belongs in a **proposal**, not in the metric definition. Conditional markets answer "what would metrics look like if this proposal were completed?" and the crowd's money resolves the uncertainty.

This separation prevents over-specification:

- Metric definition: *what do I actually care about?*
- Proposal: *will doing this improve what I care about?*

Proposals can also be used to evaluate metric structure changes. If a participant suspects that tracking a new quantity would improve the system, they can submit a proposal (*"Add metric X and observe its relationship to our goals"*) and let conditional markets judge whether that structural addition is worthwhile before committing to it.

## Connecting multiple workspaces

A common pattern is one primary workspace plus one or more domain workspaces (a project, a team, a product). The link between domain metrics and primary metrics is usually uncertain and should not be hardwired into formulas.

**Instead:**

- Keep the domain workspace as an **information source**. Participants observing both workspaces can use domain metrics as signal when proposing proposals and placing predictions in the primary workspace.
- Use **proposals** to test the connection. A proposal like *"Will achieving milestone X improve our primary metrics?"* lets conditional markets evaluate the hypothesis before committing resources.

This keeps workspaces decoupled at the definition level while still allowing participants to reason across them.

### Why maintain a separate domain workspace at all?

1. **Contextual information** - domain metrics give participants richer signal to reason about primary goals, without being hardcoded as direct formula inputs.
2. **Privacy and access control** - different workspaces can have different participant sets. Sensitive assessments in one workspace are not exposed to collaborators in another.
3. **Multi-stakeholder** - multiple owners can share a domain workspace and independently evaluate its impact on their respective primary utilities.
