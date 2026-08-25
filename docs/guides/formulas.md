---
title: Formulas
description: Formula syntax: metric references, operators, math functions, and validation.
category: metrics
order: 30
---
# Formulas

Most metrics are **leaf metrics**: you set their value directly and they stand on their own. But sometimes you want a metric that combines others: a weighted score, a ratio, or an aggregate. That's what formulas are for.

A metric with a formula is a **computed metric**. Its value is derived automatically from the metrics it references; you never edit it directly. Leave the formula blank (or enter `0`) to keep a metric as a leaf.

## Metric references

Wrap any metric name in curly braces. Whitespace inside the braces is trimmed:

```
{Throughput} + {Reliability}
{ Revenue } * 0.6 + { Margin } * 0.4
```

## Operators

```
+   addition
-   subtraction
*   multiplication
/   division
()  parentheses for grouping
```

## Math functions

```
sqrt(x)          square root
abs(x)           absolute value
log(x)           natural logarithm
log10(x)         base-10 logarithm
min(x, y)        smaller of x and y
max(x, y)        larger of x and y
pow(x, n)        x to the power n
clamp(x, lo, hi) clamp x between lo and hi
```

## Examples

```
# Weighted average of two dimensions
{Throughput} * 0.6 + {Quality} * 0.4

# Geometric mean (rewards balance between two metrics)
sqrt({Adoption} * {Retention})

# Clamp a score to a fixed range
clamp({RawScore} / {MaxPossible} * 1000, 0, 1000)

# Diminishing returns on a resource metric
pow({Capital}, 0.6)

# Penalise below a threshold, reward above
max({Output} - 500, 0)
```

## Validation

The UI validates your formula in real time and warns about:

- References to metric names that don't exist
- Circular dependencies (A → B → A)
- Syntax errors or expressions that evaluate to NaN
- Use of commas (JS comma operator; use separate expressions instead)
