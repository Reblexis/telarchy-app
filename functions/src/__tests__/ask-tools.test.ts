/**
 * Otto browses the data room instead of being fed it (owner direction
 * 2026-08-20: "he should be able to browse it itself, not force fed the
 * context").
 *
 * Two things are pinned. The brief stays the fixed context, because it is the
 * cacheable prefix every visitor on a floor shares and the data room is not
 * pasted into it. And the tool round-trip actually happens: the model asks for
 * a section, the result goes back as a tool message, and the answer comes from
 * the round after it. A loop that silently swallowed the tool result would
 * still return an answer, which is exactly the failure this catches.
 */

import { type AskTool, askAboutWorkspace } from '../lib/ask';

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_KEY = process.env.AI_GATEWAY_API_KEY;

/** One gateway reply, in the shape the chat-completions API returns. */
function reply(message: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 } }),
    text: async () => '',
  } as unknown as Response;
}

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = 'test-key';
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = ORIGINAL_KEY;
});

function fakeDataRoom(): { tool: AskTool; calls: unknown[] } {
  const calls: unknown[] = [];
  const tool: AskTool = {
    spec: {
      type: 'function',
      function: { name: 'read_data_room', description: 'the books', parameters: { type: 'object', properties: {} } },
    },
    async run(args: unknown) {
      calls.push(args);
      return 'traffic: 3,583 visits since 2026-08-11';
    },
  };
  return { tool, calls };
}

test('Otto opens the data room, and answers from what it said', async () => {
  const { tool, calls } = fakeDataRoom();
  const bodies: any[] = [];
  global.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    if (bodies.length === 1) {
      return reply({
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'read_data_room', arguments: '{"section":"traffic"}' } },
        ],
      });
    }
    return reply({ role: 'assistant', content: '3,583 visits so far. Small, and published anyway.' });
  }) as unknown as typeof fetch;

  const res = await askAboutWorkspace('THE BRIEF', [{ role: 'user', content: 'how much traffic?' }], [tool]);

  expect(calls).toEqual([{ section: 'traffic' }]);
  expect(res.answer).toContain('3,583');
  // Usage sums across the rounds, or the operator sees a fraction of the bill.
  expect(res.usage.input).toBe(20);
  expect(res.usage.costUsd).toBeCloseTo(0.0002);

  // The tool result reached the model as a tool message on the second call.
  const second = bodies[1].messages;
  expect(second.some((m: any) => m.role === 'tool' && String(m.content).includes('3,583'))).toBe(true);
  // And the brief is still the system turn, not a paste of the data room.
  expect(bodies[0].messages[0].role).toBe('system');
  expect(bodies[0].messages[0].content).toContain('THE BRIEF');
  expect(bodies[0].messages[0].content).not.toContain('3,583');
});

test('a visitor who asks nothing about Telarchy pays for no lookup', async () => {
  const { tool, calls } = fakeDataRoom();
  global.fetch = (async () =>
    reply({ role: 'assistant', content: 'The market says 8,370.' })) as unknown as typeof fetch;

  const res = await askAboutWorkspace('THE BRIEF', [{ role: 'user', content: 'what does the market say?' }], [tool]);
  expect(res.answer).toContain('8,370');
  expect(calls).toHaveLength(0);
});

test('a failed lookup is told to him, never silently dropped', async () => {
  const tool: AskTool = {
    spec: {
      type: 'function',
      function: { name: 'read_data_room', description: 'the books', parameters: { type: 'object', properties: {} } },
    },
    async run() {
      throw new Error('database unreachable');
    },
  };
  const bodies: any[] = [];
  global.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    if (bodies.length === 1) {
      return reply({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_data_room', arguments: '{}' } }],
      });
    }
    return reply({ role: 'assistant', content: 'I could not open the data room just now.' });
  }) as unknown as typeof fetch;

  const res = await askAboutWorkspace('THE BRIEF', [{ role: 'user', content: 'what is Telarchy?' }], [tool]);
  expect(res.answer).toMatch(/could not open/i);
  const toolMsg = bodies[1].messages.find((m: any) => m.role === 'tool');
  expect(toolMsg.content).toContain('database unreachable');
});

test('the tools are withheld on the last round, so a loop has to end', async () => {
  const { tool } = fakeDataRoom();
  const bodies: any[] = [];
  global.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    // A model that would call the tool forever: it only stops because the
    // last round is sent without tools to call.
    if (body.tools) {
      return reply({
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: `c${bodies.length}`, type: 'function', function: { name: 'read_data_room', arguments: '{}' } },
        ],
      });
    }
    return reply({ role: 'assistant', content: 'Here is what I have.' });
  }) as unknown as typeof fetch;

  const res = await askAboutWorkspace('THE BRIEF', [{ role: 'user', content: 'tell me everything' }], [tool]);
  expect(res.answer).toBe('Here is what I have.');
  // Every round but the last offers tools; the last does not, which is the
  // only reason a model that would keep calling them ever stops. The count
  // follows MAX_TOOL_ROUNDS in lib/ask.ts rather than being pinned here.
  expect(bodies.length).toBeGreaterThan(1);
  expect(bodies.slice(0, -1).every(b => b.tools)).toBe(true);
  expect(bodies[bodies.length - 1].tools).toBeUndefined();
});
