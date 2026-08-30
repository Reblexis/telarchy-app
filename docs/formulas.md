# Metric formulas

A composed metric's value is a formula over other metrics in the same workspace.
This document is the grammar. The engine (`functions/src/lib/formula/`) is derived
from it; where they disagree, the engine is wrong.

## Grammar

```
expr    := term (('+' | '-') term)*
term    := unary (('*' | '/') unary)*
unary   := '-' unary | '+' unary | power
power   := atom ('^' unary)?            right-associative; '**' is an alias for '^'
atom    := number
         | '{' metric name '}'
         | function '(' expr (',' expr)* ')'
         | '(' expr ')'
number  := decimal with optional fraction and exponent (42, 3.14, .5, 1e3, 2.5E-2)
function := sqrt | abs | log | log10 | min | max | pow | clamp
```

- `{Metric name}` refers to another metric by its exact name; whitespace inside
  the braces is trimmed. A reference to a metric that does not exist evaluates
  as 0. A reference to a metric whose value is not known yet makes the whole
  formula's value unknown (null), never 0.
- Precedence, tightest first: function call and parentheses, `^`, unary minus,
  `*` `/`, `+` `-`. `^` is right-associative (`2^3^2` = 512) and binds tighter
  than unary minus (`-2^2` = -4). `^` is power, never bitwise XOR, and the
  evaluator is a hand-written tokenizer, parser and evaluator that accepts
  exactly this grammar, never a JavaScript `eval` (history:
  notes/decisions/formulas.md).
- Arity: `sqrt`, `abs`, `log` (natural), `log10` take one argument; `pow` two;
  `clamp(value, lo, hi)` three; `min` and `max` one or more.
- An empty formula, or the formula `0`, marks a leaf metric (its value is entered
  or synced, not computed).

`evaluateFormulaAtTime` is a separate utility over the same grammar. It resolves
each leaf from that leaf's market price at a named date instead of from its
measurement, and it is the one place an unknown leaf reads 0 rather than
unknown. It fills the `timeSeries` field on a composed metric in the metrics
payload and nothing else; a metric's own value never comes from it.

## Rejected

Anything not in the grammar is a syntax error that names the column, for example
`Unknown function or identifier "revenue" at column 3`. In particular:

- bare identifiers (a metric must be written as `{Name}`),
- `%`, comparisons (`<`, `>`, `==`), the ternary `?:`, member access (`.`),
  strings, and every other JavaScript construct,
- a comma outside a function's argument list,
- an unterminated `{`.

The formula editor shows the error; a stored formula that fails to parse
evaluates to 0 and logs an error server-side.

## Arithmetic

IEEE double arithmetic, as in JavaScript: `1/0` is Infinity, `sqrt(-1)` is NaN.
A formula whose result is NaN evaluates to 0 and logs an error. Nothing is
rounded; rounding is a display concern.
