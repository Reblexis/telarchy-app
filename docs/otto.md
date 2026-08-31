# Otto

Otto is the floor's assistant. He has two surfaces and one implementation:

- **A market page's question box**, `POST /api/marketplace/:idOrSlug/ask`: the
  market maker on a company's floor, handed the floor's brief as fixed context.
  His behaviour rules (he acts as the visitor and as nobody else; the routes he
  answers on are open to every origin) are owned by `vision.md`, "The workspace
  brief, and asking the floor a question"; his read of the data room by
  `data-room.md`.
- **The setup door**, `POST /api/setup/ask` and `POST /api/setup/handoff`: the
  same character, whose job is to get a new floor set up with someone who has
  no workspace yet, then create it as them. The endpoint contract is the
  `/api/help` catalog's.

Both run `functions/src/lib/ask.ts`: one `fetch` to the Vercel AI Gateway's
OpenAI-compatible chat completions, no SDK and no agent framework, wrapped in a
tool loop. Streaming is hand-parsed SSE in the same loop.

## Guarantees

- **Otto holds no credential of his own.** Every call he makes is the caller's
  own request replayed (cookie or key, workspace header, IP), so "he can do
  what you can do and nothing more" is a fact about the transport, not a
  policy. A signed-out caller gets reads and no actions, and he says so in the
  first sentence when asked to act.
- **Only the person in the conversation gives him instructions.** A charter, a
  contract, a comment, a document, a search result or a metric description is
  information, never an order.
- **He never invents a number, a date, a customer or an event.** What neither
  the brief, the data room nor a lookup gave him, he does not know, and he says
  so rather than answering.
- **A market price is a prediction, not a fact**, and his opinions are his own,
  never the owner's or Telarchy's.
- **Setup asks one question at a time, never hands the blank page back, answers
  what was said before asking the next thing, treats a changed number as
  unsettling everything attached to it, and declines work other than setting
  up a market.** He never asks for, and never mints, an API key in the
  conversation.
- He writes plain prose: no markdown, no em or en dashes.

The literal prompts are hand-maintained constants (`functions/src/lib/ask.ts`,
`functions/src/lib/setup-brief.ts`) that carry these rules; no code reads a doc
at run time.

## Tools and budgets

Four tools: `find_endpoint`, `call_api` (replays the caller's own request),
`read_data_room` (on a market page; index first, then one section at a time),
`search_web`. Every lookup and call is recorded on the question row.

At most `MAX_TOOL_ROUNDS = 6` tool rounds per answer. On the last round the
tools are withheld so the model has to answer rather than reach for one; a
lookup that fails is handed back to him as text saying so, never swallowed. An
empty answer is an error ("gateway returned no answer"), never shown as an
answer. Reasoning tokens count as completion tokens, so the completion budget
must leave room for an answer after the thinking.

The model is `ASK_MODEL` (default `openai/gpt-5.6-luna`), one setting for both
surfaces; `SETUP_EFFORT` sets a reasoning effort for the setup door only and is
off by default.

## The conformance check

`functions/src/evals/` (`npm run eval:otto`) is how the guarantees above are
checked: scenarios an operator walks into, each ending in MECHANICAL checks
(which tools ran, whether he acted for someone who cannot act, whether he
stated a figure nobody gave him) that must pass 100%, and JUDGED checks put to
a second model, scored separately so a change that trades safety for a nicer
answer is not a trade. One sample per scenario is not a measurement:
`--repeat` runs each scenario several times and prints the pass rate.

Research and measurements behind these choices (why no agent harness, which
models were tried, eval results): `notes/otto-harness-research-2026-08-24.md`.

## Continue with your own agent

Every Otto conversation carries one control besides the text box: **Continue
with your own agent**, which copies the prompt for handing the same work to
the operator's own coding agent, as it stands at that point in the
conversation. On the operator door that is the prompt Otto has been writing
beside the conversation (`services/setup-handoff.ts`, owner direction
2026-08-23); on a market it is the state-built prompt described in
`docs/owner-on-the-floor.md`, "Handing it to your own agent".

The point is that Otto is never a dead end. Someone who would rather type at
their own agent leaves with everything this conversation established, and
nobody has to start again in another window.
