---
title: Build a number out of other numbers
description: Formula syntax, what a computed metric can and cannot hold, and the one edit the market refuses.
category: run
order: 30
---
# Build a number out of other numbers

Most metrics are leaves: you set the value, and that is the number. A metric
with a formula is computed instead. Its value is derived from the metrics it
names, and you never set it directly: pass `value` on a computed metric and the
server ignores it and stores the formula's result.

A metric is a leaf when its formula is empty or the literal `0`. That is the
whole distinction.

## Referring to another metric

Write the metric's name in curly braces. Whitespace inside the braces is
trimmed, so `{ Revenue }` and `{Revenue}` are the same reference. The name must
match exactly otherwise, capitalisation included.

```
{Throughput} + {Reliability}
{ Revenue } * 0.6 + { Margin } * 0.4
```

A reference to a metric that does not exist evaluates as 0. A reference to a
metric whose value is not known yet makes the whole formula unknown rather than
0. Renaming a metric does not rewrite the formulas that name it, so rename and
edit the referring formulas together.

## The grammar

```
+ - * /            arithmetic
^  or  **          power, right-associative
( )                grouping
sqrt(x)            square root
abs(x)             absolute value
log(x)             natural logarithm
log10(x)           base-10 logarithm
min(x, y, ...)     smallest, one or more arguments
max(x, y, ...)     largest, one or more arguments
pow(x, n)          x to the power n
clamp(x, lo, hi)   x held between lo and hi
```

Precedence, tightest first: function calls and parentheses, then `^`, then
unary minus, then `*` and `/`, then `+` and `-`. `^` is power, never bitwise
xor, and it binds tighter than unary minus: `-2^2` is -4 and `2^3^2` is 512.

Anything outside that grammar is a syntax error naming the column it failed at.
There are no bare identifiers (a metric is always `{Name}`), no `%`, no
comparisons, no ternary, no strings, and no other JavaScript. The evaluator is a
hand-written tokenizer and parser, not `eval`, so nothing outside the grammar
can run. The governing grammar is `docs/formulas.md`.

Arithmetic is IEEE double, as in JavaScript: `1/0` is Infinity and `sqrt(-1)` is
NaN. A stored formula that fails to parse, or whose result is NaN, evaluates to
0 and logs a server-side error. Nothing is rounded; rounding is a display
concern.

## Examples

```
# Weighted average of two dimensions
{Throughput} * 0.6 + {Quality} * 0.4

# Geometric mean, which rewards balance instead of one big number
sqrt({Adoption} * {Retention})

# Normalise to a fixed range
clamp({RawScore} / {MaxPossible} * 1000, 0, 1000)

# Diminishing returns
pow({Capital}, 0.6)

# Only the part above a threshold counts
max({Output} - 500, 0)
```

## The edit a live market refuses

A formula is what an open market settles on, so changing it while any market on
that metric is unresolved is refused with 409, naming the field and the market.
On a computed metric so is a `value` you try to write. Wait for the market
to resolve, or void it deliberately first. `marketRangeMax` is the exception:
a range edit is accepted at any time and applies from now on, to every book
that opens after it and to the open books nobody has traded (voided and
respawned at the new range, pools refunded); a traded book keeps the range it
opened with until it settles. Getting the formula right before the first market opens is
much cheaper than either.

Names and descriptions are not settlement machinery and change freely, at any
time, with the market untouched. See [open a floor](/guides/creating) for the
full edit rules.

## Where the markets go

Markets are created on leaves, never on computed metrics. A computed metric with
time preference spawns markets for its leaf descendants at each of its sampled
dates, so the futures you care about get priced where they are measured. The
computed metric itself always reads your formula over what its leaves currently
measure; market prices never enter that number. So a formula is how you say
"these are the parts", and time preference is how you say "and I care about
where they land". See
[time preference](/guides/time-preference).

A composed metric also carries a `timeSeries` in the metrics payload, projected
by resolving each leaf from its market price at each sampled date. That series
is the only place market prices meet a formula, and an unpriced leaf counts 0 in
it, so a composite whose leaves are half unpriced projects low for a reason that
has nothing to do with the business. The metric's own value is unaffected: it
stays your formula over what the leaves measure.
