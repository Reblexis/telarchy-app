# Outreach

Marketing, founder outreach, and recruiting-the-first-users work. Each
mechanism gets its own subdirectory.

## Subdirectories

| Path | Status | What it is |
| --- | --- | --- |
| `concierge/` | active 2026-04-29 → 2026-05-27 | The founder concierge program. Process tracked, real-people data gitignored. See `concierge/program.md`. |
| `contracts/` | active 2026-08-21 | Paid contracts with individual participants, negotiated on the Telarchy floor itself: what was asked, what terms we changed, and why. Started with Tetraspace's $20 writeup. |

## Tracked vs gitignored split

Some of this work involves real names, contact info, draft DMs to
specific people, and warmth assessments. That data is PII and the people
involved did not consent to being in version control, so it stays out of
git.

The rule: **process and templates tracked, real-people data not.** The
canonical example is concierge:

- `concierge/program.md` — tracked. The 4-week schedule, falsification
  criteria, operating model, non-negotiables.
- `concierge/candidates.md` — gitignored. Names, hooks, sent DMs.
- `concierge/intake-*.md`, `concierge/findings/`, `concierge/sent-dms/` —
  gitignored by glob.

When adding a new outreach mechanism (cold email campaign, content
calendar with named contacts, partnership pipeline), follow the same
split: a tracked process doc plus gitignored per-person files. Update
`.gitignore` to match.
