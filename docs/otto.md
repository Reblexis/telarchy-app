# Otto: the loop, the model, and whether to adopt a harness

**Question (Viktor, 2026-08-24):** "we could adopt something like deepseek
harness... do a research on which one would be best.. because i want it to be
able to do deep thinking and give best answers possible."

**Answer: don't adopt a harness. Buy the thinking directly.** The measurements
are below; the short version is that a harness would replace the part of Otto
that already works and leave untouched every part that decides answer quality.

## What Otto is today

`functions/src/lib/ask.ts`, 304 lines, no framework and no SDK: a `fetch` to
the Vercel AI Gateway's OpenAI-compatible `/v1/chat/completions` wrapped in a
loop of at most `MAX_TOOL_ROUNDS = 6`. Each round, tool calls are executed and
their results pushed back as `role: "tool"` messages; prose ends the loop.
Streaming is hand-parsed SSE in the same loop.

Four tools: `find_endpoint`, `call_api` (replays the caller's own request),
`read_data_room` on a market page, `search_web`.

One property is load-bearing and everything below is measured against it:
**Otto holds no credential of his own.** Every call he makes is the visitor's
own request replayed, so "he can do what you can do and nothing more" is a
fact about the transport rather than a policy someone wrote down.

## The harnesses, and why the famous one is the wrong shape

**DeepSeek Harness** (open-sourced 2026-08-13, MIT, "everything is a plugin",
95k stars in two days) is real and is genuinely interesting: model adapters,
tool registries, sessions, sandboxes and the agent loop itself are all
swappable, and it can drive Claude Code or Codex as sub-agents. It is a
CODING-agent harness. Its shape is long-running sessions over a filesystem in
a sandbox, with subagent orchestration. Otto is a request-scoped
conversational agent inside an Express handler with four tools, no filesystem,
no sandbox and a hard requirement to carry no credential. Adopting it would
mean bringing a session store, a sandbox and a plugin runtime to replace a
loop that is already correct, and the first thing it would ask to own is
exactly the thing that must not move: how the caller's identity reaches an API
call.

The TypeScript field, for completeness: **Vercel AI SDK 6** (`ToolLoopAgent`,
stable MCP, `needsApproval` for human-in-the-loop, DevTools) is the closest
fit and the lowest-risk migration, since it is the same vendor as the gateway
we already call; **Mastra** is the fuller product framework (router, studio,
memory, workflows); **LangGraph.js** wins for durable, checkpointed,
multi-session graphs; **OpenAI Agents SDK** is simplest but provider-locked.

None of them makes a model think harder. They organise loops, state and
observability. Our loop is 304 lines and green; our state is one request.

## What was actually measured

All through the gateway key we already hold, 2026-08-24. It serves 352 models,
including `deepseek-r1`, `deepseek-v3.2-thinking`, `claude-opus-4.6`,
`gpt-5.6-luna`, `o3-deep-research`, `kimi-k2-thinking`, `grok-4.20-multi-agent`.

**Every candidate calls tools correctly, and accepts reasoning effort.** One
round of Otto's real system prompt, asked to research a company:

| model | latency | cost | behaviour |
|---|---|---|---|
| `openai/gpt-5.6-luna` (current) | 4.2s | $0.0002 | searched |
| `openai/gpt-5.6-luna` effort=high | 3.5s | $0.0001 | searched |
| `anthropic/claude-opus-4.6` | 2.7s | ~0 | searched |
| `deepseek/deepseek-v3.2-thinking` | 2.8s | ~0 | searched |
| `moonshotai/kimi-k2-thinking` | 3.9s | $0.0003 | searched |

The docs warn that some models refuse `tools` and `reasoning_effort` together
on Chat Completions. Not true for ours on this gateway; tested, it works.

**The judgement round separates them, and not the way I expected.** Given a
search result that answered the wrong question (a total since 2018, when the
metric is monthly), four of five models went and searched AGAIN for the
monthly figure rather than answering. That is the right instinct and it is
what a thinking model buys. `kimi-k2-thinking` instead did the arithmetic
itself, and did it well: "1,500 total since 2018 means roughly 25 per month.
For a ceiling I would look at 100 or 150. At 100 the midpoint is 50, so the
market would read anything above 50 as more likely than not."

Both behaviours are defensible. Neither is a harness feature.

## The real levers, in the order they pay

1. **The model and its reasoning effort.** The only lever that changes how
   hard Otto thinks. Both are one env var away (`ASK_MODEL`), and the setup
   door is where thinking matters most: naming a number and a ceiling for a
   business is judgement, not retrieval.
2. **Tool rounds.** `MAX_TOOL_ROUNDS = 6` covers a search, a look-up and an
   answer. It does not cover a research chain, and the measurement above shows
   frontier models spending two rounds before they will commit to a number.
   The setup door wants more; a market page's Otto does not.
3. **Context.** Already the biggest win and already taken: the specification,
   the checklist read from the database, and the web. A model that knows what
   is undecided asks a better question than one that does not.
4. **Budget.** Reasoning tokens are completion tokens. A thinking model on a
   700-token ceiling spends the ceiling thinking and returns EMPTY content,
   which arrives as "gateway returned no answer" and falls back silently. That
   is not theory: it happened here on 2026-08-23 and every handoff fell back
   to the template for half a day while the page looked fine.
5. **A verification pass**, last and optional: a second call that checks an
   answer against the specification before it is shown. It is the one idea
   worth taking from harness-land, and it costs a whole extra call of latency
   on a surface where we have just spent effort removing one.

## Recommendation

Do not migrate. Make the two changes that buy thinking directly:

- Per-surface model and reasoning effort, so the setup door can run a thinking
  model at high effort while a market page keeps a fast one. The gateway
  already serves both; this is configuration, not architecture.
- A per-surface tool-round budget, raised for setup, with budget exhaustion
  logged loudly rather than falling back in silence.

Revisit a framework only when something concrete asks for it: MCP servers
(Vercel AI SDK has it stable), human-approval gates on tool calls, or tracing
we cannot get from the question log. On that day the AI SDK is the cheapest
move, because it is the same vendor and would keep the replayed-request
property intact.

## Sources

- DeepSeek Harness: <https://thenewstack.io/deepseek-harness-open-source-plugins/>,
  <https://www.theregister.com/ai-and-ml/2026/08/14/deepseeks-innovative-harness-treats-everything-as-a-plug-in/5288095>
- AI SDK 6 and `ToolLoopAgent`: <https://vercel.com/blog/ai-sdk-6>,
  <https://github.com/vercel/ai>
- TypeScript framework comparison: <https://www.langchain.com/resources/ai-agent-frameworks>,
  <https://mastra.ai/>
- Reasoning effort and budget exhaustion:
  <https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning>,
  <https://api-docs.deepseek.com/guides/thinking_mode/>
