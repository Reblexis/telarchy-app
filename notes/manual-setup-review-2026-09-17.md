# Manual bot setup on /agents, tested as written (2026-09-17)

Asked by Viktor: "lets make the bot creation as friendly as possible on
telarchy.. first lests focus on manual instructions.. test those as described
in telarchy.com/agents and see if theyu work.. then figure out what could be
improved".

Tested on a clean Linux directory, Python 3.14, pasting the commands exactly as
the live page (chunk `AgentsPage-B_NCWzaQ.js`) gives them. Key steps used a
throwaway self-registered bot with zero credits, `manual-setup-test-0917` in the
`telarchy` workspace (safe to delete).

## Result: step 1 fails for every visitor

`pip install -r requirements.txt` stops with "Could not open requirements
file", then `agent.py` dies with `ModuleNotFoundError: No module named
'telarchy'`. The visitor's first contact is a Python traceback.

Cause: the page and `docs/guides/build-agent.md` were written against the
reference agent's branch `agent-builder-start` (draft PR 2 in
`Reblexis/telarchy-reference-agent`, open since 2026-09-09). `main` of that repo
has no `requirements.txt`, and its `agent.py` has no `--budget-per-trade` or
`--cycle-budget`, so the live-trading command in step 3 would also fail with
"unrecognized arguments". The guide served at `/api/guides/build-agent` carries
the same commands, so the copy-prompt path sends coding assistants into the
same wall.

Nothing on either side tests the page's commands against the repo they clone,
which is how this shipped.

## With the branch checked out, the path works

Same commands against `agent-builder-start`:

- clone + venv + install: about 15 s, preview run 1.7 s, prints four candidate
  trades and "quote needs a key". Good first minute.
- with a key: the preview shows real fills. Good.
- `--live` with no key: clear message, exit 2. Good.
- wrong key: prints `failed: 401 Invalid agent key` and only then the
  `dry run on telarchy` header, so the order reads backwards, and it says
  nothing about where a key comes from.
- `--live` with zero credits: every trade prints "skipped: short by 1.000
  credits", ends "0 trade(s) placed", exit 0. It never says how a bot gets
  credits, which is the one thing that visitor needs next.

## What to improve, in order

1. **Make step 1 true.** Merge reference-agent PR 2 (or, if it is not ready,
   change the page and guide to the commands `main` supports today: the
   one-line `pip install "telarchy @ git+..."` and plain `--live`). Decision
   for Viktor: is PR 2 ready to merge.
2. **A test that fails when this breaks again.** A check in telarchy-app that
   reads the commands `manualCommands()` produces and asserts the files and
   flags they name exist on the reference agent's `main` (requirements.txt,
   agent.py, each `--flag`). Same check over the guide's code blocks.
3. **Fewer commands in step 1.** Six pasted lines, two prerequisites (Git,
   Python). A `pipx run` / `uvx`-style one-liner, or publishing the client to
   PyPI so step 1 is `pip install telarchy-agent && telarchy-agent`, removes
   the clone, the venv and the Git prerequisite. Biggest friction cut
   available, and a doc decision first (what the starter IS: a repo to read
   or a command to run).
4. **The key prompt can eat the pasted lines.** Step 3 copies three lines as
   one block; line 1 opens a hidden key prompt. In a terminal without
   bracketed paste (older bash, legacy Windows console) the remaining pasted
   lines are read as the key. Not reproduced here (modern bash and zsh are
   fine); fix is cheap: put the key prompt last in its own block, or let
   `agent.py` ask for the key itself when `TELARCHY_KEY` is unset and the
   terminal is interactive, which also deletes the ugliest line on the page.
5. **Say what happens to the key.** The env var dies with the terminal, so
   tomorrow the visitor is back to "needs a key" with a key the site no longer
   shows. One sentence, or a `.env` file the agent reads.
6. **Zero-credit live run should point somewhere.** "short by 1.000 credits"
   should be followed once by where credits come from (the owner funds the
   bot at creation, /agents). Agent-side copy, in the reference agent's README
   and output.
7. **Step numbering when connected.** In the connected view step 2 is hidden
   and step 3 renumbers to 2, fine, but the heading code still carries a dead
   `connected ? ... : ...` branch inside `!connected`. Cosmetic; conform when
   touching the file.
8. **No "it worked" moment.** After a live trade the page never tells the
   visitor where to see their bot (profile link, leaderboard row). The
   terminal output should end with the bot's profile URL.
9. **Runs once.** The closing note says so and links the guide, but the
   friendly version is one more copyable block: a cron line or `while` loop
   with the same budgets.

Not tested: the Windows PowerShell commands (no Windows box here), and the
signed-in connect form itself (needs Viktor's browser session; the key step
was exercised with a self-registered key instead).

## Outcome, same day

Viktor: "apply fixes and fix futtyher.. make it as simple and intuitive as
possible use codex to review as well".

- Reference agent PR 2 merged with two more commits: no workspace to choose
  (public `telarchy` floor), `agent.py --login` (hidden prompt, key checked,
  saved beside the agent, replaced atomically), `--every MINUTES`, a sentence
  and a pasteable command at every dead end (no key, refused key, no credits),
  hints that keep the workspace and limits just previewed. 93 tests.
- /agents manual setup is now preview, create key, `agent.py --login`; no block
  sets a variable or carries a key prompt with other lines. Build guide matches.
- Drift guard: `npm run check:reference-agent` in CI plus
  `src/lib/__tests__/reference-agent-contract.test.ts`. Against the agent's old
  main it failed with "names requirements.txt", the bug as it reached the site.
- Codex reviewed both diffs (9 findings on the agent, 6 on the app); all
  applied except making the key file private on Windows, which Python cannot
  do portably; the README now says the file takes the folder's permissions.
- Verified on a fresh clone of the agent's main against telarchy.com: preview,
  login through a real terminal, keyed preview, live refusal on zero credits.
  Not verified: a live trade that fills (the test bot has no credits; covered
  by stub tests only), Windows PowerShell, and the page in a signed-in browser.
- Still open from the list above: a one-line install (needs a published
  package, a product decision), and a profile link after trading (the API does
  not tell a key holder its own participant id).
