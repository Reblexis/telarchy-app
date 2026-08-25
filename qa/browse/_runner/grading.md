# Grading UX specs

Most specs (functional, multi-agent, infra) have machine pass/fail. The
specs in `12-ux/` produce evidence (screenshots + findings.txt) that needs
*judgement*: did the page actually communicate? did the chart move?
did the stranger feel oriented?

The runner supports two paths.

## Path 1: human grades (default)

Run normally:

```bash
qa/browse/_runner/run.sh 12-ux
```

The bash phase produces `/tmp/tt-<id>-*/` directories with screenshots and
findings.txt. The aggregated `results.md` lists each spec with its
goal-statement and where the evidence lives. A human walks through and
writes verdicts.

## Path 2: auto-grade via `claude -p`

If you have `claude` (Claude Code) on PATH, pass `--grade`:

```bash
qa/browse/_runner/run.sh 12-ux --grade
```

For each UX spec with `grader: auto` in its frontmatter, the runner
collects the findings + screenshot paths and pipes them into
`claude -p` with the spec's `grade-prompt`. The model's verdict gets
embedded into `results.md` under a "Grading verdicts" section.

`claude -p --no-tools` is used so the grader cannot accidentally do work
on the codebase. It's a pure read+respond invocation.

## Why no-prior-knowledge grading

Several UX specs (`cold-walk-stranger.md`, the persona files) need the
grader to evaluate "would a stranger understand this?" The model already
knows the product through CLAUDE.md / AGENTS.md context. The trick is that
the grader is invoked via `claude -p --no-tools` from a *clean* shell; it
does not have access to the project context, only the prompt + evidence.
The spec's grade-prompt explicitly says "you have not read internal docs;
score the experience as a stranger."

This is not perfect (model has training-data residue) but it removes the
local-context shortcut.

## Adding grader frontmatter

```yaml
grader: auto
grade-prompt: |
  You are evaluating evidence from a usability test. You have NOT read
  internal product docs. Score these dimensions 1-10 and explain:
  - clarity: did the page tell the user what this is?
  - orientation: did the user know what to do next?
  - delight: anything that felt clever or inviting?
  - friction: where would a real stranger drop off?
  Then give a verdict (ship / polish / blocker).
```

Keep the prompt short — the runner appends the spec's findings.txt and a
list of screenshot paths automatically.

## Cost

Each grading call is one short Claude turn (a few KB of input, a few
hundred tokens of output). Running `--grade` across all 16 UX specs is
a few cents.

## Why not run the bash via Claude

You could. The `12-ux/cold-walk-stranger.md` spec is structured so a
Claude Code session can read it as a runbook, follow the steps with `$B`,
and report findings. The bash runner is for CI; the session-as-runbook
mode is for manual deep dives. Same spec, two execution modes.
