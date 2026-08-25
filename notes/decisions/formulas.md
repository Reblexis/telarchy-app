# Decisions and records: docs/formulas.md

Records evicted from `docs/formulas.md` on 2026-08-25; the doc states the resulting rules in present tense.

## 2026-08-24: History

**DECIDED 2026-08-24.** Until this date formulas were rewritten with regular
expressions and run through JavaScript's `Function()`, which made `^` bitwise
XOR, `**` power, and accepted `%`, `?:` and comparisons; it was also an eval of
admin-editable text on the server (finding C1 in the security review). Replaced
by the hand-written tokenizer, parser and evaluator in `functions/src/lib/formula/`
that accept exactly the grammar above. Production at the time of the switch held
3 workspaces and 10 metrics with zero non-leaf formulas, so redefining `^` as
power changed nothing that existed; `scripts/formula-parity.mjs` compares the
retired evaluator with the new one over any formula dump, for the record.
